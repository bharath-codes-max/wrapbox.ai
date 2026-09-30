/**
 * The inspection pipeline: bytes → content units → findings.
 *
 *   body ──► extraction (Tier 0 parsers; optional OCR helper / Tika sidecar)
 *        ──► ContentUnit tree (text / table / structured / metadata, with paths)
 *        ──► every available detector, per unit
 *        ──► Findings aggregated by registry type (count, confidence, unit paths)
 *
 * Or, honestly, an UNINSPECTABLE state. The state is explicit and evaluable —
 * a PDF with no sidecar is `UNSUPPORTED_FORMAT`, an encrypted archive is
 * `ENCRYPTED`, a bomb is `DECOMPRESSION_REFUSED` — and the policy gate fails
 * closed on it wherever a protection could apply. "Nothing found" is only ever
 * said about bytes that were actually read.
 *
 * Label metadata is extracted even when the body itself cannot be: a labelled
 * but RMS-encrypted docx still yields its MSIP_Label_* properties, so a policy
 * on the label can decide without the content.
 */

import { dataTypes, type ContentUnit, type Finding, type UninspectableState } from "@wrapbox/registry";
import { inspectBody, detectParseFormat, type ParseFormat } from "./parsers.js";
import { parseMultipart, isMultipart as isMultipartCT, isFilePart } from "./multipart.js";
import { parseTable } from "./structured.js";
import { detectAll } from "./detectors/index.js";
import { extractorFor } from "./extract/index.js";

export const MAX_SCAN_BYTES = 4 * 1024 * 1024;

export interface Inspection {
  units: ContentUnit[];
  findings: Finding[];
  types: string[];
  inspection: "inspected" | "uninspectable";
  state?: UninspectableState;
  reason?: string;
  extractor: string;
  filenames: string[];
  hasFileUpload: boolean;
  bytes: number;
  truncated: boolean;
  format: ParseFormat | string;
  detectorVersions: Record<string, string>;
}

type LabelExtractor = (bytes: Buffer, hints: { filename?: string; contentType?: string }) => Record<string, string>;
let labelExtractor: LabelExtractor | null | undefined;
/** Optional plugin: runtime/src/extract/label-metadata.ts (MIP labels). */
async function loadLabelExtractor(): Promise<LabelExtractor | null> {
  if (labelExtractor !== undefined) return labelExtractor;
  try {
    const mod = (await import("./extract/label-metadata.js")) as { extractLabelMetadata?: LabelExtractor };
    labelExtractor = typeof mod.extractLabelMetadata === "function" ? mod.extractLabelMetadata : null;
  } catch { labelExtractor = null; }
  return labelExtractor;
}
export function setLabelExtractorForTests(fn: LabelExtractor | null): void { labelExtractor = fn; }

function stateFor(format: string, reason: string | undefined, bytes: number, maxBytes: number): UninspectableState {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("exceeds") || (maxBytes > 0 && bytes > maxBytes)) return "OVERSIZE";
  if (r.includes("threw")) return "PARSER_FAILURE";
  if (r.includes("could not be parsed") || r.includes("malformed")) return "MALFORMED";
  if (r.includes("decompress") || r.includes("bomb")) return "DECOMPRESSION_REFUSED";
  if (r.includes("encrypt") || r.includes("password")) return "ENCRYPTED";
  if (r.includes("nested") || r.includes("depth")) return "DEPTH_EXCEEDED";
  if (format === "pdf" || format === "archive" || format === "binary" || format === "unknown") return "UNSUPPORTED_FORMAT";
  return "UNSUPPORTED_FORMAT";
}

const inputFor = (format: string): ContentUnit["input"] =>
  format === "csv" || format === "tsv" || format === "xlsx" ? "table" : format === "json" || format === "yaml" || format === "xml" ? "structured" : "text";

/** Tier-0 extraction of one part into a unit, or an explicit failure. */
function tier0Unit(bytes: Buffer, hints: { filename?: string; contentType?: string; unitPath: string; depth: number }): { unit?: ContentUnit; fail?: { state: UninspectableState; reason: string; format: string } } {
  const ins = inspectBody(bytes, hints.filename ?? "", hints.contentType ?? "");
  if (!ins.canInspect) return { fail: { state: stateFor(ins.format, ins.reason, bytes.length, 0), reason: ins.reason ?? `${ins.format} cannot be inspected`, format: ins.format } };
  const text = ins.text ?? "";
  const unit: ContentUnit = {
    id: hints.unitPath, depth: hints.depth, format: ins.format, sniffedBy: "magic", input: inputFor(ins.format),
    text: text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text,
    metadata: {}, truncated: ins.truncated || text.length > MAX_SCAN_BYTES, unitPath: hints.unitPath, extractor: "wrapbox.tier0",
    ...(hints.filename ? { filename: hints.filename } : {}), ...(hints.contentType ? { contentType: hints.contentType } : {}),
  };
  if (unit.input === "table" && (ins.format === "csv" || ins.format === "tsv")) {
    const t = parseTable(text.slice(0, MAX_SCAN_BYTES), ins.format === "tsv" ? "\t" : ",");
    if (t) unit.table = { headers: t.headers, rows: t.rows.slice(0, 200000) };
  }
  if (ins.format === "json" && text.length <= MAX_SCAN_BYTES) { try { unit.json = JSON.parse(text); } catch { /* keep text */ } }
  return { unit };
}

function attachLabels(unit: ContentUnit | undefined, bytes: Buffer, hints: { filename?: string; contentType?: string }): Record<string, string> {
  const fn = labelExtractor ?? null;
  if (!fn) return {};
  try {
    const meta = fn(bytes, hints);
    if (unit) Object.assign(unit.metadata, meta);
    return meta;
  } catch { return {}; }
}

interface PartInput { bytes: Buffer; filename?: string; contentType?: string; unitPath: string; isFile: boolean }

function splitParts(body: Buffer, contentType: string): { parts: PartInput[]; multipart: boolean; malformed: boolean } {
  if (!isMultipartCT(contentType)) return { parts: [{ bytes: body, contentType, unitPath: "root", isFile: false }], multipart: false, malformed: false };
  const parsed = parseMultipart(body, contentType);
  if (!parsed) return { parts: [], multipart: true, malformed: true };
  const parts: PartInput[] = [];
  parsed.parts.forEach((p, i) => {
    const file = isFilePart(p);
    parts.push({ bytes: p.body, ...(p.filename ? { filename: p.filename.slice(0, 256) } : {}), ...(p.contentType ? { contentType: p.contentType } : {}), unitPath: file ? `part[${i}]/${p.filename ?? "file"}` : `part[${i}]`, isFile: file });
  });
  return { parts, multipart: true, malformed: false };
}

type Failure = { state: UninspectableState; reason: string; unitPath: string };
interface Prepared {
  parts: PartInput[]; multipart: boolean; units: ContentUnit[]; truncated: boolean;
  /** Parts Tier 0 could not read, with the format guess an optional extractor would need. */
  pending: Array<{ part: PartInput; format: string; fail: Failure }>;
  failure: Failure | null; filenames: string[]; hasFileUpload: boolean; bytes: number;
}

/** Phase A (sync): split, Tier-0 extract, label metadata. */
function prepare(body: Buffer, contentType: string): Prepared {
  // An empty request body carries no content to inspect (a bodyless GET/HEAD/
  // OPTIONS, a CONNECT, a bare form POST). There is nothing that could be
  // exfiltrated, so this is "inspected, found nothing" — NOT uninspectable.
  // Treating it as UNINSPECTABLE would fail a content protection closed on
  // ordinary bodyless traffic. Destination-only protections still apply: the
  // gate evaluates them regardless of body.
  if (body.length === 0) {
    return { parts: [], multipart: false, units: [], truncated: false, pending: [], failure: null, filenames: [], hasFileUpload: false, bytes: 0 };
  }
  const { parts, multipart, malformed } = splitParts(body, contentType);
  const filenames = parts.map((p) => p.filename).filter((f): f is string => !!f);
  const hasFileUpload = parts.some((p) => p.isFile);
  const units: ContentUnit[] = [];
  const pending: Prepared["pending"] = [];
  let truncated = false;
  let failure: Failure | null = malformed ? { state: "MALFORMED", reason: "malformed multipart body", unitPath: "root" } : null;

  if (filenames.length) units.push({ id: "meta", depth: 0, format: "metadata", sniffedBy: "declared", input: "metadata", metadata: { filenames: filenames.join(",") }, truncated: false, unitPath: "meta", extractor: "wrapbox.tier0" });

  for (const p of parts) {
    if (failure) break;
    const t0 = tier0Unit(p.bytes, { filename: p.filename, contentType: p.contentType, unitPath: p.unitPath, depth: multipart ? 1 : 0 });
    if (t0.unit) { attachLabels(t0.unit, p.bytes, { filename: p.filename, contentType: p.contentType }); units.push(t0.unit); truncated ||= t0.unit.truncated; continue; }
    // Tier 0 could not read it. Label metadata may still be readable (a labelled, encrypted docx).
    const meta = attachLabels(undefined, p.bytes, { filename: p.filename, contentType: p.contentType });
    if (Object.keys(meta).length) units.push({ id: `${p.unitPath}#meta`, depth: 1, format: "metadata", sniffedBy: "magic", input: "metadata", metadata: meta, truncated: false, unitPath: `${p.unitPath}#meta`, extractor: "wrapbox.tier0", ...(p.filename ? { filename: p.filename } : {}) });
    const format = t0.fail!.format;
    pending.push({ part: p, format: format === "binary" || format === "unknown" ? guessFormat(p) : format, fail: { state: t0.fail!.state, reason: t0.fail!.reason, unitPath: p.unitPath } });
  }
  return { parts, multipart, units, truncated, pending, failure, filenames, hasFileUpload, bytes: body.length };
}

/** Phase C (sync): detectors, aggregation, the verdict shape. */
function finish(pre: Prepared, extractor: string, failure: Failure | null, contentType: string): Inspection {
  const per: Finding[] = [];
  for (const u of pre.units) {
    per.push(...detectAll({
      ...(u.text !== undefined ? { text: u.text } : {}), format: u.format, input: u.input,
      ...(u.filename ? { filename: u.filename } : {}), ...(u.contentType ? { contentType: u.contentType } : {}),
      ...(u.table ? { table: u.table } : {}), ...(u.json !== undefined ? { json: u.json } : {}),
      metadata: u.metadata, unitPath: u.unitPath,
    }));
  }
  const findings = aggregate(per);
  if (failure) findings.push({ type: `UNINSPECTABLE.${failure.state}`, count: 1, confidence: "high", detector: extractor, version: "1", unitPath: failure.unitPath, label: failure.reason.slice(0, 120) });
  const detectorVersions: Record<string, string> = {};
  for (const f of findings) detectorVersions[f.detector] = f.version;
  const p0 = pre.parts[0];
  const format = p0 ? detectParseFormat(p0.bytes, p0.filename ?? "", p0.contentType ?? "") : "unknown";
  void contentType;
  return {
    units: pre.units, findings, types: [...new Set(findings.map((f) => f.type))].sort(),
    inspection: failure ? "uninspectable" : "inspected",
    ...(failure ? { state: failure.state, reason: failure.reason } : {}),
    extractor, filenames: pre.filenames, hasFileUpload: pre.hasFileUpload, bytes: pre.bytes, truncated: pre.truncated, format: pre.multipart ? "multipart" : format, detectorVersions,
  };
}

function guessFormat(p: PartInput): string {
  const n = (p.filename ?? "").toLowerCase();
  const ct = (p.contentType ?? "").toLowerCase();
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|bmp|heic|webp)$/.test(n)) return "image";
  if (/\.(pptx?)$/.test(n) || ct.includes("presentation")) return "pptx";
  if (/\.(docx?)$/.test(n)) return "docx";
  if (/\.(xlsx?)$/.test(n)) return "xlsx";
  if (/\.(zip|jar)$/.test(n) || ct.includes("zip")) return "zip";
  if (/\.(tar|tgz|gz|7z|rar)$/.test(n)) return "tar";
  if (/\.(eml|msg)$/.test(n) || ct.includes("message/rfc822")) return "eml";
  if (/\.rtf$/.test(n)) return "rtf";
  if (/\.(odt|ods|odp)$/.test(n)) return "odt";
  return "unknown";
}

/** Sum counts per type across units; keep the best confidence; remember every unit path. */
export function aggregate(per: Finding[]): Finding[] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const byType = new Map<string, Finding & { paths: Set<string> }>();
  for (const f of per) {
    const prev = byType.get(f.type);
    if (!prev) { byType.set(f.type, { ...f, paths: new Set(f.unitPath ? [f.unitPath] : []) }); continue; }
    prev.count += f.count;
    if (rank[f.confidence] > rank[prev.confidence]) { prev.confidence = f.confidence; prev.detector = f.detector; prev.version = f.version; }
    if (f.unitPath) prev.paths.add(f.unitPath);
    if (f.fields?.length) prev.fields = [...new Set([...(prev.fields ?? []), ...f.fields])];
  }
  return [...byType.values()].map(({ paths, ...f }) => ({ ...f, ...(paths.size ? { unitPath: [...paths].join(";").slice(0, 300) } : {}) }));
}

/** Tier 0 only, synchronous — tests, self-checks and the gateway. Parts Tier 0
 *  cannot read are UNINSPECTABLE here (no sidecar is consulted). */
export function inspectSync(body: Buffer, contentType = ""): Inspection {
  const pre = prepare(body, contentType);
  const failure = pre.failure ?? pre.pending[0]?.fail ?? null;
  return finish(pre, "wrapbox.tier0", failure, contentType);
}

/** Full pipeline with optional extractors (OCR helper, Tika sidecar) — the daemon's path. */
export async function inspectAsync(body: Buffer, contentType = ""): Promise<Inspection> {
  await loadLabelExtractor();
  const pre = prepare(body, contentType);
  let extractor = "wrapbox.tier0";
  let failure: Failure | null = pre.failure;
  for (const pend of pre.pending) {
    if (failure) break;
    const ext = extractorFor(pend.format);
    if (!ext) { failure = pend.fail; break; }
    extractor = ext.descriptor.id;
    let res: Awaited<ReturnType<typeof ext.extract>>;
    try { res = await ext.extract(pend.part.bytes, { filename: pend.part.filename, contentType: pend.part.contentType, unitPath: pend.part.unitPath, depth: 1 }); }
    catch (e) { res = { ok: false, uninspectable: { state: "PARSER_FAILURE", reason: (e as Error).message.slice(0, 160) }, extractor: ext.descriptor.id }; }
    if (res.ok) {
      for (const u of res.units) { pre.units.push({ ...u, text: u.text && u.text.length > MAX_SCAN_BYTES ? u.text.slice(0, MAX_SCAN_BYTES) : u.text }); pre.truncated ||= u.truncated; }
      continue;
    }
    for (const u of res.uninspectable.partialUnits ?? []) pre.units.push(u);
    failure = { state: res.uninspectable.state, reason: res.uninspectable.reason, unitPath: res.uninspectable.unitPath ?? pend.part.unitPath };
  }
  return finish(pre, extractor, failure, contentType);
}

/** Every registry type — the fail-closed gate's worst case. */
export function allTypes(): string[] { return dataTypes().ids(); }
