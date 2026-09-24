/**
 * Detector "wrapbox.code.treesitter" — syntax-aware source-code detection.
 *
 * WHY THIS EXISTS. The heuristic detector (`wrapbox.code.heuristic`) scores
 * keywords; it cannot tell a README that mentions `import` from a module that
 * does one, and it trusts file extensions an agent can rename. This detector
 * PARSES the text with real grammars (tree-sitter, in wasm, on device) and
 * accepts "this is <lang>" only when the parse tree is nearly error-free and
 * carries genuine structure (a function, a class, an import…). A `.txt` that
 * is really a Go file is recognised from its content; a `package.json` is
 * never called source code because a config file is classified BEFORE any
 * grammar runs — a build manifest leaking is a different policy question from
 * proprietary code leaking, and the two types must never be confused.
 *
 * LANGUAGE IDENTIFICATION IS OURS. tree-sitter does not detect languages; it
 * parses in the grammar it is given. `candidateLanguages()` ranks the 18
 * supported grammars from a shebang, the extension (a HINT worth a few
 * points, never a verdict) and keyword/shape signals, and nominates at most
 * MAX_GRAMMARS_PER_INPUT of them. Each nominee is parsed and scored as
 * `1 - (error + missing nodes) / named nodes`; the best is accepted at
 * ACCEPT_SCORE with ≥ MIN_NAMED_NODES named nodes and at least one structural
 * node. Lenient grammars (bash, ruby, lua) parse prose "successfully", which
 * is exactly why nomination needs positive keyword evidence and structure is
 * required — English never becomes a shell script here.
 *
 * GRAMMAR LOADING. `initCodeDetector()` loads the tree-sitter runtime wasm
 * (async, once, at daemon start); grammars load lazily and SYNCHRONOUSLY on
 * first use so `detect()` stays synchronous like every other detector. The
 * grammars shipped in `tree-sitter-wasms` were built by an older Emscripten
 * and carry the legacy `dylink` custom section; web-tree-sitter ≥ 0.25 only
 * accepts `dylink.0`. `patchGrammarWasm()` rewrites that one section in
 * memory (same four memory/table fields, new subsection encoding) and renames
 * the one libc import the runtime lacks (`isalpha` → `iswalpha`, see
 * IMPORT_RENAMES) — byte transforms of the container, not of the grammar.
 * `available()` proves the path works by loading one grammar at init; if
 * that fails it says so.
 *
 * WHAT IS EMITTED (never a value, never a line of code):
 *   SOURCE_CODE               label "lang:<grammar>"   count 1
 *   SOURCE_CODE.IAC           label "iac:<flavour>"    terraform, kubernetes, cloudformation, helm
 *   CONFIG.BUILD  label "config:<kind>"    json/yaml/toml/ini and known package manifests
 *   the same types with label "embedded" and count = number of embedded code
 *   blocks when code sits inside JSON string values or inside log lines
 *   (`fields` names the JSON keys it sat under — key names, not values).
 *
 * BOUNDS. MAX_PARSE_BYTES per unit (larger units are skipped and `lastError`
 * says so — the heuristic detector still covers them), at most three grammars
 * per input, at most MAX_EMBEDDED_UNITS embedded strings/lines, and a total
 * wall-clock budget derived from the input size that aborts a running parse
 * through tree-sitter's progress callback. No policy threshold lives here —
 * the acceptance constants describe what makes a parse *trustworthy*, not
 * what a clause should do about it; `match.minCount` / `minConfidence` decide.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import { BUILTIN_DETECTORS, type Confidence, type DetectInput, type DetectorDescriptor, type DetectorImpl, type Finding } from "@wrapbox/registry";

const BUILTIN = BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.code.treesitter")!;
/** Built-in descriptor plus `structured`, so JSON bodies reach the embedded-code scan. */
export const DESCRIPTOR: DetectorDescriptor = { ...BUILTIN, inputs: ["text", "code", "structured"] };

/** Units larger than this are skipped (reported in lastError), not truncated: a partial parse scores nothing meaningful. */
export const MAX_PARSE_BYTES = 512 * 1024;
/** Grammars tried per unit. */
export const MAX_GRAMMARS_PER_INPUT = 3;
/** Parse-quality floor for a HIGH finding: ≤ 15 % of named nodes are errors. */
export const ACCEPT_SCORE = 0.85;
/** Parse-quality floor for a MEDIUM finding when keyword evidence is strong. */
export const MEDIUM_SCORE = 0.7;
/** Heuristic score at or above which keyword evidence counts as strong. */
export const STRONG_SIGNAL = 5;
/** A tree with fewer named nodes is too small to say anything about. */
export const MIN_NAMED_NODES = 12;
/** JSON string values shorter than this are never scanned for embedded code. */
export const EMBEDDED_JSON_MIN_CHARS = 200;
/** Log lines shorter than this are never scanned for embedded code. */
export const EMBEDDED_LOG_MIN_CHARS = 120;
/** Embedded strings / lines parsed per unit. */
export const MAX_EMBEDDED_UNITS = 200;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const MAX_LOG_LINES = 5000;
const MIN_CANDIDATE_SCORE = 2;

/** Wall-clock budget for one unit: 250 ms plus 6 ms per KiB, capped. */
export function parseBudgetMs(bytes: number): number {
  return Math.min(4000, 250 + Math.ceil(bytes / 1024) * 6);
}

export type Lang =
  | "javascript" | "typescript" | "tsx" | "python" | "go" | "rust" | "java" | "kotlin" | "swift"
  | "c" | "cpp" | "c_sharp" | "ruby" | "php" | "bash" | "scala" | "lua" | "dart";
export const LANGS: Lang[] = ["javascript", "typescript", "tsx", "python", "go", "rust", "java", "kotlin", "swift", "c", "cpp", "c_sharp", "ruby", "php", "bash", "scala", "lua", "dart"];

/** Surfaced by the core; never contains content. */
export let lastError: string | null = null;

/* ------------------------------------------------------------------ *
 * Runtime + grammar loading
 * ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;
let initialised = false;
let initError: string | null = null;
let grammarDir: string | null = null;
let parser: Parser | null = null;
const grammars = new Map<Lang, Language>();
const grammarErrors = new Map<Lang, string>();

function readLeb(b: Uint8Array, o: number): [number, number] {
  let r = 0, s = 0, i = o;
  for (;;) { const x = b[i++]; r |= (x & 0x7f) << s; if (!(x & 0x80)) break; s += 7; if (s > 35) throw new Error("bad LEB128"); }
  return [r >>> 0, i];
}
function leb(n: number): number[] {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}

/**
 * Rewrite a legacy `dylink` custom section (memsize, memalign, tablesize,
 * tablealign, needed-count) into the `dylink.0` MEM_INFO subsection the
 * current Emscripten loader expects. Bytes with `dylink.0` pass through.
 */
export function upgradeDylinkSection(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 9 || bytes[8] !== 0) throw new Error("first section is not a custom section");
  const [size, payloadStart] = readLeb(bytes, 9);
  const sectionEnd = payloadStart + size;
  const [nameLen, nameStart] = readLeb(bytes, payloadStart);
  const name = Buffer.from(bytes.subarray(nameStart, nameStart + nameLen)).toString("utf-8");
  if (name === "dylink.0") return bytes;
  if (name !== "dylink") throw new Error(`first custom section is "${name}", not dylink`);
  let o = nameStart + nameLen;
  const fields: number[] = [];
  for (let i = 0; i < 4; i++) { const [v, n] = readLeb(bytes, o); fields.push(v); o = n; }
  const [needed] = readLeb(bytes, o);
  if (needed !== 0) throw new Error("grammar declares needed dynamic libraries");
  const memInfo = fields.flatMap(leb);
  const payload = [...leb(8), ...Buffer.from("dylink.0", "utf-8"), 1, ...leb(memInfo.length), ...memInfo];
  const section = [0, ...leb(payload.length), ...payload];
  return Buffer.concat([bytes.subarray(0, 8), Buffer.from(section), bytes.subarray(sectionEnd)]);
}

/**
 * Imports the grammars' external scanners take from libc that the tree-sitter
 * runtime wasm does not export, mapped to an export with the same signature.
 * `isalpha` (narrow char) → `iswalpha` (wide char): identical on ASCII, and
 * the bash scanner only reaches it while scanning `case` patterns. Without
 * this every `case … esac` script threw inside the scanner. `__assert_fail`
 * and `abort` are also unprovided but only reachable on a scanner assertion
 * failure, which `scoreParse` catches and fails closed.
 */
const IMPORT_RENAMES: Record<string, string> = { isalpha: "iswalpha" };

/** Rewrite import field names in a wasm binary's import section (id 2). Only `env` function imports are touched. */
export function renameImports(bytes: Uint8Array, renames: Record<string, string>): Uint8Array {
  let o = 8;
  while (o < bytes.length) {
    const id = bytes[o];
    const [size, payloadStart] = readLeb(bytes, o + 1);
    const end = payloadStart + size;
    if (id !== 2) { o = end; continue; }
    const out: number[] = [];
    let p = payloadStart;
    const [count, afterCount] = readLeb(bytes, p); p = afterCount;
    out.push(...leb(count));
    let changed = false;
    for (let i = 0; i < count; i++) {
      const [ml, ms] = readLeb(bytes, p); const modName = bytes.subarray(ms, ms + ml); p = ms + ml;
      const [fl, fs] = readLeb(bytes, p); let field = bytes.subarray(fs, fs + fl); p = fs + fl;
      const kind = bytes[p++];
      const rest0 = p;
      if (kind === 0) { p = readLeb(bytes, p)[1]; }
      else if (kind === 1) { p++; p = readLimits(bytes, p); }
      else if (kind === 2) { p = readLimits(bytes, p); }
      else if (kind === 3) { p += 2; }
      else throw new Error(`unknown import kind ${kind}`);
      const fieldName = Buffer.from(field).toString("utf-8");
      if (kind === 0 && Buffer.from(modName).toString("utf-8") === "env" && renames[fieldName]) { field = Buffer.from(renames[fieldName], "utf-8"); changed = true; }
      out.push(...leb(ml), ...modName, ...leb(field.length), ...field, kind, ...bytes.subarray(rest0, p));
    }
    if (!changed) return bytes;
    return Buffer.concat([bytes.subarray(0, o), Buffer.from([2, ...leb(out.length)]), Buffer.from(out), bytes.subarray(end)]);
  }
  return bytes;
}
function readLimits(bytes: Uint8Array, p: number): number {
  const flags = bytes[p++];
  p = readLeb(bytes, p)[1];
  if (flags & 1) p = readLeb(bytes, p)[1];
  return p;
}

/** Everything a shipped grammar needs before this runtime can load it. */
export function patchGrammarWasm(bytes: Uint8Array): Uint8Array {
  return renameImports(upgradeDylinkSection(bytes), IMPORT_RENAMES);
}

function locateGrammarDir(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
}

/** Synchronous, cached grammar load; a failure is cached too so it is reported once, not retried per unit. */
function grammar(lang: Lang): Language | null {
  const cached = grammars.get(lang);
  if (cached) return cached;
  if (grammarErrors.has(lang) || !grammarDir) return null;
  try {
    const raw = fs.readFileSync(path.join(grammarDir, `tree-sitter-${lang}.wasm`));
    const patched = patchGrammarWasm(raw);
    const mod = new WebAssembly.Module(patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength) as ArrayBuffer);
    const L = Language.loadSync(mod);
    grammars.set(lang, L);
    return L;
  } catch (e) {
    grammarErrors.set(lang, (e as Error).message.split("\n")[0].slice(0, 160));
    return null;
  }
}

/** Load the tree-sitter runtime once. Grammars load lazily on first use. */
export function initCodeDetector(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Parser.init();
        grammarDir = locateGrammarDir();
        const present = LANGS.filter((l) => fs.existsSync(path.join(grammarDir!, `tree-sitter-${l}.wasm`)));
        if (present.length === 0) throw new Error(`no grammar wasm files under ${grammarDir}`);
        parser = new Parser();
        // Prove the loader path (dylink rewrite + loadSync + ABI) on one grammar so available() is honest.
        const probe: Lang = present.includes("javascript") ? "javascript" : present[0];
        if (!grammar(probe)) throw new Error(`grammar ${probe} failed to load: ${grammarErrors.get(probe)}`);
        initialised = true;
      } catch (e) {
        initError = `tree-sitter init failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`;
        initialised = false;
      }
    })();
  }
  return initPromise;
}

/** Which grammars exist on disk (after init). */
export function grammarsPresent(): Lang[] {
  if (!grammarDir) return [];
  return LANGS.filter((l) => fs.existsSync(path.join(grammarDir!, `tree-sitter-${l}.wasm`)));
}

/* ------------------------------------------------------------------ *
 * Language identification (ours, not tree-sitter's)
 * ------------------------------------------------------------------ */

const EXT_HINT: Record<string, Lang> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
  cs: "c_sharp", rb: "ruby", php: "php", sh: "bash", bash: "bash", zsh: "bash",
  scala: "scala", sc: "scala", lua: "lua", dart: "dart",
};

const SHEBANG: Array<[RegExp, Lang]> = [
  [/^#!.*\bpython[0-9.]*\b/, "python"], [/^#!.*\bnode\b/, "javascript"], [/^#!.*\b(ba|z|k|da)?sh\b/, "bash"],
  [/^#!.*\bruby\b/, "ruby"], [/^#!.*\bphp\b/, "php"], [/^#!.*\blua\b/, "lua"], [/^#!.*\bswift\b/, "swift"],
];

type Signal = [RegExp, number];
/**
 * Keyword / shape signals per grammar. Weights are evidence strength, not
 * thresholds: the parse decides. Signals are anchored or word-bounded and
 * linear (no nested quantifiers) so scoring cost is bounded by input size.
 */
const SIGNALS: Record<Lang, Signal[]> = {
  python: [[/^\s*def \w+\(.*\)\s*(->\s*[\w[\], .]+)?:\s*$/m, 4], [/^\s*class \w+(\(.*\))?:\s*$/m, 3], [/^\s*(from [\w.]+ )?import \w+/m, 2], [/\bself\b/, 2], [/^\s*(if|elif|for|while|with|try|except)\b.*:\s*$/m, 2], [/\bprint\(/, 1], [/\b(None|True|False)\b/, 1], [/\bf['"]/, 1], [/^\s*@\w+/m, 1], [/^\s*return\b/m, 1]],
  javascript: [[/\brequire\(['"]/, 3], [/\bmodule\.exports\b/, 3], [/\b(const|let|var) \w+\s*=/, 2], [/=>/, 1], [/\bfunction\s*\w*\s*\(/, 2], [/\bconsole\.\w+\(/, 2], [/^\s*import .* from ['"]/m, 2], [/^\s*export (default|const|function|class)\b/m, 1], [/\bthis\./, 1], [/===|!==/, 1], [/\bclass \w+/, 1], [/\basync\b|\bawait\b/, 1], [/\bnew Promise\b|\.then\(/, 1]],
  typescript: [[/:\s*(string|number|boolean|void|any|unknown|never)\b/, 4], [/\binterface \w+\s*\{/, 3], [/^\s*type \w+(<.*>)?\s*=/m, 3], [/^\s*import .* from ['"]/m, 2], [/^\s*export (default |const |function |class |interface |type |enum )/m, 2], [/\b(const|let) \w+\s*[:=]/, 1], [/=>/, 1], [/\bfunction \w+\s*\(/, 1], [/\bconsole\.\w+\(/, 1], [/\bas (const|\w+)\b/, 1], [/\b(readonly|implements|enum|declare|private|public|protected)\b/, 2], [/\w+<[\w, [\]]+>/, 1]],
  tsx: [[/<[A-Z]\w*(\s[^>]*)?\/?>/, 3], [/<\/[A-Za-z][\w.]*>/, 2], [/\bReact\b/, 2], [/\b(useState|useEffect|useMemo|useCallback)\(/, 3], [/:\s*(string|number|boolean|void|JSX\.Element|React\.\w+)\b/, 2], [/^\s*import .* from ['"]/m, 1], [/^\s*export (default |const |function )/m, 1], [/\bclassName=/, 2]],
  go: [[/^package \w+\s*$/m, 4], [/^import (\(|")/m, 3], [/\bfunc (\(\w+ \*?\w+\) )?\w+\(/, 4], [/:=/, 2], [/\bfmt\.\w+\(/, 2], [/\btype \w+ (struct|interface)\b/, 2], [/\bnil\b/, 1], [/\berr != nil\b/, 2], [/\b(go|defer) \w+/, 1], [/\bchan\b/, 1]],
  rust: [[/\bfn \w+\s*[(<]/, 4], [/\blet (mut )?\w+/, 2], [/^\s*use [\w:]+/m, 2], [/\bimpl(<.*>)? \w+/, 3], [/\b(pub )?(struct|enum|trait|mod) \w+/, 2], [/&self\b|&mut\b/, 2], [/\bprintln!\(/, 2], [/\bmatch \w+ \{/, 1], [/::/, 1], [/\b(Vec|Option|Result|String)</, 2], [/#\[(derive|test|cfg)/, 2], [/->\s*[\w<>&']+\s*\{/, 1]],
  java: [[/\bpublic (static |final |abstract )*(class|void|interface|enum)\b/, 4], [/^\s*import java\./m, 3], [/\bSystem\.(out|err)\./, 3], [/^\s*package [\w.]+;/m, 2], [/\b(private|protected|public) \w+(<.*>)? \w+\s*[;=(]/, 2], [/\bnew \w+(<.*>)?\(/, 1], [/@Override\b/, 2], [/\bString\[\]/, 1], [/\b(throws|extends|implements)\b/, 1]],
  kotlin: [[/\bfun \w+\s*\(/, 4], [/\b(val|var) \w+(\s*:\s*\w+)?\s*=/, 2], [/\bdata class\b/, 3], [/^\s*import [\w.]+\s*$/m, 1], [/\bprintln\(/, 1], [/\bwhen\s*\(/, 1], [/\?\./, 1], [/\b(object|companion object)\b/, 2], [/:\s*\w+\?/, 1], [/\bclass \w+(\(.*\))?/, 1], [/\b(override|suspend|lateinit|internal)\b/, 2]],
  swift: [[/\bfunc \w+\s*\(/, 4], [/\b(let|var) \w+\s*(:\s*[\w<>[\]?]+)?\s*=/, 1], [/^\s*import (Foundation|UIKit|SwiftUI|Combine|AppKit)\b/m, 4], [/\b(struct|class|enum|extension|protocol) \w+(\s*:\s*[\w, ]+)?\s*\{/, 2], [/\bguard let\b|\bif let\b/, 3], [/\?\?/, 1], [/\bprint\(/, 1], [/->\s*\w+\s*\{/, 1], [/@(objc|IBAction|IBOutlet|State|Published|MainActor|main)\b/, 3], [/\bself\./, 1], [/\bvar \w+\s*:\s*\w+/, 1]],
  c: [[/^#include\s*[<"][\w/.]+\.h[>"]/m, 4], [/\bint main\s*\(/, 3], [/\bprintf\s*\(/, 2], [/\b(struct|union|enum) \w+\s*\{/, 2], [/\b(int|char|void|float|double|long|unsigned|size_t|uint\d+_t|bool)\s+\*?\w+\s*[(;=,[]/, 2], [/\b(malloc|calloc|free|memcpy|strlen)\s*\(/, 2], [/\breturn 0;/, 1], [/\bNULL\b/, 1], [/^\s*typedef\b/m, 1], [/^#define\b/m, 1]],
  cpp: [[/^#include\s*<(iostream|vector|string|map|memory|algorithm|cstdio|cstdlib|unordered_map|functional|optional|thread)>/m, 4], [/\bstd::/, 3], [/\b(class|struct) \w+(\s*:\s*(public|private|protected) \w+)?\s*\{/, 2], [/\bnamespace \w+\s*\{/, 2], [/\btemplate\s*</, 3], [/^\s*(public|private|protected):/m, 2], [/\bnullptr\b/, 2], [/\bauto \w+\s*=/, 1], [/\b(virtual|override|constexpr|noexcept)\b/, 2], [/\bconst \w+&/, 1], [/\bint main\s*\(/, 1]],
  c_sharp: [[/^\s*using System(\.\w+)*;/m, 4], [/\bnamespace [\w.]+\s*[{;]/, 2], [/\bpublic (static |sealed |abstract |async |override |virtual )*(class|void|string|int|bool|Task|interface|record)\b/, 3], [/\bConsole\.\w+\(/, 3], [/\bvar \w+ = new\b/, 1], [/\{\s*get;\s*(set;|init;)?\s*\}/, 3], [/^\s*\[\w+(\(.*\))?\]\s*$/m, 1], [/\basync Task\b/, 2], [/\b(List|Dictionary|IEnumerable)<\w+/, 2], [/\bstring \w+\s*[;=]/, 1]],
  ruby: [[/^\s*def \w+[?!]?(\(.*\))?\s*$/m, 4], [/^\s*end\s*$/m, 2], [/^\s*require(_relative)? ['"]/m, 3], [/\bputs\b/, 2], [/\battr_(accessor|reader|writer)\b/, 3], [/\bdo \|\w+\|/, 2], [/\.each\b/, 1], [/@\w+\s*=/, 1], [/^\s*module \w+/m, 1], [/^\s*class \w+( < \w+)?\s*$/m, 2], [/\bnil\b/, 1], [/\b(unless|elsif)\b/, 2], [/:\w+ =>|\w+: /, 1]],
  php: [[/<\?php/, 5], [/\$\w+\s*=/, 2], [/\bfunction \w+\s*\(\s*\$/, 3], [/->\w+\(/, 1], [/\becho\b/, 1], [/^\s*namespace [\w\\]+;/m, 2], [/^\s*use [\w\\]+;/m, 1], [/\$this->/, 2], [/\bpublic function\b/, 2], [/\barray\(/, 1], [/\bforeach\s*\(\s*\$/, 2]],
  bash: [[/^\s*(if|elif) \[\[? /m, 3], [/^\s*fi\s*$/m, 3], [/\bthen\s*$/m, 2], [/^\s*done\s*$/m, 3], [/\bdo\s*$/m, 1], [/\becho ["$-]/, 2], [/\$\{?[A-Za-z_@#?0-9]\w*\}?/, 1], [/^\s*export \w+=/m, 2], [/^\s*set -[eux]+/m, 3], [/\bfor \w+ in /, 2], [/\| ?(grep|awk|sed|xargs|sort|cut)\b/, 2], [/^\s*(function \w+\s*\(\)|\w+\s*\(\))\s*\{/m, 3], [/^\s*esac\s*$/m, 3], [/^\s*case .* in\s*$/m, 2], [/^\s*(sudo|apt-get|yum|brew|curl|wget|chmod|mkdir|rm -rf|cd) /m, 2], [/\$\(/, 1]],
  scala: [[/^\s*object \w+/m, 4], [/\bdef \w+(\[.*\])?\(.*\)\s*(:\s*[\w[\]]+)?\s*=/, 4], [/\b(val|var) \w+(\s*:\s*\w+)?\s*=/, 1], [/\bcase class\b/, 3], [/^\s*import scala\./m, 3], [/\btrait \w+/, 2], [/\bimplicit\b/, 2], [/\bextends \w+/, 1], [/\bmatch \{/, 1], [/=>/, 1], [/\bnew \w+(\[.*\])?\(/, 1]],
  lua: [[/\blocal (function )?\w+/, 4], [/\bfunction \w+[.:]?\w*\s*\(/, 2], [/^\s*end\s*$/m, 1], [/\bthen\s*$/m, 1], [/\bnil\b/, 1], [/\brequire\s*\(?['"]/, 2], [/\bprint\(/, 1], [/~=/, 2], [/\.\./, 1], [/\belseif\b/, 2], [/\bfor \w+\s*=\s*\d/, 1], [/\b(pairs|ipairs)\(/, 3], [/^\s*--/m, 1]],
  dart: [[/\bvoid main\(\)/, 3], [/^\s*import 'package:/m, 4], [/^\s*import 'dart:/m, 4], [/\bfinal \w+/, 1], [/\bextends (StatelessWidget|StatefulWidget)\b/, 4], [/\bWidget build\(/, 4], [/@override\b/, 3], [/\bprint\(/, 1], [/\b(String|int|double|bool) \w+\s*[=;(]/, 1], [/\bFuture</, 2], [/\basync\s*\{/, 1], [/\blate \w+/, 2], [/=>/, 1]],
};

/** Node types that count as STRUCTURE — a parse without one is a tree of words, not a program. */
const STRUCTURAL = new Set([
  "function_definition", "function_declaration", "function_item", "function_signature", "function_definition_statement", "local_function_definition_statement", "local_function", "function_statement",
  "method_definition", "method_declaration", "method", "method_signature", "singleton_method",
  "class_definition", "class_declaration", "class_specifier", "class", "struct_item", "struct_specifier", "struct_declaration", "impl_item", "enum_item", "enum_declaration", "trait_item", "trait_definition", "object_definition", "interface_declaration", "protocol_declaration", "record_declaration",
  "import_statement", "import_declaration", "import_header", "import_or_export", "use_declaration", "preproc_include", "package_clause", "package_declaration", "namespace_declaration", "namespace_definition", "using_directive", "module", "type_declaration", "type_alias_declaration",
  "lexical_declaration", "variable_declaration", "let_declaration", "property_declaration", "field_declaration", "val_definition", "var_definition", "local_variable_declaration",
  "for_statement", "while_statement", "if_statement", "case_statement", "pipeline", "redirected_statement",
]);

export interface Candidate { lang: Lang; score: number; hint: boolean }

/** Rank grammars by evidence. Returns at most MAX_GRAMMARS_PER_INPUT candidates with positive evidence, best first. */
export function candidateLanguages(text: string, filename?: string): Candidate[] {
  const head = text.slice(0, 200);
  const sample = text.length > 64 * 1024 ? text.slice(0, 64 * 1024) : text;
  const scores = new Map<Lang, number>();
  const hinted = new Set<Lang>();
  for (const [re, lang] of SHEBANG) if (re.test(head)) { scores.set(lang, (scores.get(lang) ?? 0) + 6); hinted.add(lang); break; }
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const hint = ext ? EXT_HINT[ext] : undefined;
  if (hint) { scores.set(hint, (scores.get(hint) ?? 0) + 3); hinted.add(hint); }
  for (const lang of LANGS) {
    let s = scores.get(lang) ?? 0;
    for (const [re, w] of SIGNALS[lang]) if (re.test(sample)) s += w;
    if (s > 0) scores.set(lang, s);
  }
  // A hint alone is only worth trying when the content shows some evidence for it.
  return [...scores.entries()]
    .filter(([lang, s]) => s >= MIN_CANDIDATE_SCORE || hinted.has(lang))
    .sort((a, b) => b[1] - a[1] || LANGS.indexOf(a[0]) - LANGS.indexOf(b[0]))
    .slice(0, MAX_GRAMMARS_PER_INPUT)
    .map(([lang, score]) => ({ lang, score, hint: hinted.has(lang) }));
}

/* ------------------------------------------------------------------ *
 * Parsing and scoring
 * ------------------------------------------------------------------ */

export interface ParseScore { lang: Lang; score: number; nodeScore: number; byteScore: number; named: number; errors: number; structural: number; plausible: boolean; timedOut: boolean }

/** Grammars that parse almost any word sequence without error; structure alone must carry the verdict. */
const LENIENT = new Set<Lang>(["bash", "ruby", "lua"]);

/**
 * The bash grammar parses "The office move has slipped" as a command named
 * `The` with four arguments — no error, no missing node. A shell script is
 * only believable when most of its commands are things a shell can run:
 * builtins, coreutils and the everyday tools. Command names are read inside
 * the walk and never leave it.
 */
const SHELL_COMMANDS = new Set(("alias apt apt-get awk basename bash brew cat cd chmod chown chgrp cmake cp curl cut date declare df diff dirname docker docker-compose du echo env eval exec exit export expr find for git go grep gzip head helm id java kill kubectl less ln local ls make mkdir mktemp mv node npm npx pip pip3 printf ps pwd python python3 read readonly return rm rmdir rsync sed seq set sh shift sleep sort source ssh scp sudo systemctl tar tail tee terraform test touch tr trap true false type ulimit umask uname uniq unset wc wget which xargs yarn yum zip unzip java javac mvn gradle cargo rustc rustup ruby gem bundle php composer swift xcodebuild dotnet nginx service chroot mount umount ip ifconfig ping nc openssl gpg base64 sha256sum md5sum jq yq tmux screen vim nano lsof netstat time nohup wait let shopt getopts caller command builtin printenv hostname whoami tty stat nproc install pkill pgrep killall time timeout xz bzip2 cpio dd fdisk mkfs sync logger crontab at batch history exec .").split(" "));

/**
 * Parse `text` in one grammar and score the tree. Returns null when the grammar
 * is unavailable. Two measures, the lower wins: the node ratio the spec asks
 * for (ERROR subtrees are opaque — the identifiers a grammar salvages inside
 * an error region are not evidence of code) and the share of BYTES outside
 * ERROR regions, which is what defeats prose: a paragraph parsed as Python
 * yields a handful of ERROR nodes that together cover most of the text.
 * Structure is only counted outside error regions.
 */
export function scoreParse(text: string, lang: Lang, deadline: number): ParseScore | null {
  const L = grammar(lang);
  if (!L || !parser) return null;
  parser.setLanguage(L);
  let tree = null;
  try {
    tree = parser.parse(text, null, { progressCallback: () => (performance.now() > deadline) as unknown as void });
  } catch (e) {
    // A grammar's external scanner can trap (assertion, unprovided libc import): that candidate is out for this unit, the rest still run.
    lastError = `grammar ${lang} failed on this unit: ${(e as Error)?.message?.split("\n")[0].slice(0, 120) ?? String(e)}`;
    parser.reset();
    return null;
  } finally {
    if (!tree) parser.reset();
  }
  if (!tree) return { lang, score: 0, nodeScore: 0, byteScore: 0, named: 0, errors: 0, structural: 0, plausible: false, timedOut: true };
  let named = 0, errors = 0, structural = 0, errorBytes = 0, commands = 0, knownCommands = 0;
  const totalBytes = Math.max(1, tree.rootNode.endIndex - tree.rootNode.startIndex);
  const c = tree.walk();
  try {
    // Iterative pre-order walk with a cursor: no recursion, no Node allocation per visit.
    let descend = true;
    for (;;) {
      if (descend) {
        if (c.nodeIsNamed) {
          named++;
          if (c.nodeType === "ERROR") { errors++; errorBytes += c.endIndex - c.startIndex; descend = false; }
          else if (c.nodeIsMissing) errors++;
          else if (STRUCTURAL.has(c.nodeType)) structural++;
          if (lang === "bash" && c.nodeType === "command") {
            commands++;
            const name = c.currentNode.childForFieldName("name")?.text ?? "";
            if (SHELL_COMMANDS.has(name) || /^[./~$]/.test(name) || /^[A-Z_][A-Z0-9_]*=/.test(name)) knownCommands++;
          } else if (lang === "bash" && (c.nodeType === "variable_assignment" || c.nodeType === "declaration_command")) { commands++; knownCommands++; }
        }
        if (descend && c.gotoFirstChild()) continue;
      }
      if (c.gotoNextSibling()) { descend = true; continue; }
      if (!c.gotoParent()) break;
      descend = false;
    }
  } finally {
    c.delete();
    tree.delete();
  }
  const nodeScore = named ? 1 - errors / named : 0;
  const byteScore = 1 - Math.min(1, errorBytes / totalBytes);
  const plausible = lang !== "bash" || commands === 0 || knownCommands / commands >= 0.5;
  return { lang, score: Math.min(nodeScore, byteScore), nodeScore, byteScore, named, errors, structural, plausible, timedOut: false };
}

/** Best accepted grammar for a text, or null. Runs at most MAX_GRAMMARS_PER_INPUT parses. */
export function identify(text: string, filename: string | undefined, deadline: number): { lang: Lang; confidence: Confidence; parse: ParseScore } | null {
  const candidates = candidateLanguages(text, filename);
  const rank = { medium: 1, high: 2 } as const;
  let best: { lang: Lang; confidence: "medium" | "high"; parse: ParseScore } | null = null;
  for (const cand of candidates) {
    if (performance.now() > deadline) { lastError = "parse budget exhausted before every candidate grammar ran; findings are partial"; break; }
    // A lenient grammar needs content evidence, not just an extension, and more than one structural node.
    if (LENIENT.has(cand.lang) && cand.score - (cand.hint ? 3 : 0) < MIN_CANDIDATE_SCORE) continue;
    const p = scoreParse(text, cand.lang, deadline);
    if (!p) continue;
    if (p.timedOut) { lastError = "parse budget exhausted; findings are partial"; break; }
    if (p.named < MIN_NAMED_NODES || p.structural < (LENIENT.has(cand.lang) ? 2 : 1) || !p.plausible) continue;
    // Selection is over ACCEPTED outcomes: a lenient grammar's higher raw score must not displace a language that actually qualifies.
    const confidence = p.score >= ACCEPT_SCORE ? "high" : p.score >= MEDIUM_SCORE && cand.score >= STRONG_SIGNAL ? "medium" : null;
    if (!confidence) continue;
    if (!best || rank[confidence] > rank[best.confidence] || (rank[confidence] === rank[best.confidence] && p.score > best.parse.score)) best = { lang: cand.lang, confidence, parse: p };
    if (confidence === "high" && p.score >= 0.99) break; // a clean parse cannot be beaten
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Config / IaC classification — before any grammar runs
 * ------------------------------------------------------------------ */

const MANIFEST_NAMES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "tsconfig.json", "jsconfig.json", ".babelrc", ".eslintrc", ".prettierrc", ".npmrc",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties",
  "pyproject.toml", "setup.cfg", "requirements.txt", "pipfile", "pipfile.lock", "poetry.lock", "environment.yml", "gemfile", "gemfile.lock", "composer.json", "composer.lock",
  "makefile", "cmakelists.txt", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "podfile", "package.swift", "pubspec.yaml", "pubspec.lock", "mix.exs", ".gitignore", ".editorconfig",
]);
const CONFIG_EXT: Record<string, string> = { json: "json", json5: "json", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini", lock: "lockfile" };

export type ConfigKind = { type: "SOURCE_CODE.IAC" | "CONFIG.BUILD"; label: string };

/** IaC first (a Kubernetes manifest is YAML but its policy meaning is infrastructure), then config formats. */
export function classifyConfig(text: string, filename?: string, format?: string, json?: unknown): ConfigKind | null {
  const base = path.basename(filename ?? "").toLowerCase();
  const ext = base.match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const head = text.slice(0, 32 * 1024);

  // Infrastructure as code
  const tfBlocks = (head.match(/^\s*(resource|provider|module|variable|output|data|terraform|locals)\b(\s+"[^"\n]{1,120}"){0,2}\s*\{/gm) ?? []).length;
  if (ext === "tf" || ext === "tfvars" || ext === "hcl" || tfBlocks >= 2) return { type: "SOURCE_CODE.IAC", label: "iac:terraform" };
  if (/^apiVersion:\s*\S+/m.test(head) && /^kind:\s*\S+/m.test(head)) return { type: "SOURCE_CODE.IAC", label: "iac:kubernetes" };
  if (/^AWSTemplateFormatVersion\b/m.test(head) || (/^Resources:\s*$/m.test(head) && /^\s+Type:\s*['"]?AWS::/m.test(head))) return { type: "SOURCE_CODE.IAC", label: "iac:cloudformation" };
  if (base === "chart.yaml" || base === "values.yaml" || /\{\{\s*\.(Values|Release|Chart)\./.test(head)) return { type: "SOURCE_CODE.IAC", label: "iac:helm" };
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (typeof o.apiVersion === "string" && typeof o.kind === "string") return { type: "SOURCE_CODE.IAC", label: "iac:kubernetes" };
    if (typeof o.AWSTemplateFormatVersion === "string" || (o.Resources && typeof o.Resources === "object")) return { type: "SOURCE_CODE.IAC", label: "iac:cloudformation" };
  }

  // Package manifests and known config file names
  if (MANIFEST_NAMES.has(base)) return { type: "CONFIG.BUILD", label: `config:manifest:${base}` };
  if (/^dockerfile(\.|$)/.test(base) || (/^FROM\s+\S+/m.test(head) && /^(RUN|COPY|CMD|ENTRYPOINT|WORKDIR|EXPOSE)\b/m.test(head))) return { type: "CONFIG.BUILD", label: "config:manifest:dockerfile" };
  if (ext && CONFIG_EXT[ext]) return { type: "CONFIG.BUILD", label: `config:${CONFIG_EXT[ext]}` };
  if (format === "json" || format === "yaml" || format === "toml") return { type: "CONFIG.BUILD", label: `config:${format}` };

  // Content shape when there is no name to go by
  const trimmed = head.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    if (text.length <= MAX_PARSE_BYTES) { try { const v = JSON.parse(text); if (v && typeof v === "object") return { type: "CONFIG.BUILD", label: "config:json" }; } catch { /* not JSON */ } }
  }
  if (json && typeof json === "object") return { type: "CONFIG.BUILD", label: "config:json" };
  // Shape heuristics never run on a log: timestamped lines look like keys.
  const lines = head.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length >= 3 && !looksLikeLog(head)) {
    const tomlHeaders = lines.filter((l) => /^\s*\[[\w.\-"]+\]\s*$/.test(l)).length;
    const kvEq = lines.filter((l) => /^\s*[\w.\-]+\s*=\s*\S/.test(l)).length;
    if (tomlHeaders >= 1 && kvEq >= 2 && tomlHeaders + kvEq >= lines.length * 0.8) {
      // TOML values are typed (quoted strings, arrays, tables); INI values are bare words.
      const typed = lines.filter((l) => /^\s*[\w.\-]+\s*=\s*(\[|\{|"|'|\d|true|false)/.test(l)).length;
      return { type: "CONFIG.BUILD", label: typed >= kvEq * 0.8 ? "config:toml" : "config:ini" };
    }
    const yamlKeys = lines.filter((l) => /^\s*[A-Za-z_][\w.\-]*:\s*(\S.*)?$/.test(l) || /^\s*-\s+\S/.test(l)).length;
    if (yamlKeys >= lines.length * 0.9 && !/[;{}]\s*$/m.test(head)) return { type: "CONFIG.BUILD", label: "config:yaml" };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Embedded code: JSON string values and log lines
 * ------------------------------------------------------------------ */

const TIMESTAMP_LINE = /^\s*(\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?|\[?\d{2}:\d{2}:\d{2}|\[?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}:\d{2}|\d{10,13}\b)/;
const LOG_PREFIX = /^\s*\[?[\dT:.\-+Z ]{8,32}\]?\s*(\[?(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\]?:?\s*)?([\w.$\-]+(\[\d+\])?:\s*)?/i;
const CODE_START = /\b(function|const|let|var|import|export|class|def|fn|func|package|namespace|using|require|public|private|struct|impl|module)\b|<\?php|#include|#!\//;

/** True when the unit reads like a log: at least five lines and most of the first 200 start with a timestamp. */
export function looksLikeLog(text: string): boolean {
  const lines = text.split("\n", 200).filter((l) => l.trim());
  if (lines.length < 5) return false;
  const stamped = lines.filter((l) => TIMESTAMP_LINE.test(l)).length;
  return stamped >= lines.length * 0.5;
}

/** Walk a JSON value collecting string values ≥ EMBEDDED_JSON_MIN_CHARS with their key paths. Bounded in depth and node count. */
export function longStrings(json: unknown): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  let visited = 0;
  const walk = (v: unknown, p: string, depth: number) => {
    if (++visited > MAX_JSON_NODES || depth > MAX_JSON_DEPTH || out.length >= MAX_EMBEDDED_UNITS) return;
    if (typeof v === "string") { if (v.length >= EMBEDDED_JSON_MIN_CHARS) out.push({ path: p || "$", value: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, depth + 1)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, p ? `${p}.${k}` : k, depth + 1);
  };
  walk(json, "", 0);
  return out;
}

interface EmbeddedHit { type: string; field?: string }

function classifyEmbedded(value: string, deadline: number): string | null {
  const cfg = classifyConfig(value);
  if (cfg) return cfg.type;
  const id = identify(value, undefined, deadline);
  return id ? "SOURCE_CODE" : null;
}

function scanJsonStrings(json: unknown, deadline: number): EmbeddedHit[] {
  const hits: EmbeddedHit[] = [];
  for (const s of longStrings(json)) {
    if (performance.now() > deadline) { lastError = "parse budget exhausted while scanning embedded JSON strings; findings are partial"; break; }
    if (s.value.length > MAX_PARSE_BYTES) continue;
    const type = classifyEmbedded(s.value, deadline);
    if (type) hits.push({ type, field: s.path.replace(/\[\d+\]/g, "[]") });
  }
  return hits;
}

function scanLogLines(text: string, deadline: number): EmbeddedHit[] {
  const hits: EmbeddedHit[] = [];
  let parsed = 0;
  const lines = text.split("\n", MAX_LOG_LINES);
  for (const line of lines) {
    if (line.length < EMBEDDED_LOG_MIN_CHARS) continue;
    if (parsed >= MAX_EMBEDDED_UNITS) break;
    if (performance.now() > deadline) { lastError = "parse budget exhausted while scanning log lines; findings are partial"; break; }
    // Strip the timestamp / level / logger prefix, then start at the first code-like token.
    let body = line.replace(LOG_PREFIX, "");
    const start = body.search(CODE_START);
    if (start < 0) continue;
    body = body.slice(start);
    if (body.length < EMBEDDED_LOG_MIN_CHARS / 2) continue;
    parsed++;
    const type = classifyEmbedded(body, deadline);
    if (type) hits.push({ type });
  }
  return hits;
}

function embeddedFindings(hits: EmbeddedHit[], unitPath?: string): Finding[] {
  const byType = new Map<string, { count: number; fields: Set<string> }>();
  for (const h of hits) {
    const e = byType.get(h.type) ?? { count: 0, fields: new Set<string>() };
    e.count++;
    if (h.field) e.fields.add(h.field);
    byType.set(h.type, e);
  }
  return [...byType.entries()].map(([type, e]) => ({
    type, count: e.count, confidence: "medium" as Confidence, detector: DESCRIPTOR.id, version: DESCRIPTOR.version, label: "embedded",
    ...(e.fields.size ? { fields: [...e.fields].slice(0, 20) } : {}), ...(unitPath ? { unitPath } : {}),
  }));
}

/* ------------------------------------------------------------------ *
 * The detector
 * ------------------------------------------------------------------ */

export const detector: DetectorImpl = {
  descriptor: DESCRIPTOR,
  available() {
    if (initError) return { ok: false, reason: initError };
    if (!initialised) return { ok: false, reason: "grammars not initialised" };
    return { ok: true };
  },
  detect(input: DetectInput): Finding[] {
    lastError = null;
    if (!initialised || !parser) return [];
    try {
      const text = input.text ?? "";
      const bytes = Buffer.byteLength(text, "utf-8");
      if (bytes > MAX_PARSE_BYTES) {
        lastError = `unit of ${Math.ceil(bytes / 1024)} KiB exceeds MAX_PARSE_BYTES (${MAX_PARSE_BYTES / 1024} KiB); syntax-aware scan skipped`;
        return [];
      }
      const deadline = performance.now() + parseBudgetMs(bytes);
      const extra = input.unitPath ? { unitPath: input.unitPath } : {};
      const out: Finding[] = [];

      // 1. Structured JSON: the document is config; its long strings may hide code.
      if (input.json !== undefined && input.json !== null && typeof input.json === "object") {
        const cfg = classifyConfig(text, input.filename, input.format, input.json);
        if (cfg) out.push({ type: cfg.type, count: 1, confidence: "medium", detector: DESCRIPTOR.id, version: DESCRIPTOR.version, label: cfg.label, ...extra });
        out.push(...embeddedFindings(scanJsonStrings(input.json, deadline), input.unitPath));
        return out;
      }
      if (!text.trim()) return [];

      // 2. Config / IaC by name and shape — never SOURCE_CODE.
      const cfg = classifyConfig(text, input.filename, input.format);
      if (cfg) {
        out.push({ type: cfg.type, count: 1, confidence: "medium", detector: DESCRIPTOR.id, version: DESCRIPTOR.version, label: cfg.label, ...extra });
        const trimmed = text.trimStart();
        if (cfg.label === "config:json" || (trimmed.startsWith("{") || trimmed.startsWith("["))) {
          try { const v = JSON.parse(text); if (v && typeof v === "object") out.push(...embeddedFindings(scanJsonStrings(v, deadline), input.unitPath)); } catch { /* not JSON */ }
        }
        return out;
      }

      // 3. Logs: the unit is not code, but a line may carry some.
      if (looksLikeLog(text)) return embeddedFindings(scanLogLines(text, deadline), input.unitPath);

      // 4. Whole-unit parse.
      const id = identify(text, input.filename, deadline);
      if (id) out.push({ type: "SOURCE_CODE", count: 1, confidence: id.confidence, detector: DESCRIPTOR.id, version: DESCRIPTOR.version, label: `lang:${id.lang}`, ...extra });
      return out;
    } catch (e) {
      lastError = `code detector failed: ${(e as Error)?.message?.split("\n")[0].slice(0, 160) ?? String(e)}`;
      return [];
    }
  },
};
