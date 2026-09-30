/**
 * Microsoft Purview / MIP sensitivity-label metadata reader — WITHOUT the MIP SDK.
 *
 * WHY THIS EXISTS. A labelled document is a finding in its own right (§LABEL in
 * the data-type registry): a tenant that says "Highly Confidential never leaves
 * the estate" needs the runtime to READ the label the tenant's own tooling
 * stamped on the file, not re-classify the content. The MIP SDK is a large
 * native dependency with its own auth flow, which is exactly what we do not put
 * on the daemon's hot path. The label metadata itself is plain and documented
 * (learn.microsoft.com → information-protection/develop/concept-mip-metadata):
 *
 *   MSIP_Label_<GUID>_Enabled      "true" while the label is applied
 *   MSIP_Label_<GUID>_Name         display name at time of labelling
 *   MSIP_Label_<GUID>_SiteId       tenant id
 *   MSIP_Label_<GUID>_Method       "Standard" | "Privileged"
 *   MSIP_Label_<GUID>_SetDate      ISO-8601
 *   MSIP_Label_<GUID>_ContentBits  bitmask: 1 header, 2 footer, 4 watermark, 8 encryption
 *   MSIP_Label_<GUID>_ActionId     audit correlation id
 *
 * and it is stored in three documented places we can read with what we already
 * have in-process:
 *
 *   OOXML  docProps/custom.xml  <property name="MSIP_Label_…"><vt:lpwstr>v</vt:lpwstr>
 *          docMetadata/LabelInfo.xml (co-authoring location; clbl:label attributes)
 *   PDF    the Info dictionary  /MSIP_Label_… (v)   and/or XMP  MSIP_Label_…
 *   Email  one header           msip_labels: MSIP_Label_…_Enabled=true; …
 *
 * This module returns the raw pair set (GUID-keyed, exactly as written) so an
 * extractor can put it in `ContentUnit.metadata` and the label detector can
 * read it back. It never decides what a label MEANS — that is the tenant's
 * label map and the detector's job.
 *
 * LIMITS. Legacy binary Office (CFB: .doc/.xls/.ppt) keeps LabelInfo in a
 * compound-file stream; we do not parse CFB and return {} for it — an honest
 * gap, not a guess. Reads are bounded: at most MAX_SCAN_BYTES of any input is
 * looked at, each zip part at most MAX_PART_BYTES, at most MAX_PAIRS pairs,
 * each value at most MAX_VALUE_CHARS. Nothing here throws.
 */

import { zipEntry } from "../parsers.js";

export const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_PART_BYTES = 1024 * 1024;
const MAX_PAIRS = 64;
const MAX_VALUE_CHARS = 512;

/** A well-formed MSIP key: GUID-scoped, documented suffix shape. Anchored, linear. */
const MSIP_KEY_RE = /^MSIP_Label_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_([A-Za-z][A-Za-z0-9_]{0,40})$/;
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface LabelHints { filename?: string; contentType?: string }

/** Where the pairs came from — recorded for evidence, never a value. */
export type LabelSource = "ooxml_custom" | "ooxml_labelinfo" | "pdf" | "email" | "none";

/**
 * All MSIP_Label_* pairs found in `bytes`, keyed exactly as written
 * (`MSIP_Label_<guid>_<Suffix>`). Empty when there are none or the format is
 * one we cannot read. Never throws.
 */
export function extractLabelMetadata(bytes: Buffer, hints: LabelHints = {}): Record<string, string> {
  return extractLabelMetadataDetailed(bytes, hints).pairs;
}

export function extractLabelMetadataDetailed(bytes: Buffer, hints: LabelHints = {}): { pairs: Record<string, string>; source: LabelSource } {
  try {
    if (!bytes || bytes.length === 0) return { pairs: {}, source: "none" };
    const body = bytes.length > MAX_SCAN_BYTES ? bytes.subarray(0, MAX_SCAN_BYTES) : bytes;
    const kind = sniff(body, hints);
    if (kind === "ooxml") {
      const custom = readOoxmlCustomProps(bytes);
      if (Object.keys(custom).length) return { pairs: custom, source: "ooxml_custom" };
      const li = readOoxmlLabelInfo(bytes);
      if (Object.keys(li).length) return { pairs: li, source: "ooxml_labelinfo" };
      return { pairs: {}, source: "none" };
    }
    if (kind === "pdf") {
      const p = readPdf(body);
      return { pairs: p, source: Object.keys(p).length ? "pdf" : "none" };
    }
    if (kind === "email") {
      const p = readEmailHeader(body);
      return { pairs: p, source: Object.keys(p).length ? "email" : "none" };
    }
    return { pairs: {}, source: "none" };
  } catch {
    return { pairs: {}, source: "none" };
  }
}

/** Group a pair set by label GUID → { Enabled, Name, ContentBits, … }. */
export function groupLabelMetadata(pairs: Record<string, string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(pairs)) {
    const m = MSIP_KEY_RE.exec(k);
    if (!m) continue;
    const guid = m[1].toLowerCase();
    const g = out.get(guid) ?? {};
    g[m[2]] = v;
    out.set(guid, g);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Format sniffing — magic first, declared hints only as a tie-break.
 * ------------------------------------------------------------------ */

function sniff(body: Buffer, hints: LabelHints): "ooxml" | "pdf" | "email" | "cfb" | "unknown" {
  if (body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04) return "ooxml";
  if (body.length >= 5 && body.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (body.length >= 8 && body.readUInt32LE(0) === 0xe011cfd0 && body.readUInt32LE(4) === 0xe11ab1a1) return "cfb";
  const ct = (hints.contentType ?? "").toLowerCase();
  const fn = (hints.filename ?? "").toLowerCase();
  if (ct.startsWith("message/rfc822") || fn.endsWith(".eml") || fn.endsWith(".emlx")) return "email";
  if (ct === "application/pdf" || fn.endsWith(".pdf")) return "pdf";
  // RFC 822 shape without a hint: header lines then a blank line.
  const head = body.subarray(0, 4096).toString("latin1");
  if (/^[A-Za-z][A-Za-z0-9-]*:[ \t]/.test(head) && /\r?\n\r?\n/.test(head)) return "email";
  return "unknown";
}

/* ------------------------------------------------------------------ *
 * OOXML
 * ------------------------------------------------------------------ */

/**
 * docProps/custom.xml. Each property is
 *   <property fmtid="…" pid="N" name="MSIP_Label_…"><vt:lpwstr>value</vt:lpwstr></property>
 * We walk the parts with indexOf (linear) rather than one big regex.
 */
function readOoxmlCustomProps(zip: Buffer): Record<string, string> {
  const part = zipEntry(zip, "docProps/custom.xml", MAX_PART_BYTES);
  if (!part) return {};
  const xml = part.toString("utf-8");
  const pairs: Record<string, string> = {};
  let i = 0;
  let n = 0;
  while (n < MAX_PAIRS) {
    const at = xml.indexOf("<property", i);
    if (at === -1) break;
    const end = xml.indexOf("</property>", at);
    if (end === -1) break;
    const block = xml.slice(at, end);
    i = end + 11;
    const nm = /\bname="([^"]{0,80})"/.exec(block);
    if (!nm) continue;
    const key = decodeXml(nm[1]);
    if (!MSIP_KEY_RE.test(key)) continue;
    // Value is the text of the vt:* child (lpwstr for MIP; accept any vt type).
    const val = /<vt:[A-Za-z0-9]+[^>]*>([^<]{0,600})<\/vt:[A-Za-z0-9]+>/.exec(block);
    if (!val) continue;
    pairs[key] = clampValue(decodeXml(val[1]));
    n++;
  }
  return pairs;
}

/**
 * docMetadata/LabelInfo.xml — the co-authoring location Office writes since
 * 2020 (namespace http://schemas.microsoft.com/office/2020/mipLabelMetadata):
 *   <clbl:label id="{GUID}" enabled="1" method="Privileged" siteId="{GUID}"
 *               contentBits="8" removed="0" setDate="…" actionId="{…}" name="…"/>
 * Attributes map 1:1 onto the MSIP_Label_* keys, so we re-key them to the
 * documented custom-property names and the detector sees one shape.
 */
function readOoxmlLabelInfo(zip: Buffer): Record<string, string> {
  const part = zipEntry(zip, "docMetadata/LabelInfo.xml", MAX_PART_BYTES);
  if (!part) return {};
  const xml = part.toString("utf-8");
  const pairs: Record<string, string> = {};
  const attrMap: Record<string, string> = { enabled: "Enabled", method: "Method", siteId: "SiteId", contentBits: "ContentBits", removed: "Removed", setDate: "SetDate", actionId: "ActionId", name: "Name" };
  let i = 0;
  let n = 0;
  while (n < MAX_PAIRS) {
    const at = xml.indexOf("<clbl:label", i);
    if (at === -1) break;
    const end = xml.indexOf(">", at);
    if (end === -1) break;
    const tag = xml.slice(at, end);
    i = end + 1;
    const idm = /\bid="\{?([0-9a-fA-F-]{36})\}?"/.exec(tag);
    if (!idm || !GUID_RE.test(idm[1])) continue;
    const guid = idm[1].toLowerCase();
    const attrRe = /\b([A-Za-z]+)="([^"]{0,600})"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(tag)) && n < MAX_PAIRS) {
      const suffix = attrMap[a[1]];
      if (!suffix) continue;
      let v = decodeXml(a[2]);
      if (suffix === "Enabled" || suffix === "Removed") v = v === "1" || v.toLowerCase() === "true" ? "true" : "false";
      if (suffix === "SiteId" || suffix === "ActionId") v = v.replace(/^\{|\}$/g, "");
      pairs[`MSIP_Label_${guid}_${suffix}`] = clampValue(v);
      n++;
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------ *
 * PDF — Info dictionary and XMP, scanned as bytes.
 *
 * We deliberately do not parse PDF object structure (that is the reason PDF
 * text extraction is declared non-inspectable in parsers.ts). Label keys are
 * unambiguous byte-strings, so a bounded scan for the three documented
 * encodings is both safe and complete for our purpose:
 *   /MSIP_Label_X (literal)      /MSIP_Label_X <hex>      Info dictionary
 *   <pdfx:MSIP_Label_X>v</…>     MSIP_Label_X="v"          XMP
 * Every quantifier is bounded and every class excludes its own terminator, so
 * the scan is linear in the input.
 * ------------------------------------------------------------------ */

function readPdf(body: Buffer): Record<string, string> {
  const s = body.toString("latin1");
  const pairs: Record<string, string> = {};
  let n = 0;
  const put = (key: string, val: string) => {
    if (n >= MAX_PAIRS || !MSIP_KEY_RE.test(key) || key in pairs) return;
    pairs[key] = clampValue(val);
    n++;
  };
  // Info dictionary: /Key (literal) or /Key <hex>
  const dict = /\/(MSIP_Label_[0-9a-fA-F-]{36}_[A-Za-z0-9_]{1,41})\s{0,8}(?:\(([^()]{0,600})\)|<([0-9a-fA-F\s]{0,1200})>)/g;
  let m: RegExpExecArray | null;
  while ((m = dict.exec(s)) && n < MAX_PAIRS) {
    if (m[2] !== undefined) put(m[1], unescapePdfLiteral(m[2]));
    else if (m[3] !== undefined) put(m[1], decodePdfHex(m[3]));
  }
  // XMP element form
  const xmpEl = /<(?:[A-Za-z0-9]{1,16}:)?(MSIP_Label_[0-9a-fA-F-]{36}_[A-Za-z0-9_]{1,41})>([^<]{0,600})<\//g;
  while ((m = xmpEl.exec(s)) && n < MAX_PAIRS) put(m[1], decodeXml(m[2]));
  // XMP attribute form
  const xmpAttr = /\b(?:[A-Za-z0-9]{1,16}:)?(MSIP_Label_[0-9a-fA-F-]{36}_[A-Za-z0-9_]{1,41})="([^"]{0,600})"/g;
  while ((m = xmpAttr.exec(s)) && n < MAX_PAIRS) put(m[1], decodeXml(m[2]));
  return pairs;
}

function unescapePdfLiteral(v: string): string {
  return v.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8) & 0xff);
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c;
  });
}

function decodePdfHex(h: string): string {
  const clean = h.replace(/\s+/g, "");
  const buf = Buffer.from(clean.length % 2 ? clean + "0" : clean, "hex");
  // UTF-16BE with BOM is the PDF text-string convention; otherwise PDFDocEncoding ≈ latin1.
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < buf.length; i += 2) out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    return out;
  }
  return buf.toString("latin1");
}

/* ------------------------------------------------------------------ *
 * Email — the single `msip_labels` header Outlook writes:
 *   msip_labels: MSIP_Label_<guid>_Enabled=true; MSIP_Label_<guid>_SiteId=…; …
 * Folded continuation lines (leading whitespace) are joined per RFC 5322.
 * ------------------------------------------------------------------ */

function readEmailHeader(body: Buffer): Record<string, string> {
  const s = body.toString("latin1");
  const headEnd = s.search(/\r?\n\r?\n/);
  const head = (headEnd === -1 ? s : s.slice(0, headEnd)).slice(0, 256 * 1024);
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const pairs: Record<string, string> = {};
  let n = 0;
  for (const line of unfolded.split(/\r?\n/)) {
    const c = line.indexOf(":");
    if (c === -1) continue;
    const name = line.slice(0, c).trim().toLowerCase();
    if (name !== "msip_labels" && name !== "msip_label") continue;
    for (const kv of line.slice(c + 1).split(";")) {
      const eq = kv.indexOf("=");
      if (eq === -1) continue;
      const key = kv.slice(0, eq).trim();
      if (!MSIP_KEY_RE.test(key) || n >= MAX_PAIRS) continue;
      pairs[key] = clampValue(kv.slice(eq + 1).trim());
      n++;
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]{1,6}|#[0-9]{1,7});/g, (_, e: string) => {
    if (e === "amp") return "&"; if (e === "lt") return "<"; if (e === "gt") return ">";
    if (e === "quot") return "\""; if (e === "apos") return "'";
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function clampValue(v: string): string {
  // Control characters have no place in label metadata; cap length so a
  // hostile file cannot make the metadata map itself the oversize payload.
  const clean = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return clean.length > MAX_VALUE_CHARS ? clean.slice(0, MAX_VALUE_CHARS) : clean;
}
