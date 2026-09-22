/**
 * Document Parser Registry (§3, §4).
 *
 * One registry that says, per enterprise format, exactly what the runtime can
 * do with it: `canInspect` (extract text to classify), `canTransform` (mask
 * fields and re-serialise), a byte limit, and the MIME types it claims. The
 * decision path asks the registry — it never assumes.
 *
 * THE FAIL-CLOSED RULE (§4). A format we cannot INSPECT must not sail past a
 * content protection: if a block/review rule could apply and the body is in a
 * format this registry cannot read, the caller blocks. A format we can inspect
 * but not TRANSFORM cannot satisfy a CONSTRAIN (masking) rule, so that path
 * blocks too. Silence is never allow.
 *
 * DEPENDENCY POLICY. The daemon parses untrusted bytes on the hot path, so a
 * heavyweight parser is a supply-chain liability, not a convenience. Text-based
 * formats are read directly; Office formats (DOCX/XLSX) are ZIP-of-XML and are
 * read with a BOUNDED, zip-bomb-resistant unzip written here (§4); PDF text
 * extraction cannot be done safely without a large dependency, so PDF is
 * declared non-inspectable and fails closed — an honest limit, not a fake one.
 */

import zlib from "node:zlib";
import { detectFormat as detectStructured, type DocFormat } from "./structured.js";

export type ParseFormat =
  | "text" | "json" | "yaml" | "xml" | "html"
  | "csv" | "tsv" | "multipart"
  | "docx" | "xlsx" | "pdf" | "archive" | "binary" | "unknown";

export interface ParserDescriptor {
  id: string;
  formats: ParseFormat[];
  mimeTypes: string[];
  extensions: string[];
  /** Can extract text for classification. If false, a content protection over
   *  this format fails closed. */
  canInspect: boolean;
  /** Can mask named fields/classes and re-serialise. If false, a CONSTRAIN over
   *  this format fails closed. */
  canTransform: boolean;
  /** Largest input this parser will attempt, in bytes. */
  maxBytes: number;
  /** Runs locally in the daemon (vs. a cloud parser — none here). */
  local: boolean;
}

export interface ParserModule extends ParserDescriptor {
  /** Extract inspectable UTF-8 text. Returns null when extraction fails, which
   *  the caller MUST treat as "cannot inspect" (fail closed), never as clean. */
  extractText?: (body: Buffer) => ExtractResult | null;
}

export interface ExtractResult {
  text: string;
  truncated: boolean;
  /** How much decompressed output was produced (zip-bomb accounting). */
  bytesOut: number;
}

/* ------------------------------------------------------------------ *
 * Streaming / archive safety limits (§4)
 * ------------------------------------------------------------------ */

export const LIMITS = {
  /** Largest single decompressed output we will hold from any one encoded body. */
  maxDecompressedBytes: 96 * 1024 * 1024,
  /** Largest total text we will pull out of an archive (DOCX/XLSX). */
  maxArchiveTextBytes: 32 * 1024 * 1024,
  /** Most entries we will read from one archive. */
  maxArchiveEntries: 1024,
  /** Reject an archive entry whose declared expansion ratio exceeds this — the
   *  classic zip-bomb shape (a few KB inflating to gigabytes). */
  maxEntryRatio: 200,
  /** Refuse nested archives beyond this depth (an archive inside an archive). */
  maxArchiveDepth: 2,
} as const;

/* ------------------------------------------------------------------ *
 * Bounded decompression (§4) — the zip-bomb-safe primitive.
 *
 * Node's *Sync inflate helpers accept `maxOutputLength`; past it they THROW
 * rather than allocate, which is exactly the fail-closed behaviour we want.
 * ------------------------------------------------------------------ */

export function boundedInflate(body: Buffer, encoding: string, max = LIMITS.maxDecompressedBytes): Buffer | null {
  const enc = encoding.toLowerCase().trim();
  const opts = { maxOutputLength: max };
  try {
    if (enc === "gzip" || enc === "x-gzip") return zlib.gunzipSync(body, opts);
    if (enc === "deflate") return zlib.inflateSync(body, opts);
    if (enc === "br") return zlib.brotliDecompressSync(body, { maxOutputLength: max });
    if (enc === "zstd" && typeof (zlib as { zstdDecompressSync?: unknown }).zstdDecompressSync === "function") {
      return (zlib as unknown as { zstdDecompressSync: (b: Buffer, o: unknown) => Buffer }).zstdDecompressSync(body, opts);
    }
  } catch {
    // Over the bound, or corrupt. Null = "could not decode" → caller fails closed.
    return null;
  }
  return null; // unknown encoding
}

function boundedInflateRaw(body: Buffer, max: number): Buffer | null {
  try { return zlib.inflateRawSync(body, { maxOutputLength: max }); }
  catch { return null; }
}

/* ------------------------------------------------------------------ *
 * A minimal, bounded ZIP reader for Office documents.
 *
 * Reads the End-Of-Central-Directory record, walks the central directory for
 * accurate offsets and sizes, and inflates only the XML entries we want, each
 * under a strict output bound and a declared-ratio guard. It never trusts a
 * local-header size and never expands more than the budget allows.
 * ------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

interface ZipEntry { name: string; method: number; compSize: number; uncompSize: number; localOffset: number; }

function findEOCD(buf: Buffer): number {
  // The EOCD is at the end, within 22 + up to 65535 bytes of comment.
  const min = Math.max(0, buf.length - (22 + 65535));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  const eocd = findEOCD(buf);
  if (eocd === -1) return null;
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.maxArchiveEntries) count = LIMITS.maxArchiveEntries;

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf-8");
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one central-directory entry from its local header, bounded. */
function readEntry(buf: Buffer, e: ZipEntry, budget: number): Buffer | null {
  const lh = e.localOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, e.compSize > 0 ? dataStart + e.compSize : buf.length);
  // Zip-bomb ratio guard, measured against the ACTUAL compressed byte length so
  // a data-descriptor entry (compSize declared 0) cannot slip past it. The hard
  // bound is still `cap` via boundedInflateRaw's maxOutputLength; this is the
  // fast reject before we even attempt to inflate.
  const compBytes = e.compSize > 0 ? e.compSize : data.length;
  if (compBytes > 0 && e.uncompSize / compBytes > LIMITS.maxEntryRatio && e.uncompSize > 1_000_000) return null;
  const cap = Math.min(budget, e.uncompSize > 0 ? e.uncompSize + 1024 : budget);
  if (e.method === 0) return data.subarray(0, cap);        // stored
  if (e.method === 8) return boundedInflateRaw(data, cap);  // deflate
  return null;                                              // unsupported method
}

/** Extract concatenated text from the XML entries of a DOCX/XLSX, bounded. */
function extractOfficeText(body: Buffer, want: (name: string) => boolean): ExtractResult | null {
  const entries = readCentralDirectory(body);
  if (!entries) return null;
  let budget = LIMITS.maxArchiveTextBytes;
  let out = "";
  let truncated = false;
  let bytesOut = 0;
  let read = 0;
  for (const e of entries) {
    if (read++ > LIMITS.maxArchiveEntries) { truncated = true; break; }
    // A nested archive inside an Office file is not something we unpack — the
    // depth guard refuses it rather than recursing.
    if (/\.(zip|docx|xlsx|pptx)$/i.test(e.name)) continue;
    if (!want(e.name)) continue;
    if (budget <= 0) { truncated = true; break; }
    const raw = readEntry(body, e, budget);
    if (raw === null) return null;    // an entry we wanted but could not inflate → fail closed
    bytesOut += raw.length;
    budget -= raw.length;
    // Strip XML tags to plain text so the classifiers see words, not markup.
    out += " " + stripTags(raw.toString("utf-8"));
    if (budget <= 0) truncated = true;
  }
  return { text: out, truncated, bytesOut };
}

/* ------------------------------------------------------------------ *
 * Text extractors
 * ------------------------------------------------------------------ */

/**
 * Strip markup tags in a single LINEAR pass. A regex like /<[^>]*>/g backtracks
 * quadratically on input full of '<' with no '>', which is a denial-of-service
 * vector on a hot path that runs on untrusted bytes. indexOf is linear, so this
 * is O(n) regardless of input shape. Script/style CONTENT is deliberately kept
 * (a secret in an inline <script> must still be scanned) — only tags are removed.
 */
function stripTags(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) { out.push(s.slice(i)); break; }
    if (lt > i) out.push(s.slice(i, lt));
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) break;         // unterminated tag → drop the remainder
    out.push(" ");
    i = gt + 1;
  }
  return out.join("");
}

function stripHtml(body: Buffer): ExtractResult {
  const text = stripTags(body.toString("utf-8"));
  return { text, truncated: false, bytesOut: text.length };
}

function asText(body: Buffer): ExtractResult {
  const text = body.toString("utf-8");
  return { text, truncated: false, bytesOut: text.length };
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

const PARSERS: ParserModule[] = [
  { id: "text", formats: ["text"], mimeTypes: ["text/plain"], extensions: [".txt", ".md", ".log"], canInspect: true, canTransform: true, maxBytes: 64 * 1024 * 1024, local: true, extractText: asText },
  { id: "json", formats: ["json"], mimeTypes: ["application/json"], extensions: [".json"], canInspect: true, canTransform: true, maxBytes: 64 * 1024 * 1024, local: true, extractText: asText },
  { id: "csv", formats: ["csv", "tsv"], mimeTypes: ["text/csv", "text/tab-separated-values"], extensions: [".csv", ".tsv"], canInspect: true, canTransform: true, maxBytes: 64 * 1024 * 1024, local: true, extractText: asText },
  { id: "yaml", formats: ["yaml"], mimeTypes: ["application/yaml", "text/yaml", "application/x-yaml"], extensions: [".yaml", ".yml"], canInspect: true, canTransform: false, maxBytes: 16 * 1024 * 1024, local: true, extractText: asText },
  { id: "xml", formats: ["xml"], mimeTypes: ["application/xml", "text/xml"], extensions: [".xml"], canInspect: true, canTransform: false, maxBytes: 16 * 1024 * 1024, local: true, extractText: (b) => { const text = stripTags(b.toString("utf-8")); return { text, truncated: false, bytesOut: text.length }; } },
  { id: "html", formats: ["html"], mimeTypes: ["text/html", "application/xhtml+xml"], extensions: [".html", ".htm"], canInspect: true, canTransform: false, maxBytes: 16 * 1024 * 1024, local: true, extractText: stripHtml },
  { id: "multipart", formats: ["multipart"], mimeTypes: ["multipart/form-data"], extensions: [], canInspect: true, canTransform: true, maxBytes: 64 * 1024 * 1024, local: true },
  // Office: inspectable via the bounded unzip; NOT transformable (rewriting the
  // XML parts safely in place needs a real Office writer — CONSTRAIN fails closed).
  { id: "docx", formats: ["docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], extensions: [".docx"], canInspect: true, canTransform: false, maxBytes: 32 * 1024 * 1024, local: true, extractText: (b) => extractOfficeText(b, (n) => n === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(n)) },
  { id: "xlsx", formats: ["xlsx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], extensions: [".xlsx"], canInspect: true, canTransform: false, maxBytes: 32 * 1024 * 1024, local: true, extractText: (b) => extractOfficeText(b, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n)) },
  // PDF: text lives in compressed content streams; safe, complete extraction
  // needs a large dependency. Declared non-inspectable so any content
  // protection over a PDF fails closed rather than under-reading it.
  { id: "pdf", formats: ["pdf"], mimeTypes: ["application/pdf"], extensions: [".pdf"], canInspect: false, canTransform: false, maxBytes: 0, local: true },
];

export function allParsers(): ParserDescriptor[] {
  return PARSERS.map(({ extractText, ...d }) => { void extractText; return d; });
}

/* ------------------------------------------------------------------ *
 * Format detection (bytes are the authority) + capability lookup
 * ------------------------------------------------------------------ */

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from("%PDF-");

/** Detect the parse format from bytes first, then filename/CT. A DOCX and an
 *  XLSX are both ZIPs, so we peek at the central directory to tell them apart. */
export function detectParseFormat(body: Buffer, filename = "", contentType = ""): ParseFormat {
  if (body.subarray(0, 5).equals(PDF_MAGIC)) return "pdf";
  if (body.subarray(0, 4).equals(ZIP_MAGIC)) {
    const entries = readCentralDirectory(body);
    if (entries) {
      if (entries.some((e) => e.name.startsWith("word/"))) return "docx";
      if (entries.some((e) => e.name.startsWith("xl/"))) return "xlsx";
      if (entries.some((e) => e.name.startsWith("ppt/"))) return "binary"; // pptx: not handled → opaque
    }
    return "archive";  // a generic ZIP — opaque, fails closed for content rules
  }
  if (/multipart\/form-data/i.test(contentType)) return "multipart";
  if (/html/i.test(contentType) || /\.html?$/i.test(filename)) return "html";
  if (/xml/i.test(contentType) || /\.xml$/i.test(filename)) return "xml";
  if (/ya?ml/i.test(contentType) || /\.ya?ml$/i.test(filename)) return "yaml";

  // Fall back to the structured detector for csv/tsv/json/text.
  const s: DocFormat = detectStructured(body, filename, contentType);
  if (s === "csv" || s === "tsv" || s === "json" || s === "text") return s;
  // A body full of NUL bytes we cannot type is opaque binary → fail closed.
  if (body.length && body.subarray(0, 512).includes(0)) return "binary";
  return "unknown";
}

export function parserFor(format: ParseFormat): ParserModule | null {
  return PARSERS.find((p) => p.formats.includes(format)) ?? null;
}

/**
 * The one call the decision path makes: can we read this body's text, and if
 * so, what is it? On any failure `canInspect` is false and the caller fails
 * closed. `text` is only populated when extraction genuinely succeeded.
 */
export interface InspectResult {
  format: ParseFormat;
  canInspect: boolean;
  canTransform: boolean;
  text: string | null;
  truncated: boolean;
  reason?: string;
}

export function inspectBody(body: Buffer, filename = "", contentType = ""): InspectResult {
  const format = detectParseFormat(body, filename, contentType);
  const parser = parserFor(format);

  if (!parser) {
    return { format, canInspect: false, canTransform: false, text: null, truncated: false, reason: `no parser registered for ${format}` };
  }
  if (!parser.canInspect) {
    return { format, canInspect: false, canTransform: parser.canTransform, text: null, truncated: false, reason: `${format} cannot be safely inspected by this runtime` };
  }
  if (body.length > parser.maxBytes) {
    return { format, canInspect: false, canTransform: false, text: null, truncated: true, reason: `${format} exceeds the ${parser.maxBytes}-byte inspection limit` };
  }
  if (!parser.extractText) {
    // Inspectable in principle but no extractor here (e.g. multipart is handled
    // upstream). Treat as text.
    return { format, canInspect: true, canTransform: parser.canTransform, text: body.toString("utf-8"), truncated: false };
  }
  // A parser that THROWS on malformed bytes must fail closed, not crash the
  // decision path — any throw is treated exactly as "could not parse".
  let ex: ExtractResult | null;
  try { ex = parser.extractText(body); }
  catch { return { format, canInspect: false, canTransform: false, text: null, truncated: false, reason: `${format} parser threw — failing closed` }; }
  if (ex === null) {
    return { format, canInspect: false, canTransform: false, text: null, truncated: false, reason: `${format} could not be parsed — failing closed` };
  }
  return { format, canInspect: true, canTransform: parser.canTransform, text: ex.text, truncated: ex.truncated };
}
