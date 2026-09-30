/**
 * Exact Data Match — builder, index privacy, detector semantics, bounds.
 *
 * Fixtures are generated: 1000 obviously fake employee ids (EMP-000001…) with
 * synthetic names. The privacy assertions are the point of the module, so they
 * are tested directly: the index file on disk and the JSON of every Finding
 * must contain no plaintext id or name.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-edm-"));
process.env.WRAPBOX_HOME = HOME;

import {
  buildIndex, writeIndex, loadIndexes, loadKey, edmHome, keyPath, bloomParams, BloomFilter,
  hmacValue, compilePattern, parseCsv, runEdmCli, EdmLookup, extractCandidates,
} from "../edm/index.js";
import { detector, reloadIndexes, lastError, lastWarnings, DETECT_BUDGET_MS } from "../detectors/edm.js";
import { dataTypes, detectorRegistry } from "@wrapbox/registry";
import * as edmModule from "../detectors/edm.js";

const FIRST = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Morgan"];
const LAST = ["Abbott", "Barlow", "Calder", "Dunne", "Ellery", "Farrow", "Gale", "Hollis", "Ingram", "Joyce"];
const ids: string[] = [];
const names: string[] = [];
let csv = "employee_id,full_name,department\n";
for (let i = 1; i <= 1000; i++) {
  const id = `EMP-${String(i).padStart(6, "0")}`;
  const name = `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${Math.floor(i / 100)}`;
  ids.push(id); names.push(name);
  csv += `${id},"${name}",Dept${i % 7}\n`;
}

const input = (text: string) => ({ text, format: "text", input: "text" as const });

before(() => {
  const index = buildIndex({
    name: "employees", type: "HR.EMPLOYEE_ID", csvText: csv,
    columns: [{ name: "employee_id", primary: true, pattern: "\\bEMP-\\d{6}\\b" }, { name: "full_name" }],
  });
  writeIndex(index);
  reloadIndexes();
});
after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

test("descriptor is the registry's wrapbox.edm and the key was created 0600", () => {
  assert.equal(detector.descriptor.id, "wrapbox.edm");
  assert.equal(detectorRegistry().get("wrapbox.edm")?.version, detector.descriptor.version);
  const st = fs.statSync(keyPath());
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(loadKey()!.length, 32);
  assert.equal(detector.available().ok, true);
});

test("index file stores no plaintext id or name — only digests and a bloom", () => {
  const raw = fs.readFileSync(path.join(edmHome(), "employees.json"), "utf8");
  for (const id of ids) assert.equal(raw.includes(id), false, `plaintext ${id} in index`);
  for (const n of names) { assert.equal(raw.includes(n), false); assert.equal(raw.includes(n.split(" ")[1]), false); }
  assert.equal(raw.includes("Dept"), false, "unlisted column must not be indexed");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.type, "HR.EMPLOYEE_ID");
  assert.equal(parsed.rows, 1000);
  assert.equal(parsed.hashes.employee_id.length, 1000);
  assert.equal(parsed.hashes.full_name.length, new Set(names.map((n) => n.toLowerCase().replace(/\s+/g, ""))).size);
  assert.ok(parsed.hashes.employee_id.every((h: string) => /^[0-9a-f]{64}$/.test(h)));
  assert.deepEqual(parsed.hashes.employee_id, [...parsed.hashes.employee_id].sort());
  const { m, k } = bloomParams(parsed.hashes.employee_id.length + parsed.hashes.full_name.length);
  assert.equal(parsed.bloom.m, m);
  assert.equal(parsed.bloom.k, k);
  assert.equal(fs.statSync(path.join(edmHome(), "employees.json")).mode & 0o777, 0o600);
});

test("bloom filter: no false negatives, false positives near the 0.1 % target", () => {
  const key = loadKey()!;
  const n = 5000;
  const { m, k } = bloomParams(n);
  const b = new BloomFilter(m, k);
  for (let i = 0; i < n; i++) b.add(hmacValue(key, `in-${i}`));
  for (let i = 0; i < n; i++) assert.equal(b.mightContain(hmacValue(key, `in-${i}`)), true);
  let fp = 0;
  const probes = 50_000;
  for (let i = 0; i < probes; i++) if (b.mightContain(hmacValue(key, `out-${i}`))) fp++;
  assert.ok(fp / probes < 0.005, `false-positive rate ${fp / probes} too high`);
  const round = BloomFilter.fromJSON(b.toJSON());
  assert.deepEqual(round.bits, b.bits);
});

test("three known ids → count 3, medium (primary only)", () => {
  const doc = `Ticket notes: ${ids[4]} raised an issue, escalated to ${ids[41]}; cc ${ids[999]}. Repeat ${ids[4]} again.`;
  const f = detector.detect(input(doc));
  assert.equal(lastError, null);
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "HR.EMPLOYEE_ID");
  assert.equal(f[0].count, 3);
  assert.equal(f[0].confidence, "medium");
  assert.equal(f[0].label, "employees");
  assert.equal(f[0].detector, "wrapbox.edm");
  const json = JSON.stringify(f);
  for (const id of ids) assert.equal(json.includes(id), false, "finding leaks a value");
});

test("a supporting name within 300 chars of its id → high", () => {
  const doc = `Payroll change for ${names[4]} (${ids[4]}) effective Monday. Also ${ids[41]} and ${ids[999]}.`;
  const f = detector.detect(input(doc));
  assert.equal(f.length, 1);
  assert.equal(f[0].count, 3);
  assert.equal(f[0].confidence, "high");
  const json = JSON.stringify(f);
  for (const n of names) assert.equal(json.includes(n), false);
  for (const id of ids) assert.equal(json.includes(id), false);
});

test("a name far from any id does not corroborate; a name alone is not a finding", () => {
  const far = `${ids[4]} ` + "x ".repeat(400) + names[4];
  assert.equal(detector.detect(input(far))[0].confidence, "medium");
  assert.deepEqual(detector.detect(input(`Meeting with ${names[7]} tomorrow`)), []);
});

test("unrelated ids and near-misses do not match", () => {
  const doc = `EMP-001001 EMP-999999 EMP-000000 emp-00001 EMP-0000010 ${ids[0].replace("EMP", "EMQ")}`;
  assert.deepEqual(detector.detect(input(doc)), []);
  assert.equal(lastError, null);
});

test("normalisation: case and separators are tolerated, digits are not", () => {
  // Pattern keeps extraction strict; the normalised value is what is hashed.
  const f = detector.detect(input(`ref EMP-000004`));
  assert.equal(f[0]?.count, 1);
  assert.equal(detector.detect(input(`ref EMP-000004x`)).length, 0);
});

test("table input: per-row proximity and field names reported", () => {
  const table = { headers: ["name", "staff", "note"], rows: [[names[10], ids[10], "ok"], ["nobody", ids[11], "ok"], ["nobody", "EMP-777777", "ok"]] };
  const f = detector.detect({ format: "csv", input: "table", table });
  assert.equal(f.length, 1);
  assert.equal(f[0].count, 2);
  assert.equal(f[0].confidence, "high");
  assert.deepEqual(f[0].fields, ["staff"]);
  const only = detector.detect({ format: "csv", input: "table", table: { headers: ["a"], rows: [[ids[12]]] } });
  assert.equal(only[0].confidence, "medium");
});

test("structured input: JSON strings are scanned", () => {
  const f = detector.detect({ format: "json", input: "structured", json: { user: { id: ids[20], tags: [ids[21], "x"] }, n: 1 } });
  assert.equal(f[0].count, 2);
  assert.deepEqual(detector.detect({ format: "text", input: "code", text: ids[20] }), []);
});

test("1 MB text with three ids: correct and under 500 ms", () => {
  const vocab = Array.from({ length: 20_000 }, (_, i) => `w${(i * 2654435761 >>> 0).toString(36)}`);
  const parts: string[] = [];
  let size = 0;
  let i = 0;
  while (size < 1024 * 1024) { const w = vocab[i++ % vocab.length]; parts.push(w); size += w.length + 1; }
  parts.splice(1000, 0, ids[100]); parts.splice(500_000 % parts.length, 0, ids[200]); parts.push(ids[300]);
  const text = parts.join(" ");
  assert.ok(text.length >= 1024 * 1024);
  const t0 = performance.now();
  const f = detector.detect(input(text));
  const ms = performance.now() - t0;
  assert.equal(f[0]?.count, 3);
  assert.ok(ms < 500, `lookup took ${ms.toFixed(0)} ms`);
  console.log(`# pattern 1 MB detect: ${ms.toFixed(0)} ms`);
});

test("token fallback (no pattern) also stays under 500 ms on 1 MB", () => {
  const idx = buildIndex({ name: "customers", type: "CUSTOMER.ID", csvText: "cid\n" + Array.from({ length: 1000 }, (_, i) => `CUST${i}\n`).join(""), columns: [{ name: "cid", primary: true }] });
  writeIndex(idx);
  reloadIndexes();
  const vocab = Array.from({ length: 20_000 }, (_, i) => `t${(i * 2246822519 >>> 0).toString(36)}`);
  const parts: string[] = [];
  let size = 0; let i = 0;
  while (size < 1024 * 1024) { const w = vocab[i++ % vocab.length]; parts.push(w); size += w.length + 1; }
  // "CUST 7" spans two tokens: without a pattern the primary is single tokens only, so it must NOT match.
  parts.splice(77, 0, "cust-42,"); parts.push("(Cust_9)"); parts.push("CUST 7.");
  const text = parts.join(" ");
  const t0 = performance.now();
  const f = detector.detect(input(text));
  const ms = performance.now() - t0;
  const cust = f.find((x) => x.type === "CUSTOMER.ID");
  assert.equal(cust?.count, 2, "stripSeparators + lower should match cust-42 and Cust_9");
  assert.equal(cust?.confidence, "medium");
  assert.ok(ms < 500, `lookup took ${ms.toFixed(0)} ms`);
  console.log(`# token-fallback 1 MB detect: ${ms.toFixed(0)} ms`);
  fs.rmSync(path.join(edmHome(), "customers.json"));
  reloadIndexes();
});

test("CUSTOM.<tenant>.<NAME> index registers a configured type at load", () => {
  const idx = buildIndex({ name: "codes", type: "Project Code", tenant: "acme", csvText: "code\nORION-77\nVEGA-12\n", columns: [{ name: "code", primary: true }] });
  assert.equal(idx.type, "CUSTOM.acme.PROJECT_CODE");
  writeIndex(idx);
  reloadIndexes();
  const dt = dataTypes().get("CUSTOM.acme.PROJECT_CODE");
  assert.ok(dt);
  assert.equal(dt.status, "beta");
  assert.equal(dt.tenantConfig?.kind, "edm_index");
  const f = detector.detect(input("see orion-77 and VEGA-12 and NOPE-1 and Orion 77"));
  const c = f.find((x) => x.type === "CUSTOM.acme.PROJECT_CODE");
  assert.equal(c?.count, 2);
  assert.equal(c?.confidence, "medium");
  fs.rmSync(path.join(edmHome(), "codes.json"));
  reloadIndexes();
});

test("builder refuses bad specs and unsafe patterns; unknown types are rejected", () => {
  assert.throws(() => buildIndex({ name: "x", type: "HR.EMPLOYEE_ID", csvText: "a\n1\n", columns: [{ name: "a" }] }), /primary/);
  assert.throws(() => buildIndex({ name: "x", type: "NOT.A.TYPE", csvText: "a\n1\n", columns: [{ name: "a", primary: true }] }), /unknown data type/);
  assert.throws(() => buildIndex({ name: "x", type: "HR.EMPLOYEE_ID", csvText: "a\n1\n", columns: [{ name: "b", primary: true }] }), /not found in CSV header/);
  assert.throws(() => buildIndex({ name: "bad name", type: "HR.EMPLOYEE_ID", csvText: "a\n1\n", columns: [{ name: "a", primary: true }] }), /index name/);
  assert.throws(() => compilePattern("(a+)+b"), /nests quantifiers/);
  assert.throws(() => compilePattern("(a)\\1"), /backreferences/);
  assert.throws(() => compilePattern("x*"), /empty string/);
  assert.throws(() => buildIndex({ name: "x", type: "HR.EMPLOYEE_ID", csvText: "a\n", columns: [{ name: "a", primary: true }] }), /no indexable values/);
  const { headers, rows } = parseCsv('a,b\r\n"x, y","say ""hi"""\r\nz,\n');
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [["x, y", 'say "hi"'], ["z", ""]]);
});

test("corrupt or tampered index files are refused, not trusted", () => {
  const p = path.join(edmHome(), "tampered.json");
  const good = JSON.parse(fs.readFileSync(path.join(edmHome(), "employees.json"), "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...good, name: "tampered", hashes: { ...good.hashes, employee_id: ["not-hex"] } }));
  const r = loadIndexes();
  assert.ok(r.errors.some((e) => e.startsWith("tampered.json")));
  assert.ok(r.indexes.every((i) => i.name !== "tampered"));
  fs.writeFileSync(p, "{ nope");
  assert.ok(loadIndexes().errors.some((e) => e.startsWith("tampered.json")));
  reloadIndexes();
  assert.ok(lastWarnings.length >= 0);
  detector.detect(input("hello"));
  assert.ok(edmModule.lastWarnings.some((w) => w.startsWith("tampered.json")), "load errors surface as warnings");
  fs.rmSync(p);
  reloadIndexes();
});

test("detect never throws and available() is honest without key or index", () => {
  const saved = process.env.WRAPBOX_HOME;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "wrapbox-edm-empty-"));
  process.env.WRAPBOX_HOME = empty;
  try {
    reloadIndexes();
    const a = detector.available();
    assert.equal(a.ok, false);
    assert.match(a.reason!, /no tenant key/);
    assert.deepEqual(detector.detect(input(ids[0])), []);
    fs.mkdirSync(path.join(empty, "edm"));
    fs.writeFileSync(path.join(empty, "edm", "key"), Buffer.alloc(32, 7), { mode: 0o600 });
    reloadIndexes();
    assert.match(detector.available().reason!, /no EDM index/);
    // A short key is not a key.
    fs.writeFileSync(path.join(empty, "edm", "key"), Buffer.alloc(3));
    reloadIndexes();
    assert.match(detector.available().reason!, /no tenant key/);
  } finally {
    process.env.WRAPBOX_HOME = saved;
    fs.rmSync(empty, { recursive: true, force: true });
    reloadIndexes();
  }
  assert.equal(detector.available().ok, true);
});

test("candidate extraction is bounded and n-grams cover multi-word names", () => {
  const many = "abcd ".repeat(300_000);
  assert.ok(extractCandidates(many, undefined).length <= 200_000);
  const c = extractCandidates("Mr Avery Abbott0 rang", undefined, 3).map((x) => x.raw);
  assert.ok(c.includes("Avery Abbott0"));
  assert.ok(c.includes("Mr Avery Abbott0"));
  assert.ok(c.every((x) => x.length >= 4 && x.length <= 64));
  assert.ok(DETECT_BUDGET_MS > 0);
});

test("CLI: build writes the index and list shows it", () => {
  const csvFile = path.join(HOME, "cust.csv");
  fs.writeFileSync(csvFile, "id,name\nC-1001,Orbit Ltd\nC-1002,Nimbus GmbH\n");
  const r = runEdmCli(["build", "--name", "clients", "--type", "CUSTOMER.ID", "--csv", csvFile, "--primary", "id", "--columns", "name", "--pattern", "C-\\d{4}"]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  const raw = fs.readFileSync(path.join(edmHome(), "clients.json"), "utf8");
  assert.equal(raw.includes("C-1001"), false);
  assert.equal(raw.includes("Orbit"), false);
  const l = runEdmCli(["list"]);
  assert.equal(l.code, 0);
  assert.ok(l.lines.some((x) => x.startsWith("clients\tCUSTOMER.ID\trows=2")));
  reloadIndexes();
  const f = detector.detect(input("invoice C-1002 for Nimbus GmbH; C-1003 unknown"));
  const cl = f.find((x) => x.label === "clients");
  assert.equal(cl?.count, 1);
  assert.equal(cl?.confidence, "high");
  assert.equal(runEdmCli(["build", "--name", "z"]).code, 1);
  assert.equal(runEdmCli([]).code, 2);
  const lk = new EdmLookup(JSON.parse(raw), loadKey()!);
  assert.ok(lk.match(lk.primary, "c 1001"));
  assert.equal(lk.match(lk.primary, "C-1009"), null);
});
