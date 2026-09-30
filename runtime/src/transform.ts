/**
 * The CONSTRAIN transform — what actually makes "the agent may not see this
 * field" true rather than merely claimed.
 *
 * Given an outbound body and a constraint from the matched rule, this produces
 * the bytes that will really be sent, plus a report of what was protected. The
 * report carries LABELS AND COUNTS ONLY — putting the protected values into a
 * receipt would defeat the entire feature.
 *
 * THE ONE INVARIANT THAT MATTERS:
 *
 *   If a CONSTRAIN rule matches and the transform cannot be applied, the
 *   request MUST NOT be forwarded.
 *
 * A body we cannot parse is a body we cannot mask. Forwarding it anyway would
 * silently turn CONSTRAIN into ALLOW — which is precisely the failure where a
 * masking rule was configured, the dashboard said "protected", and the model
 * received the raw spreadsheet. Every failure path here returns ok:false, and
 * the caller blocks.
 */

import {
  detectFormat, isTransformable, untransformableReason,
  parseTable, serialiseTable, matchColumns, mapJsonStrings, columnMatches,
  type DocFormat,
} from "./structured.js";
import { tokenize, neutraliseTokenLookalikes, flushVault, type TokenKind } from "./tokenize.js";
import {
  parseMultipart, serialiseMultipart, isMultipart, isFilePart, type Part,
} from "./multipart.js";

// policy-core owns the wire shape; this module owns how it is applied. Having
// one canonical Constraint type means a rule cannot mean one thing in the
// evaluator and another in the transform.
export type { Constraint, ConstraintKind } from "@wrapbox/policy-core";
import type { Constraint } from "@wrapbox/policy-core";
import { dataTypes, type TransformAvailability } from "@wrapbox/registry";
import crypto from "node:crypto";
import { vaultKey } from "./vaultkey.js";

/** The wire constraint may carry a registry handler and params (v2 rules). */
type ConstraintV2 = Constraint & { handler?: string; params?: Record<string, unknown> };

/** Every class this runtime can actually detect and replace. */
const KNOWN_KINDS: TokenKind[] = ["EMAIL", "PHONE", "CARD", "SSN", "AADHAAR", "NAME", "ADDRESS", "ACCOUNT", "DOB", "ID", "VALUE"];

/**
 * Narrow the wire's `classes: string[]` to kinds this runtime can enforce.
 *
 * A class we do not recognise is DROPPED rather than guessed at — and if that
 * leaves the constraint with nothing it can enforce, the caller is told, so a
 * rule naming only unknown classes fails closed instead of quietly protecting
 * nothing.
 */
/**
 * Registry type → the value kinds this runtime can locate and replace. A
 * family or prefix expands to every kind beneath it (PII → email, phone, …).
 * Legacy names (EMAIL, PHONE…) are still accepted. Anything unmapped is
 * reported as unknown, never guessed.
 */
const TYPE_KINDS: Array<[string, TokenKind[]]> = [
  ["PII.CONTACT.EMAIL", ["EMAIL"]], ["PII.CONTACT.PHONE", ["PHONE"]], ["PII.CONTACT.NAME", ["NAME"]], ["PII.CONTACT.ADDRESS", ["ADDRESS"]],
  ["PII.IDENTITY.DOB", ["DOB"]], ["PCI.PAN", ["CARD"]], ["PCI", ["CARD"]], ["GOV_ID.US.SSN", ["SSN"]], ["GOV_ID.IN.AADHAAR", ["AADHAAR"]],
  ["FINANCIAL.ACCOUNT", ["ACCOUNT"]], ["CUSTOMER.ID", ["ID"]], ["HR.EMPLOYEE_ID", ["ID"]], ["PHI.MRN", ["ID"]],
  ["PII.CONTACT", ["EMAIL", "PHONE", "NAME", "ADDRESS"]], ["PII.IDENTITY", ["DOB"]],
  ["PII", ["EMAIL", "PHONE", "NAME", "ADDRESS", "DOB", "CARD", "SSN", "AADHAAR", "ACCOUNT"]],
  ["GOV_ID", ["SSN", "AADHAAR"]], ["CUSTOMER", ["EMAIL", "PHONE", "NAME", "ADDRESS", "ID"]],
];

export function kindsForType(raw: string): TokenKind[] {
  const up = String(raw).toUpperCase().trim();
  const legacy = KNOWN_KINDS.find((k) => k === up);
  if (legacy) return [legacy];
  const reg = dataTypes();
  // Exact or ancestor mapping: the most specific entry that covers the type.
  let best: { len: number; kinds: TokenKind[] } | null = null;
  for (const [prefix, kinds] of TYPE_KINDS) {
    if (reg.isWithin(up, prefix) || up === prefix) { if (!best || prefix.length > best.len) best = { len: prefix.length, kinds }; }
  }
  if (best) return best.kinds;
  // A family prefix that covers mapped descendants (e.g. "PII" handled above; a CUSTOM.<t>.X → ID).
  if (up.startsWith("CUSTOM.")) return ["ID"];
  return [];
}

/** Data types the runtime can actually transform — for the capability snapshot. */
export const TRANSFORM_AVAILABILITY: TransformAvailability[] = [
  { handler: "REVERSIBLE_TOKENIZE", formats: ["text", "csv", "tsv", "json"], types: TYPE_KINDS.map(([t]) => t).concat(["CUSTOM"]) },
  { handler: "REDACT", formats: ["text", "csv", "tsv", "json"], types: TYPE_KINDS.map(([t]) => t).concat(["CUSTOM"]) },
  { handler: "MASK", formats: ["text", "csv", "tsv", "json"], types: ["PCI.PAN", "PCI", "PII.CONTACT.PHONE", "FINANCIAL.ACCOUNT", "GOV_ID.US.SSN", "GOV_ID.IN.AADHAAR"] },
  { handler: "HASH", formats: ["text", "csv", "tsv", "json"], types: TYPE_KINDS.map(([t]) => t).concat(["CUSTOM"]) },
  { handler: "DROP_FIELD", formats: ["csv", "tsv", "json"], types: ["*"] },
  { handler: "LIMIT", formats: ["text", "csv", "tsv", "json"], types: ["*"] },
];

function knownClasses(c: Constraint): { kinds: TokenKind[]; unknown: string[] } {
  const kinds = new Set<TokenKind>();
  const unknown: string[] = [];
  for (const raw of c.classes ?? []) {
    const ks = kindsForType(String(raw));
    if (ks.length) ks.forEach((k) => kinds.add(k)); else unknown.push(raw);
  }
  return { kinds: [...kinds], unknown };
}

/** What was protected. Labels and counts — never values. */
export interface TransformReport {
  /** Column/key names actually found and protected. */
  fields: string[];
  /** Data classes protected, with how many DISTINCT values of each. */
  protected: { kind: TokenKind; count: number }[];
  /** Total distinct values replaced. */
  total: number;
  /** Token-shaped text in the input that was neutralised (spoofing attempt). */
  lookalikes: number;
  /** What kind of document this was. */
  format: DocFormat;
}

export type TransformResult =
  | { ok: true; body: Buffer; report: TransformReport; changed: boolean }
  | { ok: false; reason: string; format: DocFormat };

/* ------------------------------------------------------------------ *
 * Value detectors — used when a rule protects a CLASS rather than a column
 * ------------------------------------------------------------------ */

/**
 * Detectors run on individual values, not on a whole document, so they can be
 * anchored (^…$). That makes them far more precise than the scanning patterns
 * in classify.ts: a cell either IS an email or it is not.
 */
const VALUE_DETECTORS: { kind: TokenKind; re: RegExp }[] = [
  { kind: "EMAIL", re: /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/ },
  { kind: "PHONE", re: /^\+?\d[\d\s().-]{7,17}\d$/ },
  { kind: "CARD", re: /^(?:\d[ -]?){12,18}\d$/ },
  { kind: "SSN", re: /^\d{3}-\d{2}-\d{4}$/ },
  { kind: "AADHAAR", re: /^[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}$/ },
  { kind: "DOB", re: /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/ },
];

/** Luhn — stops an order number from being tokenized as a payment card. */
function luhn(s: string): boolean {
  const d = s.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/** Which class, if any, this single value belongs to. */
export function classifyValue(v: string): TokenKind | null {
  const s = v.trim();
  if (!s) return null;
  for (const d of VALUE_DETECTORS) {
    if (!d.re.test(s)) continue;
    if (d.kind === "CARD" && !luhn(s)) continue;
    return d.kind;
  }
  return null;
}

/**
 * Infer the class of a column from its header, so a rule that names "Email"
 * produces EMAIL tokens rather than generic ones. Falls back to per-value
 * detection, then to VALUE.
 */
function kindForColumn(header: string, sample: string): TokenKind {
  const h = header.toLowerCase();
  if (/mail/.test(h)) return "EMAIL";
  if (/phone|mobile|cell|contact.*no|tel/.test(h)) return "PHONE";
  if (/card|pan\b|credit/.test(h)) return "CARD";
  if (/ssn|social/.test(h)) return "SSN";
  if (/aadhaar|aadhar|uidai/.test(h)) return "AADHAAR";
  if (/dob|birth/.test(h)) return "DOB";
  if (/name/.test(h)) return "NAME";
  if (/address|street|city|zip|postal/.test(h)) return "ADDRESS";
  if (/account|iban|routing/.test(h)) return "ACCOUNT";
  if (/\bid\b|identifier|uuid/.test(h)) return "ID";
  return classifyValue(sample) ?? "VALUE";
}

/* ------------------------------------------------------------------ *
 * Tally
 * ------------------------------------------------------------------ */

class Tally {
  private byKind = new Map<TokenKind, Set<string>>();
  private fields = new Set<string>();
  lookalikes = 0;

  add(kind: TokenKind, value: string, field?: string): void {
    let s = this.byKind.get(kind);
    if (!s) { s = new Set(); this.byKind.set(kind, s); }
    s.add(value);
    if (field) this.fields.add(field);
  }

  report(format: DocFormat): TransformReport {
    const protectedList = [...this.byKind.entries()]
      .map(([kind, set]) => ({ kind, count: set.size }))
      .sort((a, b) => b.count - a.count);
    return {
      fields: [...this.fields],
      protected: protectedList,
      total: protectedList.reduce((n, p) => n + p.count, 0),
      lookalikes: this.lookalikes,
      format,
    };
  }
}

/** Replace one value according to the constraint. */
function replaceValue(value: string, kind: TokenKind, c: Constraint, field?: string): string {
  const handler = (c as ConstraintV2).handler ?? (c.kind === "redact" ? "REDACT" : "REVERSIBLE_TOKENIZE");
  switch (handler) {
    case "REDACT": return `[REDACTED_${kind}]`;
    case "MASK": {
      // Keep the last N characters (default 4) of the digits, mask the rest; format-preserving.
      const keep = Number(((c as ConstraintV2).params?.keepLast as number | undefined) ?? 4);
      const ch = String(((c as ConstraintV2).params?.maskChar as string | undefined) ?? "*");
      const chars = [...value];
      let seen = 0;
      const digitsTotal = chars.filter((x) => /[0-9A-Za-z]/.test(x)).length;
      return chars.map((x) => { if (!/[0-9A-Za-z]/.test(x)) return x; seen++; return seen > digitsTotal - keep ? x : ch; }).join("");
    }
    case "HASH": {
      // HMAC under the vault key: stable within a tenant device, unlinkable outside it.
      const h = crypto.createHmac("sha256", vaultKey().key).update(`${kind}:${value}`).digest("hex").slice(0, 24);
      return `<WBH_${kind}_${h}>`;
    }
    default: return tokenize(value, kind, field);
  }
}

/** DROP_FIELD / LIMIT act on the document shape rather than on values. */
function applyShapeHandlers(text: string, format: DocFormat, c: ConstraintV2, t: Tally): string | null {
  const handler = c.handler;
  if (handler === "DROP_FIELD") {
    const wanted = c.fields ?? [];
    if (format === "csv" || format === "tsv") {
      const table = parseTable(text, format === "tsv" ? "\t" : ",");
      if (!table) return null;
      const drop = new Set(matchColumns(table.headers, wanted));
      if (!drop.size) return text;
      for (const col of drop) t.add("VALUE", `__dropped__${table.headers[col]}`, table.headers[col]);
      const keep = table.headers.map((_, i) => i).filter((i) => !drop.has(i));
      return serialiseTable({ ...table, headers: keep.map((i) => table.headers[i]), rows: table.rows.map((r) => keep.map((i) => r[i] ?? "")) });
    }
    if (format === "json") {
      let parsed: unknown; try { parsed = JSON.parse(text); } catch { return null; }
      const strip = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(strip);
        if (v && typeof v === "object") {
          const out: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (wanted.some((w) => columnMatches(k, w))) { t.add("VALUE", `__dropped__${k}`, k); continue; }
            out[k] = strip(val);
          }
          return out;
        }
        return v;
      };
      return JSON.stringify(strip(parsed));
    }
    return null;
  }
  if (handler === "LIMIT") {
    const p = c.params ?? {};
    const maxRows = Number(p.maxRows ?? 0), maxLines = Number(p.maxLines ?? 0), maxBytes = Number(p.maxBytes ?? 0);
    let out = text;
    if ((format === "csv" || format === "tsv") && maxRows > 0) {
      const table = parseTable(text, format === "tsv" ? "\t" : ",");
      if (!table) return null;
      if (table.rows.length > maxRows) { t.add("VALUE", `__limited__rows`, "rows"); out = serialiseTable({ ...table, rows: table.rows.slice(0, maxRows) }); }
    } else if (maxLines > 0) {
      const lines = out.split("\n");
      if (lines.length > maxLines) { t.add("VALUE", `__limited__lines`, "lines"); out = lines.slice(0, maxLines).join("\n"); }
    }
    if (maxBytes > 0 && Buffer.byteLength(out) > maxBytes) { t.add("VALUE", `__limited__bytes`, "bytes"); out = Buffer.from(out).subarray(0, maxBytes).toString("utf-8"); }
    return out;
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Per-format transforms
 * ------------------------------------------------------------------ */

function transformTable(text: string, delim: string, c: Constraint, cls: TokenKind[], t: Tally): string | null {
  const table = parseTable(text, delim);
  if (!table) return null;

  const named = c.fields?.length ? matchColumns(table.headers, c.fields) : [];
  const wantClasses = new Set(cls);

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    for (let col = 0; col < row.length; col++) {
      const raw = row[col];
      if (!raw || !raw.trim()) continue;
      const header = table.headers[col] ?? "";

      const byName = named.includes(col);
      const detected = wantClasses.size ? classifyValue(raw) : null;
      const byClass = detected !== null && wantClasses.has(detected);
      if (!byName && !byClass) continue;

      const kind = byName ? kindForColumn(header, raw) : (detected as TokenKind);
      row[col] = replaceValue(raw, kind, c, header || undefined);
      t.add(kind, raw, header || undefined);
    }
  }
  return serialiseTable(table);
}

function transformJson(text: string, c: Constraint, cls: TokenKind[], t: Tally): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }

  const wantClasses = new Set(cls);
  const wantFields = c.fields ?? [];

  const out = mapJsonStrings(parsed, (key, val) => {
    if (!val.trim()) return undefined;
    const byName = wantFields.length > 0 && key !== "" && wantFields.some((w) => columnMatches(key, w));
    const detected = wantClasses.size ? classifyValue(val) : null;
    const byClass = detected !== null && wantClasses.has(detected);
    if (!byName && !byClass) return undefined;

    const kind = byName ? kindForColumn(key, val) : (detected as TokenKind);
    t.add(kind, val, key || undefined);
    return replaceValue(val, kind, c, key || undefined);
  });
  return JSON.stringify(out);
}

/**
 * Free text: only class-based protection is possible — there are no field
 * names to match. Patterns are unanchored here by necessity, so they are the
 * stricter variants to keep prose intact.
 */
const TEXT_SCANNERS: { kind: TokenKind; re: RegExp; check?: (s: string) => boolean }[] = [
  { kind: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "PHONE", re: /(?<![\d.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\d.])/g },
  { kind: "CARD", re: /(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g, check: luhn },
  { kind: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

function transformText(text: string, c: Constraint, cls: TokenKind[], t: Tally): string {
  const want = new Set(cls);
  if (!want.size) return text;
  let out = text;
  for (const s of TEXT_SCANNERS) {
    if (!want.has(s.kind)) continue;
    out = out.replace(s.re, (m) => {
      if (s.check && !s.check(m)) return m;
      t.add(s.kind, m);
      return replaceValue(m, s.kind, c);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Transform one document. `filename` and `contentType` are hints for format
 * detection; the bytes decide.
 */
export function transformDocument(
  body: Buffer,
  c: Constraint,
  filename = "",
  contentType = "",
): TransformResult {
  const format = detectFormat(body, filename, contentType);

  if (!isTransformable(format)) {
    return { ok: false, reason: untransformableReason(format), format };
  }

  // Narrow declared classes to what this runtime can actually detect. A
  // constraint that names ONLY unknown classes and no fields would protect
  // nothing while reporting success — refuse it instead.
  const { kinds, unknown } = knownClasses(c);
  const handler = (c as ConstraintV2).handler;
  if (handler === "DROP_FIELD" || handler === "LIMIT") {
    const t0 = new Tally();
    const neutral = neutraliseTokenLookalikes(body.toString("utf-8"));
    t0.lookalikes = neutral.found;
    const out0 = applyShapeHandlers(neutral.text, format, c as ConstraintV2, t0);
    if (out0 === null) return { ok: false, reason: `Wrapbox could not read this ${format.toUpperCase()} well enough to apply ${handler}.`, format };
    const report0 = t0.report(format);
    return { ok: true, body: Buffer.from(out0, "utf-8"), report: report0, changed: out0 !== neutral.text || report0.lookalikes > 0 };
  }
  if (!(c.fields?.length) && !kinds.length) {
    return {
      ok: false,
      reason: unknown.length
        ? `This rule protects ${unknown.join(", ")}, which this runtime cannot detect, so nothing could be masked.`
        : "This rule names no fields or data classes to protect, so nothing could be masked.",
      format,
    };
  }

  const t = new Tally();

  // Neutralise anything pretending to be one of our tokens BEFORE we mint any,
  // so a crafted input can never round-trip into a real value on the response.
  const neutralised = neutraliseTokenLookalikes(body.toString("utf-8"));
  t.lookalikes = neutralised.found;
  const text = neutralised.text;

  let out: string | null;
  if (format === "csv") out = transformTable(text, ",", c, kinds, t);
  else if (format === "tsv") out = transformTable(text, "\t", c, kinds, t);
  else if (format === "json") out = transformJson(text, c, kinds, t);
  else out = transformText(text, c, kinds, t);

  if (out === null) {
    return {
      ok: false,
      reason: `Wrapbox could not read this ${format.toUpperCase()} well enough to mask the protected fields inside it.`,
      format,
    };
  }

  flushVault();
  const report = t.report(format);
  return { ok: true, body: Buffer.from(out, "utf-8"), report, changed: report.total > 0 || report.lookalikes > 0 };
}

/**
 * Transform a whole request body, handling multipart uploads part by part.
 *
 * File parts are transformed as documents. Ordinary form fields (and non
 * multipart bodies, e.g. a JSON chat payload) are transformed as their own
 * detected format, so a pasted spreadsheet in a prompt is protected the same
 * way an uploaded file is.
 */
export function transformBody(
  body: Buffer,
  contentType: string,
  c: Constraint,
): TransformResult {
  if (!isMultipart(contentType)) {
    return transformDocument(body, c, "", contentType);
  }

  const parsed = parseMultipart(body, contentType);
  if (!parsed) {
    return {
      ok: false,
      reason: "Wrapbox could not read the structure of this upload, so it could not mask the protected fields inside it.",
      format: "unknown",
    };
  }

  const merged = new Tally();
  const nextParts: Part[] = [];

  for (const p of parsed.parts) {
    const res = transformDocument(p.body, c, p.filename ?? "", p.contentType ?? "");
    if (!res.ok) {
      // One unmaskable part fails the whole request. Sending the other parts
      // would leak this one, and sending it masked-but-incomplete is worse.
      return res;
    }
    merged.lookalikes += res.report.lookalikes;
    for (const f of res.report.fields) merged.add("VALUE", `__field__${f}`, f);
    for (const pr of res.report.protected) {
      // Counts are per-part sets; re-key them so the merged total stays honest
      // about distinctness within a part without pretending to dedupe across.
      for (let i = 0; i < pr.count; i++) merged.add(pr.kind, `${p.filename ?? p.name ?? "part"}#${pr.kind}#${i}`);
    }
    nextParts.push({ ...p, body: res.body });
  }

  const rebuilt = serialiseMultipart({ ...parsed, parts: nextParts });
  const report = merged.report("csv");
  // The synthetic __field__ entries exist only to carry field names; drop them
  // from the class tally so the numbers a human reads are real.
  report.protected = report.protected.filter((p) => !(p.kind === "VALUE" && report.fields.length > 0 && p.count === report.fields.length));
  report.total = report.protected.reduce((n, p) => n + p.count, 0);

  return { ok: true, body: rebuilt, report, changed: report.total > 0 || report.lookalikes > 0 };
}

/** One-line summary for a receipt / block page. Never contains a value. */
export function describeTransform(r: TransformReport): string {
  const parts: string[] = [];
  if (r.fields.length) parts.push(`fields ${r.fields.join(", ")}`);
  for (const p of r.protected) parts.push(`${p.count} ${p.kind.toLowerCase()}`);
  if (r.lookalikes) parts.push(`${r.lookalikes} spoofed token(s) neutralised`);
  return parts.length ? parts.join(" · ") : "nothing matched";
}
