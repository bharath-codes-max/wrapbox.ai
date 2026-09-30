/**
 * Detector "wrapbox.edm" — Exact Data Match against the tenant's hashed indexes.
 *
 * WHY THIS EXISTS. A pattern can say "that looks like an employee id"; only an
 * exact match against the tenant's own list can say "that IS one of ours".
 * Types such as HR.EMPLOYEE_ID, CUSTOMER.ID and CUSTOM.<tenant>.* are declared
 * with `tenantConfig.kind = "edm_index"` for exactly this reason — until an
 * index exists on the device the type is UNDERSTOOD_ONLY, and `available()`
 * below is what turns it ENFORCED. It never pretends: no key or no index means
 * `{ ok: false, reason }`.
 *
 * HOW A HIT IS FORMED. For every loaded index the primary column's candidates
 * are pulled from the unit (text, table cells, JSON strings), normalised,
 * HMAC'd, Bloom-checked and then confirmed against the sorted digest list. A
 * primary alone is a MEDIUM-confidence hit; a supporting column value (a name
 * next to its id) found within PROXIMITY_CHARS of a primary hit raises the
 * finding to HIGH. The count is DISTINCT matched primaries — the same id
 * repeated ten times is one value. Values never leave this module: a Finding
 * carries the index's type, its name as the label, a count and a confidence.
 *
 * No thresholds here; the clause's `match.minCount` / `minConfidence` decide.
 * Everything is bounded (MAX_SCAN_CHARS, MAX_CANDIDATES, DETECT_BUDGET_MS) and
 * fail-closed: any throw becomes `[]` plus `lastError` for the core to surface.
 */

import type { DetectorImpl, DetectInput, Finding, DetectorDescriptor } from "@wrapbox/registry";
import { dataTypes, BUILTIN_DETECTORS } from "@wrapbox/registry";
import fs from "node:fs";
import path from "node:path";
import {
  EdmLookup, edmHome, extractCandidates, loadIndexes, loadKey,
  type EdmColumn, type EdmIndex, type Candidate,
} from "../edm/index.js";

export const DESCRIPTOR: DetectorDescriptor = BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.edm")!;

/** Characters of unit text scanned per call; the remainder is reported, never silently dropped. */
export const MAX_SCAN_CHARS = 4 * 1024 * 1024;
/** A supporting value this close to a primary hit corroborates it. */
export const PROXIMITY_CHARS = 300;
/** Wall-clock budget for one detect() call; exceeding it is a failure, not a partial answer. */
export const DETECT_BUDGET_MS = 2000;
/** Supporting-column lookups stop after this many primary hits have been examined without corroboration. */
const MAX_SUPPORT_PROBES = 500;
/** Longest multi-word supporting value considered (names are 1–3 tokens; anything longer is a sentence). */
const SUPPORT_NGRAMS = 3;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_STRINGS = 100_000;
const CUSTOM_TYPE_RE = /^CUSTOM\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/;

export let lastError: string | null = null;
/** Non-fatal conditions from the last call (input truncated, an index file refused) — surfaced, not hidden. */
export let lastWarnings: string[] = [];

/* ------------------------------------------------------------------ *
 * Index cache — reloaded when the edm directory changes
 * ------------------------------------------------------------------ */

interface Cache { stamp: string; key: Buffer | null; lookups: EdmLookup[]; errors: string[] }
let cache: Cache | null = null;

/** Directory fingerprint: file names + mtimes + sizes + key mtime. Cheap enough to run per call. */
function stamp(): string {
  const parts: string[] = [];
  try {
    const dir = edmHome();
    for (const f of fs.readdirSync(dir).sort()) {
      try { const st = fs.statSync(path.join(dir, f)); parts.push(`${f}:${st.mtimeMs}:${st.size}`); } catch { parts.push(f); }
    }
  } catch { return ""; }
  return parts.join("|");
}

/** Register a CUSTOM.<tenant>.<NAME> type the registry does not know yet, as configured (an index exists). */
function registerCustomType(type: string): void {
  const reg = dataTypes();
  if (reg.has(type)) return;
  const m = CUSTOM_TYPE_RE.exec(type);
  if (!m) return;
  reg.addCustom({ tenant: m[1], name: m[2], label: `${m[2].replace(/_/g, " ").toLowerCase()} (EDM index)`, aliases: [], detection: { kind: "edm_index" }, configured: true });
}

function load(force = false): Cache {
  const s = stamp();
  if (!force && cache && cache.stamp === s) return cache;
  const key = loadKey();
  const { indexes, errors } = loadIndexes();
  const lookups: EdmLookup[] = [];
  for (const idx of indexes) {
    try {
      registerCustomType(idx.type);
      if (!dataTypes().has(idx.type)) throw new Error(`type ${idx.type} is not in the registry`);
      if (key) lookups.push(new EdmLookup(idx, key));
    } catch (e) {
      errors.push(`${idx.name}: ${(e as Error).message}`);
    }
  }
  cache = { stamp: s, key, lookups, errors };
  return cache;
}

/** Force a reload (tests, or the core after `wrapboxd edm build`). */
export function reloadIndexes(): { indexes: EdmIndex[]; errors: string[] } {
  const c = load(true);
  return { indexes: c.lookups.map((l) => l.index), errors: c.errors };
}

/* ------------------------------------------------------------------ *
 * Segments — one proximity domain each (a text, a table row, a JSON unit)
 * ------------------------------------------------------------------ */

interface Segment { text: string; /** cell boundaries → header, table rows only */ cells?: Array<{ start: number; end: number; field: string }> }

function segmentsOf(input: DetectInput): { segments: Segment[]; truncated: boolean } {
  const segments: Segment[] = [];
  let budget = MAX_SCAN_CHARS;
  let truncated = false;
  const take = (s: string): string | null => {
    if (budget <= 0) { truncated = true; return null; }
    if (s.length > budget) { truncated = true; const t = s.slice(0, budget); budget = 0; return t; }
    budget -= s.length;
    return s;
  };
  if (input.table) {
    const { headers, rows } = input.table;
    for (const row of rows) {
      const cells: Segment["cells"] = [];
      let text = "";
      for (let i = 0; i < row.length; i++) {
        const cell = row[i] ?? "";
        if (i > 0) text += "  ";
        cells.push({ start: text.length, end: text.length + cell.length, field: headers[i] ?? `col${i}` });
        text += cell;
      }
      const t = take(text);
      if (t === null) break;
      segments.push({ text: t, cells });
    }
  } else if (input.text !== undefined) {
    const t = take(input.text);
    if (t !== null) segments.push({ text: t });
  }
  if (input.json !== undefined && !input.table) {
    const strings: string[] = [];
    const walk = (v: unknown, depth: number): void => {
      if (strings.length >= MAX_JSON_STRINGS || depth > MAX_JSON_DEPTH) return;
      if (typeof v === "string") strings.push(v);
      else if (typeof v === "number") strings.push(String(v));
      else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
      else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    };
    walk(input.json, 0);
    // When the core hands us both the raw text and its parsed JSON, the text already covers it.
    if (input.text === undefined) { const t = take(strings.join("\n")); if (t !== null) segments.push({ text: t }); }
  }
  return { segments, truncated };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

interface IndexResult { hexes: Set<string>; high: boolean; fields: Set<string>; probes: number }

function fieldAt(seg: Segment, pos: number): string | null {
  if (!seg.cells) return null;
  for (const c of seg.cells) if (pos >= c.start && pos < c.end) return c.field;
  return null;
}

function matchSegment(lookup: EdmLookup, seg: Segment, acc: IndexResult, deadline: number): void {
  const primaries = extractCandidates(seg.text, lookup.pattern(lookup.primary));
  const hits: Candidate[] = [];
  for (let i = 0; i < primaries.length; i++) {
    if ((i & 1023) === 0 && Date.now() > deadline) throw new Error(`exceeded ${DETECT_BUDGET_MS} ms budget`);
    const c = primaries[i];
    const hex = lookup.match(lookup.primary, c.raw);
    if (!hex) continue;
    acc.hexes.add(hex);
    hits.push(c);
    const f = fieldAt(seg, c.start);
    if (f) acc.fields.add(f);
  }
  if (acc.high || hits.length === 0 || lookup.supporting.length === 0) return;
  // Corroboration: any supporting value within the window of any primary hit. Stops at the first, since
  // confidence is per finding, not per value.
  for (const h of hits) {
    if (acc.probes++ >= MAX_SUPPORT_PROBES) return;
    if (Date.now() > deadline) throw new Error(`exceeded ${DETECT_BUDGET_MS} ms budget`);
    const start = Math.max(0, h.start - PROXIMITY_CHARS);
    const end = Math.min(seg.text.length, h.end + PROXIMITY_CHARS);
    const window = seg.text.slice(start, h.start) + " ".repeat(h.end - h.start) + seg.text.slice(h.end, end);
    for (const col of lookup.supporting) {
      if (supportedIn(lookup, col, window)) {
        acc.high = true;
        const f = fieldAt(seg, h.start);
        if (f) acc.fields.add(f);
        return;
      }
    }
  }
}

function supportedIn(lookup: EdmLookup, col: EdmColumn, window: string): boolean {
  const pat = lookup.pattern(col);
  for (const c of extractCandidates(window, pat, pat ? 1 : SUPPORT_NGRAMS, 4096)) if (lookup.match(col, c.raw)) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * The plugin
 * ------------------------------------------------------------------ */

export const detector: DetectorImpl = {
  descriptor: DESCRIPTOR,

  available() {
    const c = load();
    if (!c.key) return { ok: false, reason: `no tenant key at ${edmHome()}/key — run "wrapboxd edm build" to create the first index` };
    if (c.lookups.length === 0) {
      return { ok: false, reason: c.errors.length ? `no loadable EDM index: ${c.errors.join("; ")}` : `no EDM index under ${edmHome()}` };
    }
    return { ok: true };
  },

  detect(input: DetectInput): Finding[] {
    lastError = null;
    lastWarnings = [];
    try {
      if (!DESCRIPTOR.inputs.includes(input.input)) return [];
      const c = load();
      if (!c.key || c.lookups.length === 0) return [];
      if (c.errors.length) lastWarnings.push(...c.errors);
      const deadline = Date.now() + DETECT_BUDGET_MS;
      const { segments, truncated } = segmentsOf(input);
      if (truncated) lastWarnings.push(`input truncated to ${MAX_SCAN_CHARS} chars; values beyond that were not matched`);
      const findings: Finding[] = [];
      for (const lookup of c.lookups) {
        const acc: IndexResult = { hexes: new Set(), high: false, fields: new Set(), probes: 0 };
        for (const seg of segments) matchSegment(lookup, seg, acc, deadline);
        if (acc.hexes.size === 0) continue;
        findings.push({
          type: lookup.index.type,
          count: acc.hexes.size,
          confidence: acc.high ? "high" : "medium",
          detector: DESCRIPTOR.id,
          version: DESCRIPTOR.version,
          label: lookup.index.name,
          ...(acc.fields.size ? { fields: [...acc.fields].sort() } : {}),
          ...(input.unitPath ? { unitPath: input.unitPath } : {}),
        });
      }
      return findings;
    } catch (e) {
      lastError = `wrapbox.edm: ${(e as Error).message}`;
      return [];
    }
  },
};
