/**
 * OCR extractor tests — real Vision round trip through the helper boundary.
 *
 * The fixture is produced by the helper's own `--render-test` mode, so the test
 * needs no checked-in image and no real document: a synthetic bitmap of a known
 * string. Every fail-closed path the extractor promises is exercised against
 * the real helper (unsupported, corrupt, oversize) or a stand-in helper script
 * (timeout, crash, malformed output). Skips honestly when the helper is not
 * built or the platform is not macOS.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractor, extractWith, helperPath, available, DESCRIPTOR, lastError } from "../extract/ocr.js";

const helper = process.platform === "darwin" ? helperPath() : null;
const skip = helper ? false : `wrapbox-ocr helper not available (${available().reason ?? "not macOS"}); run macos/ocr/build.sh`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-ocr-test-"));
function fixturePng(): Buffer {
  const p = path.join(tmp, "fixture.png");
  const r = spawnSync(helper!, ["--render-test", p]);
  assert.equal(r.status, 0, `--render-test failed: ${r.stderr}`);
  return fs.readFileSync(p);
}
function fakeHelper(name: string, script: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return p;
}

test("descriptor is the registry's wrapbox.ocr.vision and available() is honest", { skip }, () => {
  assert.equal(extractor.descriptor.id, "wrapbox.ocr.vision");
  assert.equal(DESCRIPTOR.tier, "device_helper");
  assert.deepEqual(extractor.available(), { ok: true });
});

test("available() reports the missing helper instead of pretending", () => {
  const saved = { helper: process.env.WRAPBOX_OCR_HELPER, home: process.env.WRAPBOX_HOME };
  try {
    process.env.WRAPBOX_OCR_HELPER = path.join(tmp, "does-not-exist");
    process.env.WRAPBOX_HOME = path.join(tmp, "nohome");
    // The repo build may still exist; only assert the reason shape when nothing is found.
    const a = available();
    if (!a.ok) assert.match(a.reason!, /wrapbox-ocr helper not found|only on macOS/);
  } finally {
    if (saved.helper === undefined) delete process.env.WRAPBOX_OCR_HELPER; else process.env.WRAPBOX_OCR_HELPER = saved.helper;
    if (saved.home === undefined) delete process.env.WRAPBOX_HOME; else process.env.WRAPBOX_HOME = saved.home;
  }
});

test("PNG rendered by --render-test round-trips through Vision into one text unit", { skip }, async () => {
  const png = fixturePng();
  const r = await extractor.extract(png, { filename: "screenshot.png", contentType: "image/png", unitPath: "multipart[0]" });
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (!r.ok) return;
  assert.equal(r.extractor, "wrapbox.ocr.vision");
  assert.equal(r.units.length, 1);
  const u = r.units[0];
  assert.equal(u.input, "text");
  assert.equal(u.format, "ocr");
  assert.match(u.text ?? "", /WRAPBOX OCR SELFTEST/);
  assert.equal(u.metadata.source, "ocr");
  assert.equal(u.metadata.page, "1");
  const conf = Number(u.metadata.confidence);
  assert.ok(conf >= 0 && conf <= 1, `confidence ${u.metadata.confidence}`);
  assert.equal(u.unitPath, "multipart[0]/ocr[1]");
  assert.equal(u.filename, "screenshot.png");
  assert.equal(u.truncated, false);
  assert.equal(lastError, null);
});

test("scanned PDF (sips-converted fixture) yields one unit per page", { skip }, async (t) => {
  const pngPath = path.join(tmp, "fixture.png");
  if (!fs.existsSync(pngPath)) fixturePng();
  const pdfPath = path.join(tmp, "fixture.pdf");
  const s = spawnSync("/usr/bin/sips", ["-s", "format", "pdf", pngPath, "--out", pdfPath], { stdio: "ignore" });
  if (s.status !== 0 || !fs.existsSync(pdfPath)) { t.skip("sips could not produce a PDF fixture"); return; }
  const r = await extractor.extract(fs.readFileSync(pdfPath), { filename: "scan.pdf", contentType: "application/pdf" });
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (!r.ok) return;
  assert.equal(r.units.length, 1);
  assert.match(r.units[0].text ?? "", /WRAPBOX OCR SELFTEST/);
  assert.equal(r.units[0].unitPath, "ocr[1]");
});

test("junk bytes → UNSUPPORTED_FORMAT (helper exit 3)", { skip }, async () => {
  const r = await extractor.extract(Buffer.from("this is not an image, just prose\n"), { filename: "x.bin" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.uninspectable.state, "UNSUPPORTED_FORMAT");
  assert.doesNotMatch(r.uninspectable.reason, /just prose/, "reason must never carry content");
});

test("truncated PNG → PARSER_FAILURE (helper exit 2)", { skip }, async () => {
  const r = await extractor.extract(fixturePng().subarray(0, 40), { filename: "x.png" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.uninspectable.state, "PARSER_FAILURE");
});

test("empty body → MALFORMED without spawning", async () => {
  const r = await extractWith(Buffer.alloc(0), {}, { helper: path.join(tmp, "never-run") });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.uninspectable.state, "MALFORMED");
});

test("oversize body → OVERSIZE without spawning", async () => {
  const r = await extractWith(Buffer.alloc(DESCRIPTOR.limits.maxBytes + 1), { unitPath: "zip[3]" }, { helper: path.join(tmp, "never-run") });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.uninspectable.state, "OVERSIZE"); assert.equal(r.uninspectable.unitPath, "zip[3]"); }
});

test("missing helper → PARSER_FAILURE, never an empty unit list", async () => {
  const r = await extractWith(Buffer.from("x"), {}, { helper: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.uninspectable.state, "PARSER_FAILURE");
});

test("helper that hangs → TIMEOUT and the temp file is removed", { skip: process.platform !== "darwin" }, async () => {
  const slow = fakeHelper("slow.sh", "sleep 30");
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("wrapbox-ocr-") && !n.startsWith("wrapbox-ocr-test-")).length;
  const t0 = Date.now();
  const r = await extractWith(Buffer.from("x"), {}, { helper: slow, timeoutMs: 300 });
  assert.ok(Date.now() - t0 < 5000, "timeout must be enforced");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.uninspectable.state, "TIMEOUT");
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("wrapbox-ocr-") && !n.startsWith("wrapbox-ocr-test-")).length;
  assert.equal(after, before, "temp dir must be deleted in finally");
});

test("helper that exits 0 with malformed JSON → PARSER_FAILURE (fail closed)", { skip: process.platform !== "darwin" }, async () => {
  const bad = fakeHelper("bad.sh", `echo '{"page":1,"text":"ok","confidence":7}'`);
  const r = await extractWith(Buffer.from("x"), {}, { helper: bad, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.uninspectable.state, "PARSER_FAILURE");
  const silent = fakeHelper("silent.sh", "exit 0");
  const r2 = await extractWith(Buffer.from("x"), {}, { helper: silent, timeoutMs: 2000 });
  assert.equal(r2.ok, false);
});

test("helper that crashes (exit 1) → PARSER_FAILURE", { skip: process.platform !== "darwin" }, async () => {
  const crash = fakeHelper("crash.sh", "echo boom >&2; exit 1");
  const r = await extractWith(Buffer.from("x"), {}, { helper: crash, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.uninspectable.state, "PARSER_FAILURE"); assert.equal(r.uninspectable.reason, "boom"); }
});

test("page cap marks the last unit truncated", { skip: process.platform !== "darwin" }, async () => {
  const lines = Array.from({ length: 50 }, (_, i) => `echo '{"page":${i + 1},"text":"p${i + 1}","confidence":0.5}'`).join("\n");
  const many = fakeHelper("many.sh", lines);
  const r = await extractWith(Buffer.from("x"), {}, { helper: many, timeoutMs: 5000 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.units.length, 50);
  assert.equal(r.units[49].truncated, true);
  assert.equal(r.units[48].truncated, false);
  assert.equal(r.units[49].metadata.pageCap, "50");
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
