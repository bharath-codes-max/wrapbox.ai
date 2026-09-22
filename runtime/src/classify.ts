/**
 * Content classification for outbound traffic.
 *
 * Runs on the raw bytes of a request body once TLS has been terminated, and
 * answers one question: what KIND of thing is leaving this device?
 *
 * WHY THIS IS THE VENDOR-INDEPENDENT PART: classification never looks at which
 * AI service is receiving the data. A private key is a private key whether it
 * is going to claude.ai, to a competitor that launched last week, or to a host
 * nobody has ever catalogued. That is what lets one rule — "secrets never
 * leave this machine" — cover services we have never integrated with.
 *
 * NEVER RETURNS SECRET VALUES. Findings carry a label, a count and a location,
 * never the matched text. Classification output flows into evidence, and an
 * evidence trail that quotes the API key it just blocked has recreated the
 * exact exposure it prevented.
 */

import { classifyExtended, detectableFamilies as extendedFamilies, classDetectors } from "./classifiers.js";
import { inspectBody, type ParseFormat } from "./parsers.js";
import { parseMultipart, isMultipart as isMultipartCT, isFilePart } from "./multipart.js";

/** Scan at most this much of a body. Beyond it we report `truncated`. */
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

/**
 * The coarse content vocabulary the runtime emits. The first four are the
 * deterministic detectors below; the rest are supplied by the extensible
 * detector framework (classifiers.ts). `RUNTIME_CONTENT_KINDS` is the single
 * source of truth for this vocabulary — the compiler mirrors it, and a
 * drift-guard test asserts the two agree, so a class can never be named in a
 * rule that the runtime cannot actually emit.
 */
export const RUNTIME_CONTENT_KINDS = [
  "secret", "source_code", "pii", "credential_file",
  ...extendedFamilies(),
].sort();

export type ContentKind = string;

export interface Finding {
  /** What was found, e.g. "aws_access_key". Never the value itself. */
  label: string;
  kind: ContentKind;
  count: number;
  /** Detector confidence 0–1 (evidence strength only, never an authz input). */
  confidence?: number;
}

export interface Classification {
  kinds: ContentKind[];
  findings: Finding[];
  /** Filenames seen in multipart uploads — useful in the block message. */
  filenames: string[];
  bytes: number;
  truncated: boolean;
  /** True when the body carried a file upload rather than just form/JSON fields. */
  hasFileUpload: boolean;
  /** The parse format the body was recognised as (parsers.ts). */
  format: ParseFormat;
  /** False when at least one part of the body is in a format the runtime cannot
   *  read — a PDF, a generic archive, opaque binary. A content protection must
   *  then fail closed rather than trust an empty finding set (§4). */
  inspectable: boolean;
  /** Why the body could not be fully inspected, when inspectable is false. */
  inspectReason?: string;
}

/**
 * Assemble the text the scanners will run on, and say honestly whether we could
 * read all of it. For a multipart upload every file part is inspected through
 * the parser registry (so an uploaded DOCX/XLSX is read, not scanned as ZIP
 * bytes); a single unreadable part makes the whole body uninspectable so the
 * caller fails closed.
 */
function gatherInspectable(body: Buffer, contentType: string): {
  text: string; filenames: string[]; hasFileUpload: boolean;
  format: ParseFormat; inspectable: boolean; inspectReason?: string;
} {
  if (isMultipartCT(contentType)) {
    const parsed = parseMultipart(body, contentType);
    if (!parsed) {
      // A declared-multipart body we cannot structure is not "nothing here".
      return { text: body.toString("utf-8"), filenames: [], hasFileUpload: false, format: "multipart", inspectable: false, inspectReason: "malformed multipart body" };
    }
    const filenames: string[] = [];
    let hasFileUpload = false;
    let inspectable = true;
    let reason: string | undefined;
    const parts: string[] = [];
    for (const p of parsed.parts) {
      if (isFilePart(p)) {
        hasFileUpload = true;
        if (p.filename) filenames.push(p.filename.slice(0, 256));
        const ins = inspectBody(p.body, p.filename ?? "", p.contentType ?? "");
        if (!ins.canInspect) { inspectable = false; reason = reason ?? ins.reason; }
        if (ins.text) parts.push(ins.text);
      } else {
        parts.push(p.body.toString("utf-8"));
      }
    }
    return { text: parts.join("\n"), filenames, hasFileUpload, format: "multipart", inspectable, inspectReason: reason };
  }

  const ins = inspectBody(body, "", contentType);
  return {
    text: ins.text ?? body.toString("utf-8"),
    filenames: [],
    hasFileUpload: false,
    format: ins.format,
    inspectable: ins.canInspect,
    inspectReason: ins.reason,
  };
}

/* ------------------------------------------------------------------ *
 * Secret patterns
 *
 * Each is anchored on a vendor-documented prefix and length. Prefix-anchored
 * patterns are used in preference to generic entropy checks because a false
 * positive here BLOCKS a person's work — the cost of crying wolf is that the
 * product gets uninstalled.
 * ------------------------------------------------------------------ */

/**
 * AWS's own published documentation key (`AKIAIOSFODNN7EXAMPLE` and its ASIA
 * twin). It appears in AWS docs, countless READMEs and our own test guide, so it
 * trips the key pattern forever while being, by construction, not a credential.
 *
 * Rejecting it is safe rather than a loosening: a real Access Key ID is random
 * base32, so ending in these exact seven characters is ~1 in 10^10. The key
 * PATTERN below is deliberately unchanged — this is a post-match check only, so
 * nothing that looks like a real key stops being detected.
 */
const AWS_DOC_EXAMPLE_KEY = /^(?:AKIA|ASIA)[0-9A-Z]{9}EXAMPLE$/;

const SECRET_PATTERNS: { label: string; re: RegExp; validate?: (m: string) => boolean }[] = [
  { label: "private_key", re: /-----BEGIN\s+(?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { label: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, validate: (m) => !AWS_DOC_EXAMPLE_KEY.test(m) },
  { label: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { label: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "openai_key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { label: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g },
  { label: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "stripe_key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._-]{24,}/g },
  // An assignment whose name says "secret" and whose value is long enough to
  // be one. Deliberately requires quoting and length, so `PASSWORD=` in a
  // template or `api_key = <your key here>` does not trip it.
  { label: "assigned_secret", re: /\b(?:api[_-]?key|secret|password|passwd|token|access[_-]?key)\b\s*[:=]\s*["'][^"'\s]{16,}["']/gi },
];

/** Paths that are credential files regardless of what is inside them. */
const CREDENTIAL_FILENAMES: RegExp[] = [
  /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)\.?(aws|gcloud|kube)\/(credentials|config)$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(credentials|secrets?)\.(json|ya?ml|toml)$/i,
  /(^|\/)service-account.*\.json$/i,
];

/* ------------------------------------------------------------------ *
 * Source code
 *
 * Scored rather than pattern-matched. Prose about programming should not be
 * classified as source code, so we require several independent structural
 * signals before saying yes.
 * ------------------------------------------------------------------ */

const CODE_SIGNALS: { re: RegExp; weight: number }[] = [
  { re: /^#!\s*\/(?:usr\/)?bin\//m, weight: 3 },
  { re: /\b(?:import|from)\s+[\w.{}/*'"@-]+\s*(?:import|from)?\b/m, weight: 2 },
  { re: /\bfunc(?:tion)?\s+\w+\s*\(/m, weight: 2 },
  { re: /\bdef\s+\w+\s*\(/m, weight: 2 },
  { re: /\b(?:class|struct|interface|enum)\s+\w+/m, weight: 2 },
  { re: /\b(?:const|let|var)\s+\w+\s*=/m, weight: 1 },
  { re: /\b(?:public|private|protected|static)\s+\w+\s+\w+\s*\(/m, weight: 2 },
  { re: /=>\s*\{/m, weight: 1 },
  { re: /\breturn\b[^\n]{0,80};/m, weight: 1 },
  { re: /^\s*(?:\/\/|#|\/\*)\s*\S/m, weight: 1 },
  { re: /\b(?:if|for|while|switch)\s*\([^)]*\)\s*\{/m, weight: 2 },
  { re: /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/im, weight: 2 },
  { re: /\}\s*$/m, weight: 1 },
];

const CODE_SCORE_THRESHOLD = 5;

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|scala|sh|bash|zsh|sql|tf|yaml|yml|json|toml|gradle|proto)$/i;

/* ------------------------------------------------------------------ *
 * PII
 * ------------------------------------------------------------------ */

/**
 * PII patterns.
 *
 * These are the easiest detectors in the product to get WRONG, and a wrong one
 * is expensive: a false positive blocks a person's real work, and a product
 * that blocks real work gets uninstalled.
 *
 * The first version matched any ten consecutive digits as a phone number. A
 * Unix timestamp in seconds is exactly ten digits, so ordinary telemetry —
 * which is full of them — was classified as customer data and blocked. Twelve
 * digit ids did the same for Aadhaar.
 *
 * So a number now has to LOOK like the thing, not merely be the right length:
 * separators or an international prefix for phones, separators for Aadhaar,
 * and a Luhn check for cards. A bare digit run is treated as an id, because
 * that is what it almost always is.
 */
const PII_PATTERNS: { label: string; re: RegExp; min: number; validate?: (m: string) => boolean }[] = [
  // Several distinct addresses, not one — a signature line is not an export.
  {
    label: "email_addresses",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g,
    min: 5,
  },
  // Must carry separators or an international prefix. `(?<!\d)`/`(?!\d)` stop
  // a match being pulled out of the middle of a longer digit run.
  {
    label: "phone_numbers",
    re: /(?<![\d.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\d.])/g,
    min: 5,
  },
  // Aadhaar is written in 4-4-4 groups. Requiring the separators is what keeps
  // twelve-digit identifiers from reading as national ID numbers.
  {
    label: "aadhaar_numbers",
    re: /(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d)/g,
    min: 3,
  },
  // Card numbers are checkable, so check them. Luhn removes almost every
  // false positive at no cost.
  {
    label: "card_numbers",
    re: /(?<![\d.])(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ -]?\d{4}[ -]?\d{4}[ -]?\d{2,4}(?![\d.])/g,
    min: 1,
    validate: luhn,
  },
];

/** Luhn checksum — the standard validity test for a payment card number. */
function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/* ------------------------------------------------------------------ *
 * Multipart
 * ------------------------------------------------------------------ */

/**
 * Pull `filename="..."` out of a multipart body. Lightweight on purpose: we
 * want the names for the policy decision and the block message, not a full
 * MIME parse of a body we may be about to discard.
 */
function extractFilenames(text: string): string[] {
  const out = new Set<string>();
  const re = /filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = decodeURIComponent(m[1]).trim();
    if (name) out.add(name.slice(0, 256));
    if (out.size >= 50) break;
  }
  return [...out];
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function classifyContent(body: Buffer, contentType = ""): Classification {
  const bytes = body.length;

  // Extract inspectable text through the parser registry (Office files are
  // unzipped, HTML is stripped, PDFs/archives report uninspectable). `text` is
  // what every scanner below runs on.
  const gathered = gatherInspectable(body, contentType);
  const scanTrunc = gathered.text.length > MAX_SCAN_BYTES;
  const text = scanTrunc ? gathered.text.slice(0, MAX_SCAN_BYTES) : gathered.text;
  const truncated = bytes > MAX_SCAN_BYTES || scanTrunc;

  const findings: Finding[] = [];
  const kinds = new Set<ContentKind>();

  // --- secrets ---
  // `validate` is an optional post-match check (same shape PII_PATTERNS already
  // uses). It can only ever REMOVE a match, never add one, so a pattern stays
  // exactly as strict as it was written.
  for (const { label, re, validate } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    const raw = text.match(re) ?? [];
    const matches = validate ? raw.filter(validate) : raw;
    if (matches.length > 0) {
      findings.push({ label, kind: "secret", count: matches.length });
      kinds.add("secret");
    }
  }

  // --- filenames and credential files ---
  // Prefer the filenames the multipart parser found; fall back to a regex scrape
  // for a raw body that names a file without a clean multipart structure.
  const filenames = gathered.filenames.length ? gathered.filenames : extractFilenames(text);
  const hasFileUpload = gathered.hasFileUpload || filenames.length > 0;

  for (const name of filenames) {
    if (CREDENTIAL_FILENAMES.some((re) => re.test(name))) {
      findings.push({ label: `credential_file:${name.slice(0, 64)}`, kind: "credential_file", count: 1 });
      kinds.add("credential_file");
      kinds.add("secret"); // a credential file IS a secret, whatever the bytes look like
    }
  }

  // --- source code ---
  let codeScore = 0;
  for (const { re, weight } of CODE_SIGNALS) {
    if (re.test(text)) codeScore += weight;
  }
  // A source-code file extension is strong evidence on its own.
  const codeFilename = filenames.find((n) => CODE_EXTENSIONS.test(n));
  if (codeFilename) codeScore += 4;

  if (codeScore >= CODE_SCORE_THRESHOLD) {
    findings.push({ label: codeFilename ? `source_file:${codeFilename.slice(0, 64)}` : "source_code", kind: "source_code", count: 1 });
    kinds.add("source_code");
  }

  // --- PII ---
  for (const { label, re, min, validate } of PII_PATTERNS) {
    re.lastIndex = 0;
    const raw = text.match(re) ?? [];
    const checked = validate ? raw.filter(validate) : raw;
    // Distinct values, not occurrences: one address repeated across a payload
    // is one person, and counting it twenty times would trip any threshold.
    const distinct = new Set(checked.map((m) => m.replace(/[\s.-]/g, "").toLowerCase()));
    if (distinct.size >= min) {
      findings.push({ label, kind: "pii", count: distinct.size });
      kinds.add("pii");
    }
  }

  // --- extensible detectors (financial, PHI, legal, confidential, …) ---
  // The same decoded text, run through the pluggable detector framework. A new
  // enterprise class registered in classifiers.ts appears here with no edit.
  for (const f of classifyExtended(text, { filenames, contentType })) {
    findings.push({ label: f.label, kind: f.family, count: f.count, confidence: f.confidence });
    kinds.add(f.family);
  }

  return {
    kinds: [...kinds],
    findings,
    filenames,
    bytes,
    truncated,
    hasFileUpload,
    format: gathered.format,
    inspectable: gathered.inspectable,
    ...(gathered.inspectReason ? { inspectReason: gathered.inspectReason } : {}),
  };
}

/**
 * Every finding LABEL the runtime can emit. Used by the fail-closed inspection
 * gate: when a body cannot be read, the gate asks the engine a worst-case
 * question, and a rule keyed on `tool_input.findings` (rather than the coarse
 * content_kinds) must be triggerable by that question — so the worst-case call
 * carries this full label set. Dynamic labels (credential_file:<name>,
 * source_file:<name>) are matched by their base kind via a `contains` op.
 */
export const RUNTIME_FINDING_LABELS: string[] = [
  ...SECRET_PATTERNS.map((p) => p.label),
  "credential_file", "source_code",
  ...PII_PATTERNS.map((p) => p.label),
  ...classDetectors().map((d) => d.label),
];

/** One human-readable line for a block page or a notification. */
export function describeClassification(c: Classification): string {
  if (!c.findings.length) return "no sensitive content detected";
  return c.findings
    .map((f) => (f.count > 1 ? `${f.label} (${f.count})` : f.label))
    .join(", ");
}
