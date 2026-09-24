/**
 * Secret detection v2 — the `wrapbox.secrets` detector.
 *
 * WHY this shape: a credential is the one data type that must never be
 * transformed or forwarded, so the detector's job is to be RIGHT about
 * presence and count while never letting the value itself escape. Two rule
 * corpora run through one matcher:
 *
 *   1. Gitleaks (generated `gitleaks-rules.json`, MIT) — provider-specific
 *      token shapes plus the contextual "generic" rules, applied with Gitleaks'
 *      own semantics: keyword prefilter, secretGroup isolation, Shannon-entropy
 *      floor, and stopword / regex / path allowlists.
 *   2. Wrapbox rules (below) — the families Gitleaks does not cover or covers
 *      only partially: private-key blocks by format, JWTs, connection strings,
 *      GCP service-account JSON, assigned secrets, and the AWS documentation
 *      example keys that must never count.
 *
 * Every hit becomes a Finding of a registry type with the rule id as `label`
 * and a DISTINCT-value count; a roll-up `CREDENTIAL` Finding carries the union
 * so a clause naming the family matches once. Values live in local Sets for
 * the duration of `detect()` and are never placed on a Finding, a log line or
 * `lastError`.
 *
 * No policy threshold lives here: the entropy floors are part of what makes a
 * string a *secret*, not a decision about it. `match.minCount` decides.
 *
 * Bounds: input capped at MAX_SCAN_CHARS, matches capped per rule, decoded
 * copies capped in count and bytes, and a wall-clock budget between rules.
 * V8's breadth-first fallback for excessive backtracking is switched on so a
 * pathological line cannot stall the daemon.
 */

import v8 from "node:v8";
import type { DetectorImpl, DetectInput, Finding, DetectorDescriptor, Confidence } from "@wrapbox/registry";
import { BUILTIN_DETECTORS, dataTypes, CONFIDENCE_RANK } from "@wrapbox/registry";
import corpus from "./gitleaks-rules.json" with { type: "json" };

/** Text longer than this is scanned only up to the cap (4 MiB of UTF-16 units). */
export const MAX_SCAN_CHARS = 4 * 1024 * 1024;
/** Wall-clock budget for one detect() call, checked between rules. */
export const TIME_BUDGET_MS = 3000;
/** Distinct matches examined per rule per scan text before the rule stops. */
const MAX_MATCHES_PER_RULE = 2000;
/** Bounds for the base64 / URL-decoded copies of long tokens. */
const MAX_DECODED_CANDIDATES = 64;
const MAX_DECODED_TOTAL_CHARS = 256 * 1024;
const MAX_CANDIDATE_CHARS = 64 * 1024;

try {
  // Read at regexp execution time, so setting it after VM start is effective.
  v8.setFlagsFromString("--enable-experimental-regexp-engine-on-excessive-backtracks");
} catch { /* not fatal: bounds above still apply */ }

export let lastError: string | null = null;

/* ------------------------------------------------------------------ *
 * Compiled rule model (shared by both corpora).
 * ------------------------------------------------------------------ */

interface JsRegex { source: string; flags: string }
interface Allowlist {
  condition: "OR" | "AND";
  regexTarget: "secret" | "match" | "line";
  regexes: RegExp[];
  stopwords: string[];
  paths: RegExp[];
}
interface CompiledRule {
  id: string;
  type: string;
  confidence: Confidence;
  regex: RegExp;                // always carries the g flag
  secretGroup: number;          // 0 = first non-empty group, else whole match
  entropy: number;              // secret must EXCEED this (Gitleaks); 0 = off
  minEntropy?: number;          // Wrapbox: secret must REACH this
  keywords: string[];           // lower-case prefilter; empty = always run
  allowlists: Allowlist[];
  corpus: "gitleaks" | "wrapbox";
}

function compileRegex(r: JsRegex): RegExp {
  return new RegExp(r.source, r.flags.includes("g") ? r.flags : r.flags + "g");
}
function compileAllowlist(a: typeof corpus.globalAllowlist): Allowlist {
  return {
    condition: a.condition === "AND" ? "AND" : "OR",
    regexTarget: a.regexTarget === "match" || a.regexTarget === "line" ? a.regexTarget : "secret",
    regexes: a.regexes.map((r) => new RegExp(r.source, r.flags)),
    stopwords: a.stopwords.map((s) => s.toLowerCase()),
    paths: a.paths.map((r) => new RegExp(r.source, r.flags)),
  };
}

/** Registry type for a Gitleaks rule id. Order matters: specific families before suffix heuristics. */
export function typeForGitleaksRule(id: string): string {
  if (id === "generic-api-key") return "CREDENTIAL.GENERIC_HIGH_ENTROPY";
  if (/private[-_]?key/.test(id)) {
    if (/openssh/.test(id)) return "CREDENTIAL.PRIVATE_KEY.OPENSSH";
    if (/pgp/.test(id)) return "CREDENTIAL.PRIVATE_KEY.PGP";
    if (/pem/.test(id)) return "CREDENTIAL.PRIVATE_KEY.PEM";
    return "CREDENTIAL.PRIVATE_KEY";
  }
  if (/^jwt/.test(id)) return "CREDENTIAL.TOKEN.JWT";
  if (/(?:^|-)(?:pat|token|access-token|ptt|rrt|oauth|session-cookie)(?:-|$)/.test(id)) return "CREDENTIAL.TOKEN";
  if (/api-key|(?:^|-)key(?:-|$)/.test(id)) return "CREDENTIAL.API_KEY";
  if (/(?:^|-)(?:client-)?secret(?:-|$)/.test(id)) return "CREDENTIAL.CLIENT_SECRET";
  if (/(?:^|-)password(?:-|$)/.test(id)) return "CREDENTIAL.PASSWORD";
  return "CREDENTIAL.API_KEY";
}

/** Gitleaks' contextual preamble: the secret is only identified by a nearby keyword, so the shape alone is generic. */
const CONTEXTUAL_PREAMBLE = /^\[\\w\.\-\]\{0,50\}\?/;
function confidenceForGitleaksRule(id: string, regexSource: string): Confidence {
  if (id.startsWith("generic")) return "medium";
  if (CONTEXTUAL_PREAMBLE.test(regexSource)) return "medium";
  return "high";
}

/* ------------------------------------------------------------------ *
 * Wrapbox rules — families Gitleaks does not isolate, or isolates without
 * the registry sub-type. Fake-safe: every regex is anchored on structure.
 * ------------------------------------------------------------------ */

const PRIVATE_KEY_BODY = String.raw`[\s\S]{0,16000}?-----END[ A-Z0-9_-]{0,40}PRIVATE KEY(?: BLOCK)?-----`;
const CONN_SCHEMES = String.raw`(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql)`;

interface WrapboxRuleSpec {
  id: string; type: string; confidence: Confidence; regex: RegExp;
  secretGroup?: number; minEntropy?: number; keywords: string[];
}
const WRAPBOX_RULES: WrapboxRuleSpec[] = [
  { id: "wrapbox-private-key-pem", type: "CREDENTIAL.PRIVATE_KEY.PEM", confidence: "high", keywords: ["-----begin"],
    regex: new RegExp(String.raw`-----BEGIN (?:(?:RSA|EC|DSA|ENCRYPTED) )?PRIVATE KEY-----(?:${PRIVATE_KEY_BODY})?`, "g") },
  { id: "wrapbox-private-key-openssh", type: "CREDENTIAL.PRIVATE_KEY.OPENSSH", confidence: "high", keywords: ["-----begin openssh"],
    regex: new RegExp(String.raw`-----BEGIN OPENSSH PRIVATE KEY-----(?:${PRIVATE_KEY_BODY})?`, "g") },
  { id: "wrapbox-private-key-pgp", type: "CREDENTIAL.PRIVATE_KEY.PGP", confidence: "high", keywords: ["-----begin pgp"],
    regex: new RegExp(String.raw`-----BEGIN PGP PRIVATE KEY BLOCK-----(?:${PRIVATE_KEY_BODY})?`, "g") },
  { id: "wrapbox-putty-private-key", type: "CREDENTIAL.PRIVATE_KEY", confidence: "high", keywords: ["putty-user-key-file"],
    regex: /PuTTY-User-Key-File-\d+:[^\n]{0,80}(?:\n(?:Private-Lines:[^\n]*\n(?:[A-Za-z0-9+/=]{1,80}\n){1,200})|[\s\S]{0,4000}?Private-MAC:[^\n]*)?/g },
  { id: "wrapbox-jwt", type: "CREDENTIAL.TOKEN.JWT", confidence: "high", keywords: ["eyj"],
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g },
  { id: "wrapbox-connection-string-url", type: "CREDENTIAL.CONNECTION_STRING", confidence: "high",
    keywords: ["postgres", "mysql://", "mongodb", "redis://", "amqp://", "mssql://"],
    regex: new RegExp(String.raw`\b${CONN_SCHEMES}://[^\s:@/'"]{1,128}:([^\s@/'"]{1,256})@[^\s'"]{1,512}`, "gi"), secretGroup: 1 },
  { id: "wrapbox-connection-string-kv", type: "CREDENTIAL.CONNECTION_STRING", confidence: "high", keywords: ["server=", "data source="],
    regex: /\b(?:Server|Data Source)\s*=\s*[^;\n]{1,200};(?:[^;\n]{1,200};){0,12}\s*(?:Password|Pwd)\s*=\s*([^;\s'"]{3,256})/gi, secretGroup: 1 },
  { id: "wrapbox-azure-account-key", type: "CREDENTIAL.CONNECTION_STRING", confidence: "high", keywords: ["accountkey="],
    regex: /\bAccountKey\s*=\s*([A-Za-z0-9+/]{40,}={0,2})/g, secretGroup: 1 },
  { id: "wrapbox-azure-sas", type: "CREDENTIAL.TOKEN", confidence: "high", keywords: ["sharedaccesssignature=", "sig="],
    regex: /(?:\bSharedAccessSignature\s*=\s*[^\s'"]*?sig=|(?:^|[?&;])sig=)([A-Za-z0-9%+/]{20,}(?:%3[dD]|=){0,2})/gm, secretGroup: 1 },
  { id: "wrapbox-gcp-service-account", type: "CREDENTIAL.CLOUD_SERVICE_ACCOUNT", confidence: "high", keywords: ["service_account"],
    // Requires the "type": "service_account" marker somewhere in the same object (either order) and isolates the key.
    regex: /"type"\s*:\s*"service_account"[\s\S]{0,4000}?"private_key"\s*:\s*"(-----BEGIN[^"]{40,16000}?)"|"private_key"\s*:\s*"(-----BEGIN[^"]{40,16000}?)"[\s\S]{0,4000}?"type"\s*:\s*"service_account"/g },
  { id: "wrapbox-assigned-secret", type: "CREDENTIAL.GENERIC_HIGH_ENTROPY", confidence: "medium", minEntropy: 3.0,
    keywords: ["api_key", "apikey", "api-key", "secret", "password", "passwd", "token", "access_key", "accesskey", "access-key"],
    regex: /[\w.-]{0,40}?(?:api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|token|access[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{16,512})["']/gi, secretGroup: 1 },
];

/** Applied to every rule of both corpora: documentation samples never count. */
const WRAPBOX_STOPWORDS = [
  "akiaiosfodnn7example",
  "wjalrxutnfemi/k7mdeng/bpxrficyexamplekey",
];

/* ------------------------------------------------------------------ *
 * Compile at import time. A bad corpus surfaces through available().
 * ------------------------------------------------------------------ */

let RULES: CompiledRule[] = [];
let GLOBAL_ALLOWLIST: Allowlist = { condition: "OR", regexTarget: "secret", regexes: [], stopwords: [], paths: [] };
let compileError: string | null = null;

function compileAll(): void {
  const types = dataTypes();
  const out: CompiledRule[] = [];
  GLOBAL_ALLOWLIST = compileAllowlist(corpus.globalAllowlist);
  for (const r of corpus.rules) {
    const type = typeForGitleaksRule(r.id);
    if (!types.has(type)) throw new Error(`rule ${r.id} maps to unknown registry type ${type}`);
    out.push({
      id: r.id, type, confidence: confidenceForGitleaksRule(r.id, r.regex.source),
      regex: compileRegex(r.regex), secretGroup: r.secretGroup, entropy: r.entropy,
      keywords: r.keywords, allowlists: r.allowlists.map(compileAllowlist), corpus: "gitleaks",
    });
  }
  for (const w of WRAPBOX_RULES) {
    if (!types.has(w.type)) throw new Error(`wrapbox rule ${w.id} maps to unknown registry type ${w.type}`);
    out.push({
      id: w.id, type: w.type, confidence: w.confidence, regex: w.regex, secretGroup: w.secretGroup ?? 0,
      entropy: 0, ...(w.minEntropy !== undefined ? { minEntropy: w.minEntropy } : {}),
      keywords: w.keywords.map((k) => k.toLowerCase()), allowlists: [], corpus: "wrapbox",
    });
  }
  RULES = out;
}
try { compileAll(); } catch (e) { compileError = `secret rule corpus failed to compile: ${(e as Error).message ?? e}`; }

/** Ids of every rule in force (for capability reporting and tests). */
export function ruleIds(): string[] { return RULES.map((r) => r.id); }
/** Rules the build step could not translate; surfaced, never hidden. */
export const unsupportedRules: ReadonlyArray<{ id: string; error: string }> = corpus.unsupported.map((u) => ({ id: u.id, error: u.error }));

/* ------------------------------------------------------------------ *
 * Matching primitives.
 * ------------------------------------------------------------------ */

/** Shannon entropy, base 2, over the characters of `s` (Gitleaks semantics). */
export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) { const p = n / s.length; e -= p * Math.log2(p); }
  return e;
}

/** The secret a match isolates: the configured group, else the first non-empty group, else the whole match. */
function secretOf(m: RegExpMatchArray, secretGroup: number): string {
  if (secretGroup > 0) return m[secretGroup] ?? "";
  for (let i = 1; i < m.length; i++) if (m[i]) return m[i]!;
  return m[0];
}

/** Distinctness key: a percent-encoded value and its decoded copy are the same secret. */
function canonicalSecret(secret: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(secret)) return secret;
  try { return decodeURIComponent(secret); } catch { return secret; }
}

function lineAround(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1, index - 1000);
  let end = text.indexOf("\n", index + length);
  if (end < 0) end = text.length;
  return text.slice(start, Math.min(end, index + length + 1000));
}

function allowlistClears(a: Allowlist, secret: string, match: string, line: string, filename: string | undefined): boolean {
  const target = a.regexTarget === "line" ? line : a.regexTarget === "match" ? match : secret;
  const checks: boolean[] = [];
  if (a.regexes.length) checks.push(a.regexes.some((re) => re.test(target)));
  if (a.stopwords.length) { const low = secret.toLowerCase(); checks.push(a.stopwords.some((w) => low.includes(w))); }
  if (a.paths.length) checks.push(filename !== undefined && a.paths.some((re) => re.test(filename)));
  if (!checks.length) return false;
  return a.condition === "AND" ? checks.every(Boolean) : checks.some(Boolean);
}

function isAllowed(rule: CompiledRule, secret: string, match: string, line: string, filename: string | undefined): boolean {
  const low = secret.toLowerCase();
  if (WRAPBOX_STOPWORDS.some((w) => low.includes(w))) return true;
  if (allowlistClears(GLOBAL_ALLOWLIST, secret, match, line, filename)) return true;
  return rule.allowlists.some((a) => allowlistClears(a, secret, match, line, filename));
}

/* ------------------------------------------------------------------ *
 * Encoded copies: a token pasted base64- or URL-encoded is still a token.
 * ------------------------------------------------------------------ */

function printableRatio(s: string): number {
  if (!s) return 0;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d) ok++;
  }
  return ok / s.length;
}

function decodedCopies(text: string): string[] {
  const out: string[] = [];
  let total = 0;
  let seen = 0;
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{40,}={0,2}/g)) {
    if (++seen > MAX_DECODED_CANDIDATES || total > MAX_DECODED_TOTAL_CHARS) break;
    const c = m[0].slice(0, MAX_CANDIDATE_CHARS);
    let d: string;
    try { d = Buffer.from(c, "base64").toString("utf8"); } catch { continue; }
    if (d.length < 16 || printableRatio(d) < 0.9) continue;
    out.push(d); total += d.length;
  }
  seen = 0;
  for (const m of text.matchAll(/[A-Za-z0-9%._~:/?#@!$&'()*+,;=-]{40,}/g)) {
    if (!/%[0-9A-Fa-f]{2}/.test(m[0])) continue;
    if (++seen > MAX_DECODED_CANDIDATES || total > MAX_DECODED_TOTAL_CHARS) break;
    let d: string;
    try { d = decodeURIComponent(m[0].slice(0, MAX_CANDIDATE_CHARS)); } catch { continue; }
    if (d === m[0]) continue;
    out.push(d); total += d.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Input normalisation.
 * ------------------------------------------------------------------ */

function textOf(input: DetectInput): string {
  if (typeof input.text === "string") return input.text;
  if (input.table) return [input.table.headers.join("\t"), ...input.table.rows.map((r) => r.join("\t"))].join("\n");
  if (input.json !== undefined) { try { return JSON.stringify(input.json); } catch { return ""; } }
  if (input.metadata) return Object.entries(input.metadata).map(([k, v]) => `${k}=${v}`).join("\n");
  return "";
}

/* ------------------------------------------------------------------ *
 * The detector.
 * ------------------------------------------------------------------ */

const base: DetectorDescriptor = BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.secrets")!;
const descriptor: DetectorDescriptor = {
  ...base,
  emits: [
    { type: "CREDENTIAL", confidence: "high" },
    { type: "CREDENTIAL.PRIVATE_KEY", confidence: "high" },
    { type: "CREDENTIAL.TOKEN", confidence: "high" },
    { type: "CREDENTIAL.TOKEN.JWT", confidence: "high" },
    { type: "CREDENTIAL.API_KEY", confidence: "high" },
    { type: "CREDENTIAL.CLIENT_SECRET", confidence: "high" },
    { type: "CREDENTIAL.PASSWORD", confidence: "high" },
    { type: "CREDENTIAL.CONNECTION_STRING", confidence: "high" },
    { type: "CREDENTIAL.CLOUD_SERVICE_ACCOUNT", confidence: "high" },
    { type: "CREDENTIAL.GENERIC_HIGH_ENTROPY", confidence: "medium" },
  ],
  provenance: { source: `${corpus.source} + Wrapbox rules`, license: corpus.license, ref: corpus.ref },
};

function runRules(text: string, filename: string | undefined, deadline: number, perRule: Map<string, Set<string>>): { timedOut: boolean; rulesRun: number } {
  const lower = text.toLowerCase();
  let rulesRun = 0;
  for (const rule of RULES) {
    if (Date.now() > deadline) return { timedOut: true, rulesRun };
    if (rule.keywords.length && !rule.keywords.some((k) => lower.includes(k))) continue;
    rulesRun++;
    let set = perRule.get(rule.id);
    let n = 0;
    rule.regex.lastIndex = 0;
    for (const m of text.matchAll(rule.regex)) {
      if (++n > MAX_MATCHES_PER_RULE) break;
      const secret = secretOf(m, rule.secretGroup).trim();
      if (!secret) continue;
      if (rule.entropy > 0 && shannonEntropy(secret) <= rule.entropy) continue;
      if (rule.minEntropy !== undefined && shannonEntropy(secret) < rule.minEntropy) continue;
      if (isAllowed(rule, secret, m[0], lineAround(text, m.index ?? 0, m[0].length), filename)) continue;
      if (!set) { set = new Set(); perRule.set(rule.id, set); }
      set.add(canonicalSecret(secret));
    }
  }
  return { timedOut: false, rulesRun };
}

export const detector: DetectorImpl = {
  descriptor,
  available() {
    if (compileError) return { ok: false, reason: compileError };
    if (!RULES.length) return { ok: false, reason: "no secret rules loaded" };
    return { ok: true };
  },
  detect(input: DetectInput): Finding[] {
    lastError = null;
    try {
      if (compileError) { lastError = compileError; return []; }
      const raw = textOf(input);
      if (!raw) return [];
      const text = raw.length > MAX_SCAN_CHARS ? raw.slice(0, MAX_SCAN_CHARS) : raw;
      const deadline = Date.now() + TIME_BUDGET_MS;
      const perRule = new Map<string, Set<string>>();

      let r = runRules(text, input.filename, deadline, perRule);
      if (!r.timedOut) {
        for (const copy of decodedCopies(text)) {
          r = runRules(copy, input.filename, deadline, perRule);
          if (r.timedOut) break;
        }
      }
      if (r.timedOut) lastError = `secret scan exceeded ${TIME_BUDGET_MS}ms budget; findings are partial`;

      const findings: Finding[] = [];
      const union = new Set<string>();
      let top: Confidence | null = null;
      for (const rule of RULES) {
        const set = perRule.get(rule.id);
        if (!set?.size) continue;
        for (const s of set) union.add(s);
        if (!top || CONFIDENCE_RANK[rule.confidence] > CONFIDENCE_RANK[top]) top = rule.confidence;
        const f: Finding = { type: rule.type, count: set.size, confidence: rule.confidence, detector: descriptor.id, version: descriptor.version, label: rule.id };
        if (input.unitPath) f.unitPath = input.unitPath;
        if (input.table) {
          const cols = columnsHolding(input.table, set);
          if (cols.length) f.fields = cols;
        }
        findings.push(f);
      }
      if (union.size) {
        const roll: Finding = { type: "CREDENTIAL", count: union.size, confidence: top ?? "medium", detector: descriptor.id, version: descriptor.version, label: "credential" };
        if (input.unitPath) roll.unitPath = input.unitPath;
        findings.push(roll);
      }
      return findings;
    } catch (e) {
      lastError = `secret detector failed: ${(e as Error)?.message ?? String(e)}`;
      return [];
    }
  },
};

/** Header names of the columns whose cells contain one of the secrets (bounded). */
function columnsHolding(table: { headers: string[]; rows: string[][] }, secrets: Set<string>): string[] {
  const sample = [...secrets].slice(0, 50);
  const out: string[] = [];
  const cols = Math.min(table.headers.length, 256);
  for (let c = 0; c < cols; c++) {
    let hit = false;
    for (let r = 0; r < table.rows.length && r < 10000 && !hit; r++) {
      const cell = table.rows[r]?.[c];
      if (cell && sample.some((s) => cell.includes(s))) hit = true;
    }
    if (hit) out.push(table.headers[c] ?? `col${c}`);
  }
  return out;
}
