/**
 * wrapbox.label.mip — regression suite.
 *
 * Fixtures are generated here: a minimal DOCX (real zip structure, deflated
 * parts, custom.xml with MSIP properties), a DOCX carrying only the
 * co-authoring LabelInfo.xml, a fake PDF with an Info dictionary and XMP, an
 * RFC 822 message with the msip_labels header, plus hostile inputs (random
 * zip, random bytes, empty). Every Finding's JSON is searched for the
 * SiteId / SetDate / ActionId values — those must never leave the detector.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

// WRAPBOX_HOME is read at call time by the detector, so set it before import
// for clarity and rely on the call-time read for correctness.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-labels-"));
process.env.WRAPBOX_HOME = home;

const { detector, detectLabels, lastError } = await import("../detectors/labels.js");
const { extractLabelMetadata, extractLabelMetadataDetailed, groupLabelMetadata } = await import("../extract/label-metadata.js");

/* ------------------------------------------------------------------ *
 * minimal zip writer — mirrors what parsers.ts readCentralDirectory expects
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<[string, string | Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameB = Buffer.from(name, "utf-8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, nameB, comp]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameB]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------ *
 * fixtures — obviously fake ids
 * ------------------------------------------------------------------ */

const GUID_HC = "11111111-2222-4333-8444-555555555555";   // mapped → HIGHLY_CONFIDENTIAL
const GUID_UNMAPPED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITE_ID = "99999999-0000-4000-8000-123456789abc";
const SET_DATE = "2026-09-01T09:30:00Z";
const ACTION_ID = "fedcba98-7654-4321-8000-000000000001";
const SECRET_VALUES = [SITE_ID, SET_DATE, ACTION_ID];

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`;
const DOCUMENT_XML = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p></w:body></w:document>`;

function customXml(guid: string, opts: { name: string; bits: string; enabled?: string }): string {
  const props = [
    ["Enabled", opts.enabled ?? "true"], ["SiteId", SITE_ID], ["SetDate", SET_DATE], ["Name", opts.name],
    ["ContentBits", opts.bits], ["Method", "Privileged"], ["ActionId", ACTION_ID],
  ];
  const body = props.map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="MSIP_Label_${guid}_${k}"><vt:lpwstr>${v}</vt:lpwstr></property>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${body}</Properties>`;
}

function docxWithCustom(guid: string, opts: { name: string; bits: string; enabled?: string }): Buffer {
  return makeZip([["[Content_Types].xml", CONTENT_TYPES], ["word/document.xml", DOCUMENT_XML], ["docProps/custom.xml", customXml(guid, opts)]]);
}

function docxWithLabelInfo(guid: string, removed = "0"): Buffer {
  const li = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata"><clbl:label id="{${guid}}" enabled="1" method="Privileged" siteId="{${SITE_ID}}" contentBits="8" removed="${removed}"/></clbl:labelList>`;
  return makeZip([["[Content_Types].xml", CONTENT_TYPES], ["word/document.xml", DOCUMENT_XML], ["docMetadata/LabelInfo.xml", li]]);
}

function fakePdf(guid: string, opts: { name: string; bits: string; xmp?: boolean }): Buffer {
  const info = `<< /Producer (Acrobat) /MSIP_Label_${guid}_Enabled (true) /MSIP_Label_${guid}_SiteId (${SITE_ID}) /MSIP_Label_${guid}_Name (${opts.name}) /MSIP_Label_${guid}_ContentBits (${opts.bits}) /MSIP_Label_${guid}_SetDate (${SET_DATE}) /MSIP_Label_${guid}_ActionId <${Buffer.from(ACTION_ID, "latin1").toString("hex")}> /MSIP_Label_${guid}_Method (Standard) >>`;
  const xmp = opts.xmp ? `<x:xmpmeta><rdf:Description xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"><pdfx:MSIP_Label_${guid}_Enabled>true</pdfx:MSIP_Label_${guid}_Enabled><pdfx:MSIP_Label_${guid}_Name>${opts.name}</pdfx:MSIP_Label_${guid}_Name></rdf:Description></x:xmpmeta>` : "";
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n${info}\nendobj\n3 0 obj\n<< /Type /Metadata /Subtype /XML >>\nstream\n${xmp}\nendstream\nendobj\ntrailer\n<< /Info 2 0 R >>\n%%EOF\n`, "latin1");
}

function eml(guid: string, opts: { name: string; bits: string }): Buffer {
  return Buffer.from(
    `From: sender@example.test\r\nTo: rcpt@example.test\r\nSubject: hello\r\n` +
    `msip_labels: MSIP_Label_${guid}_Enabled=true; MSIP_Label_${guid}_SiteId=${SITE_ID};\r\n` +
    ` MSIP_Label_${guid}_SetDate=${SET_DATE}; MSIP_Label_${guid}_Name=${opts.name};\r\n` +
    ` MSIP_Label_${guid}_ContentBits=${opts.bits}; MSIP_Label_${guid}_Method=Standard; MSIP_Label_${guid}_ActionId=${ACTION_ID}\r\n` +
    `\r\nBody text.\r\n`, "latin1");
}

function assertNoValues(findings: unknown): void {
  const json = JSON.stringify(findings);
  for (const v of SECRET_VALUES) assert.ok(!json.includes(v), `finding leaked a value: ${v}`);
}

const labelsJson = path.join(home, "labels.json");
before(() => {
  fs.writeFileSync(labelsJson, JSON.stringify({ mip: { [GUID_HC]: { name: "Highly Confidential", type: "LABEL.MIP.HIGHLY_CONFIDENTIAL" } } }));
});
after(() => { fs.rmSync(home, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ *
 * tests
 * ------------------------------------------------------------------ */

test("descriptor and availability", () => {
  assert.equal(detector.descriptor.id, "wrapbox.label.mip");
  const av = detector.available();
  assert.equal(av.ok, true);
  assert.match(av.reason ?? "", /label reading: ok/);
  assert.match(av.reason ?? "", /labels\.mip: present \(1 mapped label/);
});

test("docx custom.xml: mapped label + PROTECTED bit, no values leak", () => {
  const bytes = docxWithCustom(GUID_HC, { name: "Highly Confidential", bits: "8" });
  const meta = extractLabelMetadata(bytes, { filename: "plan.docx" });
  assert.equal(meta[`MSIP_Label_${GUID_HC}_Enabled`], "true");
  assert.equal(meta[`MSIP_Label_${GUID_HC}_ContentBits`], "8");
  assert.equal(meta[`MSIP_Label_${GUID_HC}_SiteId`], SITE_ID);
  assert.equal(extractLabelMetadataDetailed(bytes).source, "ooxml_custom");
  assert.equal(groupLabelMetadata(meta).size, 1);

  // via metadata (the extractor populated ContentUnit.metadata)
  const f1 = detector.detect({ format: "docx", input: "metadata", metadata: meta });
  const types1 = f1.map((f) => f.type).sort();
  assert.deepEqual(types1, ["LABEL.MIP.HIGHLY_CONFIDENTIAL", "LABEL.MIP.PROTECTED"]);
  const hc = f1.find((f) => f.type === "LABEL.MIP.HIGHLY_CONFIDENTIAL")!;
  assert.equal(hc.label, "Highly Confidential");
  assert.equal(hc.count, 1);
  assert.equal(hc.confidence, "high");
  assert.equal(hc.detector, "wrapbox.label.mip");
  assertNoValues(f1);

  // via bytes (no metadata supplied) — detector extracts itself
  const f2 = detector.detect({ format: "docx", input: "metadata", bytes: bytes, filename: "plan.docx" });
  assert.deepEqual(f2.map((f) => f.type).sort(), types1);
  assertNoValues(f2);
  assert.equal(lastError, null);
});

test("docx: unmapped GUID → LABEL.MIP with unmapped:<guid> and the name as suffix; no PROTECTED when bits lack 0x8", () => {
  const bytes = docxWithCustom(GUID_UNMAPPED, { name: "Secret Project", bits: "3" });
  const f = detector.detect({ format: "docx", input: "metadata", bytes });
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "LABEL.MIP");
  assert.equal(f[0].label, `unmapped:${GUID_UNMAPPED} (Secret Project)`);
  assertNoValues(f);
});

test("docx: Enabled=false emits nothing", () => {
  const bytes = docxWithCustom(GUID_HC, { name: "Highly Confidential", bits: "8", enabled: "false" });
  assert.deepEqual(detector.detect({ format: "docx", input: "metadata", bytes }), []);
});

test("docx: co-authoring LabelInfo.xml fallback when custom.xml is absent; removed=1 honoured", () => {
  const bytes = docxWithLabelInfo(GUID_HC);
  const d = extractLabelMetadataDetailed(bytes);
  assert.equal(d.source, "ooxml_labelinfo");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_Enabled`], "true");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_ContentBits`], "8");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_SiteId`], SITE_ID);
  const f = detector.detect({ format: "docx", input: "metadata", bytes });
  assert.deepEqual(f.map((x) => x.type).sort(), ["LABEL.MIP.HIGHLY_CONFIDENTIAL", "LABEL.MIP.PROTECTED"]);
  assertNoValues(f);
  assert.deepEqual(detector.detect({ format: "docx", input: "metadata", bytes: docxWithLabelInfo(GUID_HC, "1") }), []);
});

test("pdf: Info dictionary (literal + hex) and XMP", () => {
  const bytes = fakePdf(GUID_HC, { name: "Highly Confidential", bits: "8", xmp: true });
  const d = extractLabelMetadataDetailed(bytes, { contentType: "application/pdf" });
  assert.equal(d.source, "pdf");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_Enabled`], "true");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_ActionId`], ACTION_ID);   // hex string decoded
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_Method`], "Standard");
  const f = detector.detect({ format: "pdf", input: "metadata", bytes });
  assert.deepEqual(f.map((x) => x.type).sort(), ["LABEL.MIP.HIGHLY_CONFIDENTIAL", "LABEL.MIP.PROTECTED"]);
  assertNoValues(f);

  // XMP-only PDF (no Info keys) still reads
  const xmpOnly = Buffer.from(`%PDF-1.7\n<x:xmpmeta><rdf:Description xmlns:pdfx="x"><pdfx:MSIP_Label_${GUID_UNMAPPED}_Enabled>true</pdfx:MSIP_Label_${GUID_UNMAPPED}_Enabled><pdfx:MSIP_Label_${GUID_UNMAPPED}_Name>Internal Draft</pdfx:MSIP_Label_${GUID_UNMAPPED}_Name></rdf:Description></x:xmpmeta>\n%%EOF`, "latin1");
  const f2 = detector.detect({ format: "pdf", input: "metadata", bytes: xmpOnly });
  assert.equal(f2.length, 1);
  assert.equal(f2[0].type, "LABEL.MIP");
  assert.equal(f2[0].label, `unmapped:${GUID_UNMAPPED} (Internal Draft)`);
});

test("email: folded msip_labels header", () => {
  const bytes = eml(GUID_HC, { name: "Highly Confidential", bits: "8" });
  const d = extractLabelMetadataDetailed(bytes, { contentType: "message/rfc822" });
  assert.equal(d.source, "email");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_ContentBits`], "8");
  assert.equal(d.pairs[`MSIP_Label_${GUID_HC}_Name`], "Highly Confidential");
  // sniffed without a hint too
  assert.equal(extractLabelMetadataDetailed(bytes).source, "email");
  const f = detector.detect({ format: "text", input: "metadata", bytes, filename: "m.eml" });
  assert.deepEqual(f.map((x) => x.type).sort(), ["LABEL.MIP.HIGHLY_CONFIDENTIAL", "LABEL.MIP.PROTECTED"]);
  assertNoValues(f);
});

test("two labels mapped to the same type collapse into one finding with count 2", () => {
  fs.writeFileSync(labelsJson, JSON.stringify({ mip: {
    [GUID_HC]: { name: "Highly Confidential", type: "LABEL.MIP.HIGHLY_CONFIDENTIAL" },
    [GUID_UNMAPPED]: { name: "Highly Confidential", type: "LABEL.MIP.HIGHLY_CONFIDENTIAL" },
    "00000000-0000-4000-8000-000000000000": { name: "Bogus", type: "PII.CONTACT.EMAIL" },   // illegal target → ignored
  } }));
  const meta = {
    [`MSIP_Label_${GUID_HC}_Enabled`]: "true", [`MSIP_Label_${GUID_HC}_ContentBits`]: "0",
    [`MSIP_Label_${GUID_UNMAPPED}_Enabled`]: "true", [`MSIP_Label_${GUID_UNMAPPED}_ContentBits`]: "8",
  };
  const f = detectLabels({ format: "docx", input: "metadata", metadata: meta, unitPath: "zip[0]/plan.docx" });
  const hc = f.find((x) => x.type === "LABEL.MIP.HIGHLY_CONFIDENTIAL")!;
  assert.equal(hc.count, 2);
  assert.equal(hc.unitPath, "zip[0]/plan.docx");
  assert.equal(f.find((x) => x.type === "LABEL.MIP.PROTECTED")!.count, 1);
  assert.match(detector.available().reason ?? "", /maps to unknown type "PII.CONTACT.EMAIL"/);
  assert.match(detector.available().reason ?? "", /2 mapped labels/);
});

test("no labels.json: still available, GUIDs reported unmapped", () => {
  fs.rmSync(labelsJson);
  const av = detector.available();
  assert.equal(av.ok, true);
  assert.match(av.reason ?? "", /labels\.mip: absent/);
  const f = detector.detect({ format: "docx", input: "metadata", bytes: docxWithCustom(GUID_HC, { name: "Highly Confidential", bits: "0" }) });
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "LABEL.MIP");
  assert.equal(f[0].label, `unmapped:${GUID_HC} (Highly Confidential)`);
  fs.writeFileSync(labelsJson, JSON.stringify({ mip: { [GUID_HC]: { name: "Highly Confidential", type: "LABEL.MIP.HIGHLY_CONFIDENTIAL" } } }));
});

test("hostile inputs: random zip, random bytes, truncated zip, empty, unlabelled docx, CFB → [] and no throw", () => {
  const randomZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(4096)]);
  const randomBytes = crypto.randomBytes(8192);
  const truncated = docxWithCustom(GUID_HC, { name: "x", bits: "8" }).subarray(0, 120);
  const plain = makeZip([["[Content_Types].xml", CONTENT_TYPES], ["word/document.xml", DOCUMENT_XML]]);
  const cfb = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), crypto.randomBytes(1024)]);
  for (const b of [randomZip, randomBytes, truncated, plain, cfb, Buffer.alloc(0)]) {
    assert.deepEqual(extractLabelMetadata(b, { filename: "x.docx" }), {});
    assert.deepEqual(detector.detect({ format: "docx", input: "metadata", bytes: b }), []);
  }
  assert.deepEqual(detector.detect({ format: "text", input: "metadata" }), []);
  // corrupt labels.json must not break detection
  fs.writeFileSync(labelsJson, "{ not json");
  const f = detector.detect({ format: "docx", input: "metadata", bytes: docxWithCustom(GUID_HC, { name: "HC", bits: "8" }) });
  assert.equal(f.find((x) => x.type === "LABEL.MIP")?.label, `unmapped:${GUID_HC} (HC)`);
  assert.match(detector.available().reason ?? "", /labels\.json unreadable/);
});

test("bounded: an oversize PDF is scanned only to MAX_SCAN_BYTES and a huge key set is capped", () => {
  const guidAt = (i: number) => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  let info = "";
  for (let i = 0; i < 500; i++) info += `/MSIP_Label_${guidAt(i)}_Enabled (true) `;
  const pdf = Buffer.from(`%PDF-1.7\n<< ${info} >>\n%%EOF`, "latin1");
  const pairs = extractLabelMetadata(pdf);
  assert.ok(Object.keys(pairs).length <= 64);
  const big = Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), Buffer.alloc(9 * 1024 * 1024, 0x20), Buffer.from(`/MSIP_Label_${GUID_HC}_Enabled (true)`, "latin1")]);
  assert.deepEqual(extractLabelMetadata(big), {});   // beyond the scan window: honestly not read
});
