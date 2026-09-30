/**
 * Built-in detectors — the ones that ship inside the daemon and need no
 * configuration. Each implements the registry's DetectorImpl contract:
 * it emits registry TYPES with a count of DISTINCT values and a confidence,
 * never a value, and never a policy threshold (the clause decides).
 *
 * These replace the fixed SECRET_PATTERNS / PII_PATTERNS / CODE_SIGNALS blocks
 * that used to live in classify.ts. The multi-signal framework in
 * classifiers.ts stays as the implementation of the FINANCIAL / PHI / LEGAL /
 * confidentiality-marking detectors; it is wrapped here so it speaks the same
 * contract as everything else.
 */

import { BUILTIN_DETECTORS, dataTypes, type DetectInput, type DetectorImpl, type Finding, type Confidence } from "@wrapbox/registry";
import { classifyExtended } from "../classifiers.js";

const MAX_TEXT = 4 * 1024 * 1024;
const desc = (id: string) => {
  const d = BUILTIN_DETECTORS.find((x) => x.id === id);
  if (!d) throw new Error(`no built-in descriptor ${id}`);
  return d;
};

/** Count DISTINCT normalised matches of a global regex, with an optional validator. */
function distinct(re: RegExp, text: string, validate?: (m: string) => boolean, normalise = (m: string) => m.replace(/[\s.-]/g, "").toLowerCase()): number {
  re.lastIndex = 0;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 20000) {
    if (!validate || validate(m[0])) seen.add(normalise(m[0]));
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return seen.size;
}

function finding(det: DetectorImpl, type: string, count: number, confidence: Confidence, extra: Partial<Finding> = {}): Finding {
  return { type, count, confidence, detector: det.descriptor.id, version: det.descriptor.version, ...extra };
}

/* ------------------------------------------------------------------ *
 * Checksums
 * ------------------------------------------------------------------ */

export function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN mod-97 (ISO 13616). */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** US ABA routing number checksum (3-7-1 weights). */
export function abaValid(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 9) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (d.charCodeAt(i) - 48) * w[i];
  return sum % 10 === 0 && !/^0{9}$/.test(d);
}

/** SSA allocation rules: no 000/666/9xx area, no 00 group, no 0000 serial. */
export function ssnPlausible(raw: string): boolean {
  const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(raw.trim());
  if (!m) return false;
  const [area, group, serial] = [m[1], m[2], m[3]];
  if (area === "000" || area === "666" || area.startsWith("9")) return false;
  if (group === "00" || serial === "0000") return false;
  if (/^(123-45-6789|078-05-1120)$/.test(raw)) return false;   // the two famous samples
  return true;
}

/** Verhoeff checksum — Aadhaar's check digit. Stops a 16-digit card number from reading as a national id. */
export function verhoeffValid(raw: string): boolean {
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  const rev = digits.split("").reverse().map(Number);
  for (let i = 0; i < rev.length; i++) c = d[c][p[i % 8][rev[i]]];
  return c === 0;
}

function ipv4Valid(raw: string): boolean {
  return raw.split(".").every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255) && !raw.startsWith("0.");
}

/* ------------------------------------------------------------------ *
 * Pattern PII
 * ------------------------------------------------------------------ */

const PII_PATTERNS: Array<{ type: string; re: RegExp; confidence: Confidence; validate?: (m: string) => boolean; countsAsPii: boolean }> = [
  { type: "PII.CONTACT.EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g, confidence: "high", countsAsPii: true },
  // Separators or an international prefix are required: a bare ten-digit run is an id, not a phone.
  { type: "PII.CONTACT.PHONE", re: /(?<![\d.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\d.])/g, confidence: "medium", countsAsPii: true },
  { type: "GOV_ID.US.SSN", re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, confidence: "medium", validate: ssnPlausible, countsAsPii: true },
  { type: "GOV_ID.IN.AADHAAR", re: /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?![\d -])/g, confidence: "medium", validate: verhoeffValid, countsAsPii: true },
  { type: "PCI.PAN", re: /(?<![\d.])(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011|65\d{2}|3(?:0[0-5]|[68]\d)\d)[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}(?![\d.])/g, confidence: "high", validate: luhn, countsAsPii: true },
  { type: "FINANCIAL.ACCOUNT.IBAN", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, confidence: "high", validate: ibanValid, countsAsPii: true },
  { type: "FINANCIAL.ACCOUNT.US_ABA", re: /\b(?:routing|aba|rtn)\W{0,12}(\d{9})\b/gi, confidence: "medium", validate: (m) => abaValid(m.slice(-9)), countsAsPii: true },
  { type: "PII.ONLINE.IP_ADDRESS", re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, confidence: "high", validate: ipv4Valid, countsAsPii: false },
  { type: "PII.IDENTITY.DOB", re: /\b(?:19[2-9]\d|20[0-2]\d)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b|\b(?:0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2])\/(?:19[2-9]\d|20[0-2]\d)\b/g, confidence: "low", countsAsPii: false },
];

export const patternPii: DetectorImpl = {
  descriptor: desc("wrapbox.pattern.pii"),
  available: () => ({ ok: true }),
  detect(input: DetectInput): Finding[] {
    const text = (input.text ?? "").slice(0, MAX_TEXT);
    if (!text) return [];
    const out: Finding[] = [];
    let piiTotal = 0;
    for (const p of PII_PATTERNS) {
      const n = distinct(p.re, text, p.validate);
      if (n > 0) {
        out.push(finding(patternPii, p.type, n, p.confidence, input.unitPath ? { unitPath: input.unitPath } : {}));
        if (p.countsAsPii) piiTotal += n;
      }
    }
    const bulk = dataTypes().defaults("PII.BULK").bulkCount ?? 5;
    if (piiTotal >= bulk) out.push(finding(patternPii, "PII.BULK", piiTotal, "high", input.unitPath ? { unitPath: input.unitPath } : {}));
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Built-in secrets (the prefix-anchored provider rules that shipped first).
 * The secrets-v2 plugin (Gitleaks corpus + entropy) supersedes this when it
 * loads; both may run — findings are merged by type, max count wins.
 * ------------------------------------------------------------------ */

const AWS_DOC_EXAMPLE_KEY = /^(?:AKIAIOSFODNN7EXAMPLE|AKIAI44QH8DHBEXAMPLE)$/;
const SECRET_PATTERNS: Array<{ label: string; type: string; re: RegExp; validate?: (m: string) => boolean }> = [
  { label: "private_key", type: "CREDENTIAL.PRIVATE_KEY.PEM", re: /-----BEGIN\s+(?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
  { label: "openssh_private_key", type: "CREDENTIAL.PRIVATE_KEY.OPENSSH", re: /-----BEGIN OPENSSH PRIVATE KEY-----/g },
  { label: "pgp_private_key", type: "CREDENTIAL.PRIVATE_KEY.PGP", re: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g },
  { label: "aws_access_key", type: "CREDENTIAL.API_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, validate: (m) => !AWS_DOC_EXAMPLE_KEY.test(m) },
  { label: "github_token", type: "CREDENTIAL.TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { label: "slack_token", type: "CREDENTIAL.TOKEN", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "openai_key", type: "CREDENTIAL.API_KEY", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { label: "anthropic_key", type: "CREDENTIAL.API_KEY", re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g },
  { label: "google_api_key", type: "CREDENTIAL.API_KEY", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "stripe_key", type: "CREDENTIAL.API_KEY", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { label: "jwt", type: "CREDENTIAL.TOKEN.JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: "bearer_token", type: "CREDENTIAL.TOKEN", re: /\bBearer\s+[A-Za-z0-9._-]{24,}/g },
  { label: "assigned_secret", type: "CREDENTIAL.GENERIC_HIGH_ENTROPY", re: /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?key)\b\s*[:=]\s*["'][^"'\s]{16,}["']/gi },
];

export const secretsBuiltin: DetectorImpl = {
  descriptor: { ...desc("wrapbox.secrets"), id: "wrapbox.secrets.builtin", version: "1.2.0", label: "Credentials (built-in provider rules)" },
  available: () => ({ ok: true }),
  detect(input: DetectInput): Finding[] {
    const text = (input.text ?? "").slice(0, MAX_TEXT);
    if (!text) return [];
    const out: Finding[] = [];
    let total = 0;
    for (const p of SECRET_PATTERNS) {
      const n = distinct(p.re, text, p.validate, (m) => m);
      if (n > 0) { out.push(finding(secretsBuiltin, p.type, n, "high", { label: p.label, ...(input.unitPath ? { unitPath: input.unitPath } : {}) })); total += n; }
    }
    if (total > 0) out.push(finding(secretsBuiltin, "CREDENTIAL", total, "high", input.unitPath ? { unitPath: input.unitPath } : {}));
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * Credential files by name (metadata input: filenames)
 * ------------------------------------------------------------------ */

const CREDENTIAL_FILENAMES: RegExp[] = [
  /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)\.?(aws|gcloud|kube)\/(credentials|config)$/i,
  /\.(pem|key|p12|pfx|keystore|jks|ppk)$/i,
  /(^|\/)(credentials|secrets?)\.(json|ya?ml|toml)$/i,
  /(^|\/)service-account.*\.json$/i,
  /(^|\/)\.?(netrc|htpasswd|pgpass)$/i,
];

export const credentialFile: DetectorImpl = {
  descriptor: desc("wrapbox.credential_file"),
  available: () => ({ ok: true }),
  detect(input: DetectInput): Finding[] {
    const names = [input.filename ?? "", ...String(input.metadata?.filenames ?? "").split(",")].map((s) => s.trim()).filter(Boolean);
    const hits = [...new Set(names.filter((n) => CREDENTIAL_FILENAMES.some((re) => re.test(n))))];
    if (!hits.length) return [];
    return [
      finding(credentialFile, "CREDENTIAL.CREDENTIAL_FILE", hits.length, "high", { label: hits.map((h) => h.slice(0, 64)).join(","), ...(input.unitPath ? { unitPath: input.unitPath } : {}) }),
      finding(credentialFile, "CREDENTIAL", hits.length, "high", input.unitPath ? { unitPath: input.unitPath } : {}),
    ];
  },
};

/* ------------------------------------------------------------------ *
 * Source code — heuristic fallback (the tree-sitter plugin is the primary).
 * A config-file extension is CONFIG evidence, not code evidence (audit H9).
 * ------------------------------------------------------------------ */

const CODE_SIGNALS: { re: RegExp; weight: number }[] = [
  { re: /^#!\s*\/(?:usr\/)?bin\//m, weight: 3 },
  { re: /\b(?:import|from)\s+[\w.{}/*'"@-]+\s*(?:import|from)?\b/m, weight: 2 },
  { re: /\bfunc(?:tion)?\s+\w+\s*\(/m, weight: 2 },
  { re: /\b(?:def|class|interface|struct|enum)\s+\w+\s*[(:{]/m, weight: 2 },
  { re: /\b(?:const|let|var)\s+\w+\s*=/m, weight: 1 },
  { re: /\b(?:return|if|else|for|while|switch)\b[^\n]*[{;]/m, weight: 1 },
  { re: /^\s*(?:\/\/|#|\/\*|\*)\s*\S/m, weight: 1 },
  { re: /[{};]\s*$/m, weight: 1 },
  { re: /\)\s*(?:=>|->|\{)/m, weight: 1 },
  // Python/Ruby-style block openers: a header line ending in ":" or "do".
  { re: /^\s*(?:def|class|if|elif|else|for|while|with|try|except|finally)\b[^\n]*(?::|\bdo)\s*$/m, weight: 2 },
];
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|scala|sh|bash|zsh|sql|tf|proto)$/i;
const CONFIG_EXTENSIONS = /\.(json|ya?ml|toml|ini|cfg|conf|properties|env|gradle|lock)$/i;
const CODE_SCORE_THRESHOLD = 5;

export const codeHeuristic: DetectorImpl = {
  descriptor: desc("wrapbox.code.heuristic"),
  available: () => ({ ok: true }),
  detect(input: DetectInput): Finding[] {
    const text = (input.text ?? "").slice(0, MAX_TEXT);
    if (!text) return [];
    const name = input.filename ?? "";
    if (CONFIG_EXTENSIONS.test(name) || input.format === "json" || input.format === "yaml") {
      return [finding(codeHeuristic, "CONFIG.BUILD", 1, "medium", { label: name ? `config:${name.slice(0, 64)}` : "config", ...(input.unitPath ? { unitPath: input.unitPath } : {}) })];
    }
    let score = 0;
    for (const s of CODE_SIGNALS) if (s.re.test(text)) score += s.weight;
    const ext = CODE_EXTENSIONS.test(name);
    if (ext) score += 4;
    if (score < CODE_SCORE_THRESHOLD) return [];
    return [finding(codeHeuristic, "SOURCE_CODE", 1, ext && score >= 8 ? "high" : "medium", { label: ext ? `source_file:${name.slice(0, 64)}` : "source_code", ...(input.unitPath ? { unitPath: input.unitPath } : {}) })];
  },
};

/* ------------------------------------------------------------------ *
 * Multi-signal detectors (classifiers.ts) → registry types
 * ------------------------------------------------------------------ */

const FAMILY_TYPE: Record<string, string> = { financial: "FINANCIAL", phi: "PHI", legal: "LEGAL", confidential: "COMPANY_IP.CONFIDENTIAL_MARKING" };
const FAMILY_DETECTOR: Record<string, string> = { financial: "wrapbox.financial", phi: "wrapbox.phi", legal: "wrapbox.legal", confidential: "wrapbox.confidential" };

function confBand(c: number): Confidence { return c >= 0.85 ? "high" : c >= 0.5 ? "medium" : "low"; }

function multiSignalFor(family: "financial" | "phi" | "legal" | "confidential"): DetectorImpl {
  const impl: DetectorImpl = {
    descriptor: desc(FAMILY_DETECTOR[family]),
    available: () => ({ ok: true }),
    detect(input: DetectInput): Finding[] {
      const text = (input.text ?? "").slice(0, MAX_TEXT);
      if (!text) return [];
      const res = classifyExtended(text, { filenames: input.filename ? [input.filename] : [], contentType: input.contentType ?? "" }).filter((f) => f.family === family);
      return res.map((f) => ({
        type: FAMILY_TYPE[f.family], count: Math.max(1, f.count), confidence: confBand(f.confidence),
        detector: impl.descriptor.id, version: impl.descriptor.version, label: f.label,
        ...(input.unitPath ? { unitPath: input.unitPath } : {}),
      }));
    },
  };
  return impl;
}

export const multiSignalFinancial = multiSignalFor("financial");
export const multiSignalPhi = multiSignalFor("phi");
export const multiSignalLegal = multiSignalFor("legal");
export const multiSignalConfidential = multiSignalFor("confidential");

export const BUILTIN_IMPLS: DetectorImpl[] = [patternPii, secretsBuiltin, credentialFile, codeHeuristic, multiSignalFinancial, multiSignalPhi, multiSignalLegal, multiSignalConfidential];
