/**
 * Build the Gitleaks rule corpus into a JavaScript-ready JSON artifact.
 *
 * WHY a build step: the vendored `gitleaks.toml` is authored for Go's RE2
 * engine. Most of its syntax is JavaScript-compatible, but a handful of
 * constructs are not (`(?i)` flag prefixes anywhere in the pattern, `(?P<name>`
 * groups, POSIX `[[:alnum:]]` classes, `\z`). Translating at runtime on every
 * daemon start would repeat the same work and — worse — could silently drop a
 * rule if a translation regressed. Doing it once here, and RECORDING every rule
 * that still fails `new RegExp()` under `unsupported`, keeps the corpus honest:
 * evidence can say exactly which rules were in force and which were not.
 *
 * Input:  runtime/vendor/gitleaks/gitleaks.toml (MIT — see LICENSE beside it).
 * Output: runtime/src/detectors/gitleaks-rules.json (committed, generated).
 *
 * Run:    cd runtime && npx tsx scripts/build-gitleaks-rules.mts
 *
 * Nothing here decides policy. Entropy thresholds and allowlists are carried
 * through verbatim so the detector applies Gitleaks semantics unchanged; the
 * clause's `match.minCount` is still the only policy threshold.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../vendor/gitleaks/gitleaks.toml");
const OUTPUT = path.resolve(here, "../src/detectors/gitleaks-rules.json");

/** Provenance of the vendored corpus (recorded in the artifact header). */
const PROVENANCE = {
  source: "gitleaks/gitleaks config/gitleaks.toml",
  license: "MIT",
  ref: "master b58d3f10 (2026-07-22)",
};

/* ------------------------------------------------------------------ *
 * Shapes — what the TOML holds and what the detector consumes.
 * ------------------------------------------------------------------ */

interface TomlAllowlist {
  description?: string;
  condition?: string;
  regexTarget?: string;
  regexes?: string[];
  stopwords?: string[];
  paths?: string[];
}
interface TomlRule {
  id: string;
  description?: string;
  regex?: string;
  secretGroup?: number;
  entropy?: number;
  keywords?: string[];
  path?: string;
  allowlists?: TomlAllowlist[];
  allowlist?: TomlAllowlist;
}

/** A regex as the detector will construct it: `new RegExp(source, flags)`. */
export interface JsRegex { source: string; flags: string }

export interface BuiltAllowlist {
  /** "OR" (default): any criterion clears the hit; "AND": every present criterion must clear it. */
  condition: "OR" | "AND";
  /** What the regexes run against: the isolated secret (default), the whole match, or the line. */
  regexTarget: "secret" | "match" | "line";
  regexes: JsRegex[];
  /** Lower-cased; a secret containing any of them is ignored. */
  stopwords: string[];
  /** Matched against the unit's filename / path when one is known. */
  paths: JsRegex[];
}

export interface BuiltRule {
  id: string;
  description: string;
  regex: JsRegex;
  /** Capture group holding the secret; 0 = first non-empty group, else the whole match. */
  secretGroup: number;
  /** Shannon entropy (base 2) the secret must EXCEED; 0 = no entropy check. */
  entropy: number;
  /** Lower-cased prefilter: the rule runs only if one of these appears in the text. Empty = always run. */
  keywords: string[];
  allowlists: BuiltAllowlist[];
}

export interface GitleaksRulesArtifact {
  source: string;
  license: string;
  ref: string;
  generatedAt: string;
  supported: number;
  unsupported: Array<{ id: string; regex: string; error: string }>;
  globalAllowlist: BuiltAllowlist;
  rules: BuiltRule[];
}

/* ------------------------------------------------------------------ *
 * RE2 → JavaScript translation.
 * ------------------------------------------------------------------ */

const POSIX_CLASSES: Record<string, string> = {
  alnum: "A-Za-z0-9", alpha: "A-Za-z", digit: "0-9", xdigit: "0-9A-Fa-f",
  upper: "A-Z", lower: "a-z", space: " \\t\\r\\n\\v\\f", blank: " \\t",
  word: "\\w", punct: "!-\\/:-@\\[-`{-~", cntrl: "\\x00-\\x1f\\x7f",
  print: "\\x20-\\x7e", graph: "\\x21-\\x7e", ascii: "\\x00-\\x7f",
};

/**
 * Rewrite a bare `(?flags)` (Go: "apply to the rest of the enclosing group")
 * into a JavaScript modifier group `(?flags:…)` spanning the rest of that group.
 * Node 26 supports `(?i:…)`, `(?-i:…)`, `(?s:…)` natively; only the bare form
 * needs help. A leading `(?i)` at position 0 is lifted into the flags instead.
 */
function rewriteBareFlagGroups(src: string): { source: string; flags: Set<string> } {
  const flags = new Set<string>();
  let s = src;
  const lead = /^\(\?([a-zA-Z]+)\)/.exec(s);
  if (lead) {
    for (const f of lead[1]) flags.add(f);
    s = s.slice(lead[0].length);
  }
  // Walk the pattern tracking escapes, classes and group depth.
  let out = "";
  let i = 0;
  let inClass = false;
  // Stack of pending "close this modifier group before this group's ')'" counters, one per open group.
  const pending: number[] = [0];
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { out += s.slice(i, i + 2); i += 2; continue; }
    if (inClass) { if (c === "]") inClass = false; out += c; i++; continue; }
    if (c === "[") { inClass = true; out += c; i++; continue; }
    if (c === "(") {
      const bare = /^\(\?([a-zA-Z-]+)\)/.exec(s.slice(i));
      if (bare) {
        out += `(?${bare[1]}:`;
        pending[pending.length - 1]++;
        i += bare[0].length;
        continue;
      }
      pending.push(0);
      out += c; i++; continue;
    }
    if (c === ")") {
      const n = pending.pop() ?? 0;
      out += ")".repeat(n) + c;
      i++; continue;
    }
    out += c; i++;
  }
  out += ")".repeat(pending.pop() ?? 0);
  return { source: out, flags };
}

/** Translate one RE2 pattern to a JavaScript source + flags. Throws when JS still rejects it. */
export function translateRegex(re2: string): JsRegex {
  let s = re2;
  s = s.replace(/\(\?P</g, "(?<");
  s = s.replace(/\[:([a-z]+):\]/g, (m, name: string) => POSIX_CLASSES[name] ?? m);
  s = s.replace(/(^|[^\\])\\z/g, "$1$");
  s = s.replace(/(^|[^\\])\\A/g, "$1^");
  const { source, flags } = rewriteBareFlagGroups(s);
  // Go's `s` is JS `s` (dotAll); `m` is `m`; `i` is `i`. `U` (ungreedy) has no JS equivalent.
  for (const f of flags) if (!"ims".includes(f)) throw new Error(`unsupported inline flag (?${f})`);
  const flagStr = [...flags].sort().join("");
  new RegExp(source, flagStr); // throws SyntaxError when JS cannot compile it
  return { source, flags: flagStr };
}

/* ------------------------------------------------------------------ *
 * Build.
 * ------------------------------------------------------------------ */

function buildAllowlist(a: TomlAllowlist, ruleId: string, unsupported: GitleaksRulesArtifact["unsupported"]): BuiltAllowlist {
  const conv = (list: string[] | undefined, what: string): JsRegex[] => {
    const out: JsRegex[] = [];
    for (const r of list ?? []) {
      try { out.push(translateRegex(r)); }
      catch (e) { unsupported.push({ id: `${ruleId} (allowlist ${what})`, regex: r, error: String((e as Error).message ?? e) }); }
    }
    return out;
  };
  const target = a.regexTarget === "match" || a.regexTarget === "line" ? a.regexTarget : "secret";
  return {
    condition: a.condition?.toUpperCase() === "AND" ? "AND" : "OR",
    regexTarget: target,
    regexes: conv(a.regexes, "regexes"),
    stopwords: (a.stopwords ?? []).map((w) => w.toLowerCase()),
    paths: conv(a.paths, "paths"),
  };
}

function build(): GitleaksRulesArtifact {
  const raw = fs.readFileSync(SOURCE, "utf8");
  const doc = parseToml(raw) as { allowlist?: TomlAllowlist; allowlists?: TomlAllowlist[]; rules?: TomlRule[] };
  const unsupported: GitleaksRulesArtifact["unsupported"] = [];
  const rules: BuiltRule[] = [];

  for (const r of doc.rules ?? []) {
    if (!r.id) continue;
    if (!r.regex) {
      // Path-only rules (no regex) cannot run on content; record them rather than pretend.
      unsupported.push({ id: r.id, regex: "", error: "rule has no regex (path-only rule)" });
      continue;
    }
    let regex: JsRegex;
    try { regex = translateRegex(r.regex); }
    catch (e) {
      unsupported.push({ id: r.id, regex: r.regex, error: String((e as Error).message ?? e) });
      continue;
    }
    const lists = [...(r.allowlists ?? []), ...(r.allowlist ? [r.allowlist] : [])];
    rules.push({
      id: r.id,
      description: r.description ?? "",
      regex,
      secretGroup: Number.isInteger(r.secretGroup) ? Number(r.secretGroup) : 0,
      entropy: typeof r.entropy === "number" ? r.entropy : 0,
      keywords: (r.keywords ?? []).map((k) => k.toLowerCase()),
      allowlists: lists.map((a) => buildAllowlist(a, r.id, unsupported)),
    });
  }

  const globalSrc = doc.allowlist ?? (doc.allowlists ?? [])[0] ?? {};
  const globalAllowlist = buildAllowlist(globalSrc, "<global>", unsupported);

  return {
    ...PROVENANCE,
    generatedAt: new Date().toISOString(),
    supported: rules.length,
    unsupported,
    globalAllowlist,
    rules,
  };
}

const artifact = build();
fs.writeFileSync(OUTPUT, JSON.stringify(artifact, null, 1) + "\n");
console.log(`gitleaks rules: ${artifact.supported} supported, ${artifact.unsupported.length} unsupported → ${path.relative(process.cwd(), OUTPUT)}`);
for (const u of artifact.unsupported) console.log(`  unsupported ${u.id}: ${u.error}`);
