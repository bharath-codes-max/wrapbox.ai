/**
 * Exact Data Match (EDM) — tenant-hashed index builder and lookup.
 *
 * An administrator wants "our employee ids" or "our customer names" enforced
 * exactly, not guessed at by a pattern. The naive way is to ship the list to
 * every device; that turns the enforcement point into the leak. EDM instead
 * ships a KEYED index: each cell of the tenant's CSV is normalised and reduced
 * to HMAC-SHA256(tenantKey, value). The key is 32 random bytes generated on
 * this device on the first build and kept at WRAPBOX_HOME/edm/key (0600); it
 * never enters the index file. Without the key an index is a bag of opaque
 * digests — no dictionary attack, no rainbow table, no plaintext anywhere.
 *
 * Lookup is two-stage: a Bloom filter (k positions derived from the HMAC
 * digest, sized for a 0.1 % false-positive rate) rejects the overwhelming
 * majority of candidates in a few bit tests, then a binary search over the
 * sorted per-column digest list confirms an exact hit. The Bloom filter is an
 * accelerator only; it never decides a match on its own.
 *
 * Nothing here is a policy: the module answers "is this value in the tenant's
 * list" and nothing else. Thresholds live in the clause (`match.minCount`).
 *
 * Format (WRAPBOX_HOME/edm/<name>.json, version 1):
 *   { name, type, columns:[{name, primary, normalise:{case, stripSeparators}, pattern?}],
 *     bloom:{m, k, bits(base64)}, hashes:{<column>: [hex…] sorted}, rows, builtAt, version }
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataTypes } from "@wrapbox/registry";

export const EDM_FORMAT_VERSION = 1;
export const KEY_BYTES = 32;
/** Target Bloom false-positive rate (0.1 %). */
export const BLOOM_FP_RATE = 0.001;
/** A CSV larger than this is refused rather than half-indexed. */
export const MAX_CSV_BYTES = 64 * 1024 * 1024;
export const MAX_ROWS = 1_000_000;
export const MAX_COLUMNS = 32;
/** Index files above this are refused at load (a corrupt or hostile file must not exhaust memory). */
export const MAX_INDEX_BYTES = 256 * 1024 * 1024;
export const MAX_INDEXES = 64;
export const MAX_PATTERN_LENGTH = 256;
/** Candidate tokens outside this length band cannot be an indexed value worth hashing. */
export const MIN_TOKEN_LENGTH = 4;
export const MAX_TOKEN_LENGTH = 64;
/** Hard cap on candidates extracted from one segment so a hostile body cannot force unbounded HMAC work. */
export const MAX_CANDIDATES = 200_000;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TYPE_RE = /^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_-]+)*$/;
const CUSTOM_TYPE_RE = /^CUSTOM\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/;

export interface Normalise { case: "lower" | "keep"; stripSeparators: boolean }
export interface EdmColumn { name: string; primary: boolean; normalise: Normalise; pattern?: string }
export interface EdmBloom { m: number; k: number; bits: string }
export interface EdmIndex {
  name: string;
  type: string;
  columns: EdmColumn[];
  bloom: EdmBloom;
  hashes: Record<string, string[]>;
  rows: number;
  builtAt: string;
  version: number;
}

/* ------------------------------------------------------------------ *
 * Paths and the tenant key
 * ------------------------------------------------------------------ */

/** Resolved at call time (not import time) so a test or multi-instance run can point WRAPBOX_HOME elsewhere. */
export function edmHome(): string {
  return path.join(process.env.WRAPBOX_HOME || path.join(os.homedir(), ".wrapbox"), "edm");
}
export function keyPath(): string { return path.join(edmHome(), "key"); }
export function indexPath(name: string): string { return path.join(edmHome(), `${name}.json`); }

/** Read the tenant key; null when no build has happened on this device yet. */
export function loadKey(): Buffer | null {
  try {
    const k = fs.readFileSync(keyPath());
    return k.length === KEY_BYTES ? k : null;
  } catch {
    return null;
  }
}

/** Create the key on first build. 0600, never overwritten (a rotated key would orphan every existing index). */
export function loadOrCreateKey(): Buffer {
  const existing = loadKey();
  if (existing) return existing;
  fs.mkdirSync(edmHome(), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(keyPath(), key, { mode: 0o600, flag: "wx" });
  return key;
}

/* ------------------------------------------------------------------ *
 * Normalisation and hashing — the SAME functions at build and lookup
 * ------------------------------------------------------------------ */

const SEPARATORS_RE = /[\s\-_./\\:()[\]{}'",;]+/g;

export function normaliseValue(raw: string, n: Normalise): string {
  let v = raw.trim();
  if (n.case === "lower") v = v.toLowerCase();
  if (n.stripSeparators) v = v.replace(SEPARATORS_RE, "");
  return v;
}

/** A KeyObject skips the per-call key import that makes a raw Buffer key ~6x slower; EdmLookup binds one. */
export function hmacValue(key: Buffer | crypto.KeyObject, normalised: string): Buffer {
  return crypto.createHmac("sha256", key).update(normalised, "utf8").digest();
}

/* ------------------------------------------------------------------ *
 * Bloom filter — own implementation, k positions from the HMAC digest
 * ------------------------------------------------------------------ */

/** Optimal m/k for n items at rate p: m = -n ln p / (ln 2)^2, k = (m/n) ln 2. */
export function bloomParams(n: number, p = BLOOM_FP_RATE): { m: number; k: number } {
  const items = Math.max(1, n);
  const m = Math.ceil((-items * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / items) * Math.LN2));
  return { m: Math.max(8, m), k };
}

/** Kirsch–Mitzenmacher double hashing over the first 8 digest bytes: h_i = h1 + i·h2 (mod m). No extra hash function needed. */
export function bloomPositions(digest: Buffer, m: number, k: number): number[] {
  const h1 = digest.readUInt32BE(0);
  // `| 1` yields a signed int32; `>>> 0` brings it back to unsigned so positions never go negative.
  const h2 = (digest.readUInt32BE(4) | 1) >>> 0;
  const out = new Array<number>(k);
  for (let i = 0; i < k; i++) out[i] = (h1 + i * h2) % m;
  return out;
}

export class BloomFilter {
  readonly m: number;
  readonly k: number;
  readonly bits: Uint8Array;
  constructor(m: number, k: number, bits?: Uint8Array) {
    this.m = m;
    this.k = k;
    this.bits = bits ?? new Uint8Array(Math.ceil(m / 8));
  }
  add(digest: Buffer): void {
    for (const p of bloomPositions(digest, this.m, this.k)) this.bits[p >>> 3] |= 1 << (p & 7);
  }
  mightContain(digest: Buffer): boolean {
    for (const p of bloomPositions(digest, this.m, this.k)) if ((this.bits[p >>> 3] & (1 << (p & 7))) === 0) return false;
    return true;
  }
  toJSON(): EdmBloom { return { m: this.m, k: this.k, bits: Buffer.from(this.bits).toString("base64") }; }
  static fromJSON(b: EdmBloom): BloomFilter {
    const bits = new Uint8Array(Buffer.from(b.bits, "base64"));
    if (bits.length !== Math.ceil(b.m / 8)) throw new Error("bloom bit length does not match m");
    return new BloomFilter(b.m, b.k, bits);
  }
}

/* ------------------------------------------------------------------ *
 * CSV — minimal RFC 4180 (quoted fields, doubled quotes, CRLF)
 * ------------------------------------------------------------------ */

export function parseCsv(text: string, maxRows = MAX_ROWS): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endRow(); i++; if (rows.length > maxRows) throw new Error(`CSV exceeds ${maxRows} rows`); continue; }
    field += c; i++;
  }
  if (field !== "" || row.length > 0) endRow();
  if (rows.length === 0) throw new Error("CSV has no header row");
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

/* ------------------------------------------------------------------ *
 * Pattern guard — a tenant regex runs over every outbound body
 * ------------------------------------------------------------------ */

/** Reject patterns that are too long or nest quantifiers (the classic catastrophic-backtracking shape). */
export function compilePattern(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern longer than ${MAX_PATTERN_LENGTH} chars`);
  if (/\([^()]*[*+][^()]*\)\s*[*+{]/.test(pattern)) throw new Error("pattern nests quantifiers (catastrophic backtracking risk)");
  if (/(\\\d)/.test(pattern)) throw new Error("pattern uses backreferences");
  const re = new RegExp(pattern, "g");
  if (re.test("")) throw new Error("pattern matches the empty string");
  return re;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

export interface BuildSpec {
  name: string;
  /** Registry type id, e.g. "HR.EMPLOYEE_ID" or "CUSTOM.<tenant>.<NAME>". */
  type: string;
  columns: Array<{ name: string; primary?: boolean; normalise?: Partial<Normalise>; pattern?: string }>;
  csvText: string;
  /** Tenant slug; with a bare NAME it forms CUSTOM.<tenant>.<NAME>. */
  tenant?: string;
  /** Injected for tests; defaults to the device key (created on first build). */
  key?: Buffer;
}

export const DEFAULT_NORMALISE: Normalise = { case: "lower", stripSeparators: true };

/** Resolve the type id: a registry id as-is, or a bare NAME under CUSTOM.<tenant>. */
export function resolveType(type: string, tenant?: string): string {
  const t = type.trim();
  if (dataTypes().has(t)) return t;
  if (CUSTOM_TYPE_RE.test(t)) return t;
  if (tenant && /^[A-Za-z][A-Za-z0-9_ -]*$/.test(t)) return `CUSTOM.${tenant}.${t.toUpperCase().replace(/[^A-Z0-9_]+/g, "_")}`;
  throw new Error(`unknown data type "${t}" (use a registry id, CUSTOM.<tenant>.<NAME>, or --tenant with a bare name)`);
}

export function buildIndex(spec: BuildSpec): EdmIndex {
  if (!NAME_RE.test(spec.name)) throw new Error("index name must be 1–64 chars of [A-Za-z0-9_-]");
  if (Buffer.byteLength(spec.csvText, "utf8") > MAX_CSV_BYTES) throw new Error(`CSV exceeds ${MAX_CSV_BYTES} bytes`);
  const type = resolveType(spec.type, spec.tenant);
  if (!TYPE_RE.test(type)) throw new Error(`invalid type id ${type}`);
  if (spec.columns.length === 0 || spec.columns.length > MAX_COLUMNS) throw new Error(`1–${MAX_COLUMNS} columns required`);

  const columns: EdmColumn[] = spec.columns.map((c) => ({
    name: c.name.trim(),
    primary: !!c.primary,
    normalise: { ...DEFAULT_NORMALISE, ...(c.normalise ?? {}) },
    ...(c.pattern ? { pattern: c.pattern } : {}),
  }));
  const primaries = columns.filter((c) => c.primary);
  if (primaries.length !== 1) throw new Error("exactly one primary column is required");
  if (new Set(columns.map((c) => c.name)).size !== columns.length) throw new Error("duplicate column names");
  for (const c of columns) if (c.pattern) compilePattern(c.pattern);

  const { headers, rows } = parseCsv(spec.csvText);
  const colIdx = new Map<string, number>();
  for (const c of columns) {
    const i = headers.indexOf(c.name);
    if (i < 0) throw new Error(`column "${c.name}" not found in CSV header (${headers.join(", ")})`);
    colIdx.set(c.name, i);
  }

  const key = crypto.createSecretKey(spec.key ?? loadOrCreateKey());
  // Per-column digest sets; hex is the storage form, sorted so lookup can binary-search without a rebuild.
  const perColumn = new Map<string, Set<string>>(columns.map((c) => [c.name, new Set<string>()]));
  const digests: Buffer[] = [];
  let indexedRows = 0;
  for (const r of rows) {
    let any = false;
    for (const c of columns) {
      const v = normaliseValue(r[colIdx.get(c.name)!] ?? "", c.normalise);
      if (v.length === 0) continue;
      const d = hmacValue(key, v);
      const hex = d.toString("hex");
      const set = perColumn.get(c.name)!;
      if (!set.has(hex)) { set.add(hex); digests.push(d); }
      any = true;
    }
    if (any) indexedRows++;
  }
  if (digests.length === 0) throw new Error("CSV produced no indexable values");

  const { m, k } = bloomParams(digests.length);
  const bloom = new BloomFilter(m, k);
  for (const d of digests) bloom.add(d);

  const hashes: Record<string, string[]> = {};
  for (const [col, set] of perColumn) hashes[col] = [...set].sort();

  return { name: spec.name, type, columns, bloom: bloom.toJSON(), hashes, rows: indexedRows, builtAt: new Date().toISOString(), version: EDM_FORMAT_VERSION };
}

/** Write atomically (tmp + rename) with 0600 so a crash mid-write never leaves a half index the detector would trust. */
export function writeIndex(index: EdmIndex): string {
  validateIndex(index);
  fs.mkdirSync(edmHome(), { recursive: true, mode: 0o700 });
  const target = indexPath(index.name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index), { mode: 0o600 });
  fs.renameSync(tmp, target);
  return target;
}

/* ------------------------------------------------------------------ *
 * Load and validate
 * ------------------------------------------------------------------ */

const HEX64_RE = /^[0-9a-f]{64}$/;

export function validateIndex(x: unknown): asserts x is EdmIndex {
  const i = x as Partial<EdmIndex>;
  if (!i || typeof i !== "object") throw new Error("index is not an object");
  if (i.version !== EDM_FORMAT_VERSION) throw new Error(`unsupported index version ${String(i.version)}`);
  if (typeof i.name !== "string" || !NAME_RE.test(i.name)) throw new Error("invalid index name");
  if (typeof i.type !== "string" || !TYPE_RE.test(i.type)) throw new Error("invalid type id");
  if (!Array.isArray(i.columns) || i.columns.length === 0 || i.columns.length > MAX_COLUMNS) throw new Error("invalid columns");
  if (i.columns.filter((c) => c.primary).length !== 1) throw new Error("exactly one primary column is required");
  for (const c of i.columns) {
    if (typeof c.name !== "string" || !c.name) throw new Error("column without a name");
    if (!c.normalise || (c.normalise.case !== "lower" && c.normalise.case !== "keep") || typeof c.normalise.stripSeparators !== "boolean") throw new Error(`column ${c.name}: invalid normalise`);
    if (c.pattern !== undefined) { if (typeof c.pattern !== "string") throw new Error(`column ${c.name}: invalid pattern`); compilePattern(c.pattern); }
  }
  if (!i.bloom || !Number.isInteger(i.bloom.m) || !Number.isInteger(i.bloom.k) || i.bloom.k < 1 || i.bloom.k > 32 || typeof i.bloom.bits !== "string") throw new Error("invalid bloom");
  if (!i.hashes || typeof i.hashes !== "object") throw new Error("invalid hashes");
  for (const c of i.columns) {
    const list = i.hashes[c.name];
    if (!Array.isArray(list)) throw new Error(`hashes missing for column ${c.name}`);
    for (let n = 0; n < list.length; n++) {
      if (typeof list[n] !== "string" || !HEX64_RE.test(list[n])) throw new Error(`column ${c.name}: hash ${n} is not a sha256 hex digest`);
      if (n > 0 && list[n - 1] > list[n]) throw new Error(`column ${c.name}: hashes are not sorted`);
    }
  }
  if (typeof i.rows !== "number" || !Number.isInteger(i.rows) || i.rows < 0) throw new Error("invalid rows");
}

export interface LoadResult { indexes: EdmIndex[]; errors: string[] }

/** Every valid index under WRAPBOX_HOME/edm. Invalid files are reported, never silently skipped. */
export function loadIndexes(): LoadResult {
  const dir = edmHome();
  const out: LoadResult = { indexes: [], errors: [] };
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return out;
  }
  if (names.length > MAX_INDEXES) { out.errors.push(`more than ${MAX_INDEXES} index files; refusing to load any`); return out; }
  for (const f of names) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.size > MAX_INDEX_BYTES) throw new Error(`exceeds ${MAX_INDEX_BYTES} bytes`);
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      validateIndex(parsed);
      if (parsed.name !== f.slice(0, -5)) throw new Error(`name "${parsed.name}" does not match file name`);
      out.indexes.push(parsed);
    } catch (e) {
      out.errors.push(`${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

/** Binary search over a sorted hex list. */
function hasHex(sorted: string[], hex: string): boolean {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid];
    if (v === hex) return true;
    if (v < hex) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

/**
 * An opened index: key bound, Bloom decoded, digests memoised per call so a
 * body that repeats one token ten thousand times costs one HMAC.
 */
export class EdmLookup {
  readonly index: EdmIndex;
  readonly primary: EdmColumn;
  readonly supporting: EdmColumn[];
  private readonly bloom: BloomFilter;
  private readonly key: crypto.KeyObject;
  private readonly memo = new Map<string, Buffer>();
  private readonly rawMemo = new Map<string, Map<string, string | null>>();
  private readonly patterns = new Map<string, RegExp>();

  constructor(index: EdmIndex, key: Buffer) {
    validateIndex(index);
    this.index = index;
    this.key = crypto.createSecretKey(key);
    this.bloom = BloomFilter.fromJSON(index.bloom);
    this.primary = index.columns.find((c) => c.primary)!;
    this.supporting = index.columns.filter((c) => !c.primary);
    for (const c of index.columns) if (c.pattern) this.patterns.set(c.name, compilePattern(c.pattern));
  }

  pattern(column: EdmColumn): RegExp | undefined { return this.patterns.get(column.name); }

  /** Digest of a normalised value (memoised for the life of this lookup). */
  digest(normalised: string): Buffer {
    let d = this.memo.get(normalised);
    if (!d) {
      if (this.memo.size > MAX_CANDIDATES) this.memo.clear();
      d = hmacValue(this.key, normalised);
      this.memo.set(normalised, d);
    }
    return d;
  }

  /** Exact membership of a RAW candidate in a column: normalise → HMAC → Bloom → sorted list. Returns the hex on a hit. */
  match(column: EdmColumn, raw: string): string | null {
    // Raw-token memo per column: a 1 MB body repeats most tokens, and normalising is the hot path.
    let seen = this.rawMemo.get(column.name);
    if (!seen) { seen = new Map(); this.rawMemo.set(column.name, seen); }
    const cached = seen.get(raw);
    if (cached !== undefined) return cached;
    if (seen.size > MAX_CANDIDATES) seen.clear();
    let result: string | null = null;
    const v = normaliseValue(raw, column.normalise);
    if (v.length > 0) {
      const d = this.digest(v);
      if (this.bloom.mightContain(d)) {
        const hex = d.toString("hex");
        if (hasHex(this.index.hashes[column.name] ?? [], hex)) result = hex;
      }
    }
    seen.set(raw, result);
    return result;
  }
}

/* ------------------------------------------------------------------ *
 * Candidate extraction — shared by the detector and any future tester
 * ------------------------------------------------------------------ */

export interface Candidate { raw: string; start: number; end: number }

const TOKEN_RE = /[^\s,;]+/g;
const EDGE_PUNCT_RE = /^[.:!?"'()[\]{}<>]+|[.:!?"'()[\]{}<>]+$/g;

/**
 * Candidates from a text: the column's pattern when it has one; otherwise
 * whitespace/comma-separated tokens of 4–64 chars (edge punctuation trimmed).
 * `ngrams` > 1 additionally yields adjacent 2..n-token phrases — needed for
 * multi-word values (names) and only used inside the small proximity window.
 */
export function extractCandidates(text: string, pattern: RegExp | undefined, ngrams = 1, limit = MAX_CANDIDATES): Candidate[] {
  const out: Candidate[] = [];
  if (pattern) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      out.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
      if (out.length >= limit) break;
    }
    return out;
  }
  const toks: Candidate[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const trimmed = m[0].replace(EDGE_PUNCT_RE, "");
    if (trimmed.length === 0) continue;
    const lead = m[0].indexOf(trimmed);
    toks.push({ raw: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length });
    if (toks.length >= limit) break;
  }
  for (let i = 0; i < toks.length; i++) {
    for (let n = 1; n <= ngrams && i + n <= toks.length; n++) {
      const first = toks[i], last = toks[i + n - 1];
      const raw = n === 1 ? first.raw : text.slice(first.start, last.end);
      if (raw.length < MIN_TOKEN_LENGTH || raw.length > MAX_TOKEN_LENGTH) continue;
      out.push({ raw, start: first.start, end: last.end });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * CLI — `wrapboxd edm build|list` (the core wires the verb; this parses)
 * ------------------------------------------------------------------ */

export interface CliResult { code: number; lines: string[] }

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const USAGE = [
  "usage: wrapboxd edm build --name <index> --type <registry id | NAME> --csv <file> --primary <column>",
  "                         [--columns a,b] [--pattern <regex for primary>] [--tenant <slug>]",
  "                         [--case lower|keep] [--keep-separators]",
  "       wrapboxd edm list",
];

export function runEdmCli(args: string[]): CliResult {
  const { positional, flags } = parseArgs(args);
  const verb = positional[0];
  try {
    if (verb === "list") {
      const { indexes, errors } = loadIndexes();
      const lines = indexes.map((i) => `${i.name}\t${i.type}\trows=${i.rows}\tcolumns=${i.columns.map((c) => (c.primary ? `${c.name}*` : c.name)).join(",")}\tbuilt=${i.builtAt}`);
      if (lines.length === 0) lines.push(`no indexes under ${edmHome()}`);
      for (const e of errors) lines.push(`error: ${e}`);
      return { code: errors.length ? 1 : 0, lines };
    }
    if (verb !== "build") return { code: 2, lines: USAGE };
    const need = (k: string): string => {
      const v = flags[k];
      if (typeof v !== "string" || !v) throw new Error(`--${k} is required`);
      return v;
    };
    const name = need("name"), type = need("type"), csv = need("csv"), primary = need("primary");
    const extra = typeof flags.columns === "string" ? flags.columns.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const normalise: Partial<Normalise> = {};
    if (flags.case === "keep" || flags.case === "lower") normalise.case = flags.case;
    if (flags["keep-separators"] === true) normalise.stripSeparators = false;
    const columns: BuildSpec["columns"] = [{ name: primary, primary: true, normalise, ...(typeof flags.pattern === "string" ? { pattern: flags.pattern } : {}) }];
    for (const c of extra) if (c !== primary) columns.push({ name: c, normalise });
    const st = fs.statSync(csv);
    if (st.size > MAX_CSV_BYTES) throw new Error(`CSV exceeds ${MAX_CSV_BYTES} bytes`);
    const index = buildIndex({ name, type, columns, csvText: fs.readFileSync(csv, "utf8"), ...(typeof flags.tenant === "string" ? { tenant: flags.tenant } : {}) });
    const file = writeIndex(index);
    return { code: 0, lines: [`built ${index.name} (${index.type}): ${index.rows} rows, ${index.columns.length} columns → ${file}`, "the index stores keyed digests only; the CSV was not copied"] };
  } catch (e) {
    return { code: 1, lines: [`error: ${(e as Error).message}`, ...USAGE] };
  }
}
