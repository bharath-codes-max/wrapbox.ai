/**
 * The coverage matrix (audit §10 / requirement O).
 *
 *   contract clause → data type → parser → detector → transform → destination
 *   class → enforcement result → evidence
 *
 * Every row runs the EXACT runtime path — classifyContent (Tier-0 parsers +
 * every loaded detector) → judgeEgress (the daemon's judgement, including the
 * fail-closed gate) → transformBody for CONSTRAIN — against rules compiled by
 * the real intent compiler from a real contract. Nothing is mocked except
 * WRAPBOX_HOME (a temp dir). Fixtures are generated; no real personal data or
 * secrets appear anywhere.
 *
 * Three things are asserted per row: the DECISION, the BYTES THAT WOULD LEAVE
 * (for CONSTRAIN), and the EVIDENCE FIELDS (types, detector ids, unit paths,
 * fail-closed cause, clause provenance).
 *
 * Run: cd runtime && npx tsx --test src/tests/matrix.test.ts
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

// WRAPBOX_HOME must be set BEFORE any runtime module reads config.ts.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "wbx-matrix-"));
process.env.WRAPBOX_HOME = HOME;
process.env.WRAPBOX_VAULT_KEY_FILE = path.join(HOME, "vault.key");

type Any = any;
let classifyContent: Any, classifyContentAsync: Any, judgeEgress: Any, transformBody: Any, parseConstraint: Any;
let validateSurface: Any, compileContract: Any, setContractGroups: Any, setRuntimeSnapshot: Any, defaultSnapshot: Any, checkI1: Any;
let loadPlugins: Any, loadExtractors: Any, extractorAvailability: Any, registerDetectorImpl: Any;
let DestinationRegistry: Any, EMPTY_TENANT: Any, dataTypes: Any;
let buildIndex: Any, writeIndex: Any, reloadIndexes: Any;

/* ------------------------------------------------------------------ *
 * The contract under test — the Surface IR the extraction step produces for
 * the admin's paragraph (fixed here so the matrix is deterministic), plus two
 * extra protections that exercise tenant identifiers and a semantic class.
 * ------------------------------------------------------------------ */
const SURFACE: Any[] = [
  { kind: "definition", text: "approved web-based AI services, including ChatGPT, Claude, and Microsoft Copilot", definition: { group: "approved_ai", label: "approved AI services", members: ["ChatGPT", "Claude", "Microsoft Copilot"] } },
  { text: "Employees may use approved web-based AI services for normal business work.", subject: { group: ["employees"] }, action: "use", resource: { kind: "saas" }, destination: { group: "approved_ai", trust: "external" }, decision: "allow" },
  { text: "Employees may upload business documents through the browser to these approved AI services.", subject: { group: ["employees"] }, action: "upload", resource: { kind: "file", paths: ["*.doc*", "*.pdf", "*.csv", "*.xlsx", "*.html", "*.yaml", "*.json"] }, destination: { group: "approved_ai", trust: "external" }, decision: "allow" },
  { text: "Ordinary non-sensitive business information may be transmitted normally.", action: "disclose", resource: { kind: "endpoint" }, decision: "allow", catchAll: true },
  { text: "Customer email addresses and phone numbers must be reversibly tokenized before being transmitted to any external AI service.", action: "disclose", resource: { kind: "endpoint" }, destination: { classes: ["ANY_AI"], trust: "external" }, data: { classes: ["customer email addresses", "customer phone numbers"], owner: "customer" }, decision: "constrain", constraint: [{ handler: "data.transform", params: { handler: "REVERSIBLE_TOKENIZE", mode: "reversible_tokenization", classes: ["customer email addresses", "customer phone numbers"] } }] },
  { text: "API keys, passwords, authentication tokens, private keys, client secrets, and other credentials must never be transmitted to any external AI service.", action: "disclose", resource: { kind: "endpoint" }, destination: { classes: ["ANY_AI"], trust: "external" }, data: { classes: ["API keys", "passwords", "authentication tokens", "private keys", "client secrets", "other credentials"] }, decision: "block" },
  { text: "Source code may be uploaded to ChatGPT, Claude, and Microsoft Copilot.", action: "upload", resource: { kind: "file" }, destination: { service: ["ChatGPT", "Claude", "Microsoft Copilot"], trust: "external" }, data: { classes: ["source code"] }, decision: "allow" },
  { text: "Transmitting source code to any other external destination requires human review before transmission.", action: "disclose", resource: { kind: "endpoint" }, destination: { notIn: { group: "approved_ai" }, trust: "external" }, data: { classes: ["source code"] }, decision: "review", approvers: ["appsec"] },
  { text: "Financial business data without credentials or customer PII may be transmitted to approved AI services.", action: "disclose", resource: { kind: "endpoint" }, destination: { group: "approved_ai", trust: "external" }, data: { classes: ["financial business data"] }, decision: "allow", exceptions: ["without credentials", "without customer PII"] },
  { text: "Employee IDs must never be sent to any external AI service.", action: "disclose", resource: { kind: "endpoint" }, destination: { classes: ["ANY_AI"], trust: "external" }, data: { classes: ["employee IDs"], owner: "employee" }, decision: "block" },
  { text: "Board material must never be uploaded to Gemini.", action: "upload", resource: { kind: "file" }, destination: { service: ["Gemini"], trust: "external" }, data: { classes: ["board material"] }, decision: "block", onUnsupported: "block" },
  { kind: "invariant", text: "If protected information cannot be safely inspected or transformed before transmission, it must be blocked rather than transmitted unchanged.", invariant: "fail_closed_uninspected" },
];

let rules: Any[] = [];
let clauses: Any[] = [];
let tenantDest: Any;

/* ------------------------------------------------------------------ *
 * Fixture builders (all synthetic)
 * ------------------------------------------------------------------ */
const crc32 = (buf: Buffer): number => {
  let c: number, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
};
/** Minimal ZIP writer (deflate, local + central directory) — enough for docx/xlsx/nested archives. */
function makeZip(entries: Array<{ name: string; data: Buffer; method?: 0 | 8 | 99 }>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name); const crc = crc32(e.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method === 99 ? 0x1 : 0, 6); lh.writeUInt16LE(method === 99 ? 99 : method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method === 99 ? 0x1 : 0, 8); ch.writeUInt16LE(method === 99 ? 99 : method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const docx = (text: string, method: 0 | 8 | 99 = 8) => makeZip([
  { name: "[Content_Types].xml", data: Buffer.from("<Types/>"), method: method === 99 ? 8 : method },
  { name: "word/document.xml", data: Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`), method },
]);
function multipart(parts: Array<{ name: string; filename?: string; type?: string; body: Buffer | string }>): { body: Buffer; contentType: string } {
  const b = "----wbxmatrix" + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body)); chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${b}` };
}
const PY = "import os\nimport sys\n\nclass Checkout:\n    def __init__(self, cart):\n        self.cart = cart\n\n    def charge(self, order):\n        total = sum(i.price for i in order.items)\n        return total\n\nif __name__ == \"__main__\":\n    print(Checkout([]).charge(None))\n";
const TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const emails = (n: number) => Array.from({ length: n }, (_, i) => `person${i}@example-corp.test`);

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */
interface Row { effect: string; failClosed: boolean; matched: Any; call: Any; cls: Any; leaves?: Buffer; report?: Any }
function judge(body: Buffer | string, contentType: string, host: string, pathname = "/", method = "POST"): Row {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const cls = classifyContent(buf, contentType);
  const r = judgeEgress(rules, { host, port: 443, method, path: pathname, classification: cls }, "browser", tenantDest);
  const row: Row = { effect: r.failClosed ? "block" : r.decision.effect, failClosed: r.failClosed, matched: r.matched, call: r.call, cls };
  if (row.effect === "constrain") {
    const c = r.matched?.constraint ?? parseConstraint(JSON.stringify(r.matched?.constraint ?? null));
    const t = transformBody(buf, contentType, c);
    if (t.ok) { row.leaves = t.body; row.report = t.report; } else { row.effect = "block"; row.failClosed = true; }
  }
  return row;
}
async function judgeAsync(body: Buffer, contentType: string, host: string, pathname = "/"): Promise<Row> {
  const cls = await classifyContentAsync(body, contentType);
  const r = judgeEgress(rules, { host, port: 443, method: "POST", path: pathname, classification: cls }, "browser", tenantDest);
  return { effect: r.failClosed ? "block" : r.decision.effect, failClosed: r.failClosed, matched: r.matched, call: r.call, cls };
}
const clauseOf = (row: Row) => row.matched?.meta?.clause_id ?? row.matched?.clause_id;
const toCached = (w: Any, i: number) => ({ id: `r${i + 1}`, name: w.name, effect: w.effect, priority: w.priority, condition: w.condition, constraint: w.constraint ? parseConstraint(JSON.stringify(w.constraint)) : null, project_id: null, clause_id: w.clause_id, description: w.description ?? null, coverageNote: w.description ?? null, meta: w.meta });

before(async () => {
  // Runtime modules (after WRAPBOX_HOME is set).
  ({ classifyContent, classifyContentAsync } = await import("../classify.js"));
  ({ judgeEgress } = await import("../proxy.js"));
  ({ transformBody } = await import("../transform.js"));
  ({ parseConstraint } = await import("@wrapbox/policy-core"));
  ({ loadPlugins, registerDetectorImpl } = await import("../detectors/index.js"));
  ({ loadExtractors, extractorAvailability } = await import("../extract/index.js"));
  ({ DestinationRegistry, EMPTY_TENANT, dataTypes } = await import("@wrapbox/registry"));
  ({ buildIndex, writeIndex } = await import("../edm/index.js"));
  ({ reloadIndexes } = await import("../detectors/edm.js"));
  // The compiler (UI package) — the same code the Intent page runs.
  ({ validateSurface } = await import("../../../src/lib/intent/validate.ts"));
  ({ compileContract } = await import("../../../src/lib/intent/compile.ts"));
  ({ setContractGroups } = await import("../../../src/lib/intent/destinations.ts"));
  ({ setRuntimeSnapshot, defaultSnapshot } = await import("../../../src/lib/intent/snapshot.ts"));
  ({ checkActivation: checkI1 } = await import("@wrapbox/registry"));

  // Tenant: the three approved AI services; an EDM index of employee ids.
  const tenant = { ...EMPTY_TENANT, tenant: "acme", approvedAi: ["chatgpt", "claude", "copilot"], groups: [{ id: "approved_ai", label: "approved AI services", members: ["chatgpt", "claude", "copilot"] }] };
  fs.writeFileSync(path.join(HOME, "destinations.json"), JSON.stringify(tenant));
  tenantDest = new DestinationRegistry(tenant);
  fs.mkdirSync(path.join(HOME, "edm"), { recursive: true });
  const csv = "employee_id,name\n" + Array.from({ length: 500 }, (_, i) => `EMP-${String(100000 + i)},Person ${i}`).join("\n") + "\n";
  const index = buildIndex({ name: "employees", type: "HR.EMPLOYEE_ID", tenant: "acme", columns: [{ name: "employee_id", primary: true, pattern: "EMP-\\d{6}" }, { name: "name" }], csvText: csv });
  writeIndex(index);
  await loadPlugins();
  await loadExtractors();
  reloadIndexes();

  // Compile the contract against a snapshot that mirrors THIS process (plugins loaded, EDM present).
  const snap = defaultSnapshot();
  snap.detectors = snap.detectors.map((d: Any) => ({ ...d, available: d.available || ["wrapbox.secrets", "wrapbox.code.treesitter", "wrapbox.edm"].includes(d.id) }));
  setRuntimeSnapshot(snap);
  const v = validateSurface(SURFACE);
  setContractGroups(v.groups);
  clauses = [...v.clauses].sort((a: Any, b: Any) => b.priority - a.priority);
  const out = compileContract(clauses);
  rules = out.rules.map(toCached);
});

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

test("contract compiles: no clause silently dropped; board-material carrier rule present", () => {
  const skippedTexts = clauses.filter((c: Any) => !rules.some((r) => r.clause_id === c.id)).map((c: Any) => c.source.text);
  assert.deepEqual(skippedTexts, [], "every clause must produce a rule or a carrier rule");
  const carrier = rules.find((r) => r.meta?.kind === "carrier");
  assert.ok(carrier, "the board-material protection (no detector) compiled as a carrier rule");
  assert.equal(carrier.effect, "block");
});

test("one customer email → ChatGPT: CONSTRAIN, tokenised bytes leave, evidence carries the finding", () => {
  const row = judge("Hi, my contact is jane.doe@example-corp.test — call me", "text/plain", "chatgpt.com", "/backend-api/conversation");
  assert.equal(row.effect, "constrain");
  assert.ok(row.leaves && !row.leaves.toString().includes("jane.doe@example-corp.test"), "the email must not leave");
  assert.ok(row.leaves!.toString().includes("<WB_EMAIL_"), "a reversible token replaces it");
  assert.ok(row.cls.typed.some((f: Any) => f.type === "PII.CONTACT.EMAIL" && f.count === 1 && f.detector === "wrapbox.pattern.pii"));
  assert.ok(clauseOf(row), "rule carries clause provenance");
});

test("thousands of customer records → ChatGPT: CONSTRAIN with PII.BULK, all values replaced, bounded time", () => {
  const rows = emails(3000).map((e, i) => `${e},+1 415 555 ${String(1000 + (i % 9000)).padStart(4, "0")}`);
  const body = "email,phone\n" + rows.join("\n") + "\n";
  const t0 = Date.now();
  const row = judge(body, "text/csv", "chatgpt.com", "/backend-api/files");
  assert.equal(row.effect, "constrain");
  assert.ok(row.cls.types.includes("PII.BULK"));
  assert.ok(!row.leaves!.toString().includes("@example-corp.test"), "no email leaves");
  assert.ok(row.report.total >= 3000, `protected ${row.report.total}`);
  assert.ok(Date.now() - t0 < 8000, "3000 rows judged and transformed in under 8 s");
});

test("mixed: a customer email AND a token → ChatGPT: BLOCK wins over tokenise", () => {
  const row = judge(`jane.doe@example-corp.test\nGITHUB_TOKEN=${TOKEN}\n`, "text/plain", "chatgpt.com");
  assert.equal(row.effect, "block");
  assert.ok(row.cls.types.some((t: string) => t.startsWith("CREDENTIAL")));
  assert.ok(!JSON.stringify(row.cls).includes(TOKEN), "the token never appears in classification output");
});

test("source code renamed notes.txt → pastebin (GENERIC_EXTERNAL): REVIEW; → ChatGPT: ALLOW", () => {
  const up = multipart([{ name: "file", filename: "notes.txt", type: "text/plain", body: PY }]);
  const rev = judge(up.body, up.contentType, "pastebin.com", "/api/post");
  assert.equal(rev.effect, "review");
  assert.ok(rev.cls.types.includes("SOURCE_CODE"), "identified from content, not the .txt extension");
  const ok = judge(up.body, up.contentType, "chatgpt.com", "/backend-api/files");
  assert.equal(ok.effect, "allow");
});

test("a package.json / k8s manifest is config, not code: ALLOW at pastebin", () => {
  const up = multipart([{ name: "file", filename: "package.json", type: "application/json", body: JSON.stringify({ name: "x", version: "1.0.0", scripts: { dev: "vite" }, dependencies: { react: "^19" } }) }]);
  const row = judge(up.body, up.contentType, "pastebin.com");
  assert.equal(row.effect, "allow");
  assert.ok(!row.cls.types.includes("SOURCE_CODE"));
});

test("nested archive (zip in zip) → ChatGPT: UNINSPECTABLE → BLOCK (fail closed); → internal host: ALLOW (no protection applies)", () => {
  const inner = makeZip([{ name: "secrets.txt", data: Buffer.from(`token=${TOKEN}`) }]);
  const outer = makeZip([{ name: "bundle/inner.zip", data: inner }]);
  const up = multipart([{ name: "file", filename: "bundle.zip", type: "application/zip", body: outer }]);
  const row = judge(up.body, up.contentType, "chatgpt.com");
  assert.equal(row.effect, "block"); assert.ok(row.failClosed);
  assert.equal(row.cls.inspection, "uninspectable");
  assert.ok(row.cls.types.some((t: string) => t.startsWith("UNINSPECTABLE.")));
  const internal = judge(up.body, up.contentType, "10.0.0.5");
  assert.equal(internal.effect, "allow", "no protection is scoped to INTERNAL, so an unreadable body is not punished");
});

test("malformed docx (truncated) → ChatGPT: BLOCK with an explicit state", () => {
  const good = docx("quarterly notes");
  const bad = good.subarray(0, good.length - 40);
  const up = multipart([{ name: "file", filename: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: bad }]);
  const row = judge(up.body, up.contentType, "claude.ai");
  assert.equal(row.effect, "block"); assert.ok(row.failClosed);
  assert.ok(["MALFORMED", "PARSER_FAILURE", "UNSUPPORTED_FORMAT", "DECOMPRESSION_REFUSED"].includes(row.cls.state), row.cls.state);
});

test("encrypted docx (AES entries) → ChatGPT: BLOCK, never 'nothing found'", () => {
  const enc = docx("top secret", 99);
  const up = multipart([{ name: "file", filename: "board.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: enc }]);
  const row = judge(up.body, up.contentType, "chatgpt.com");
  assert.equal(row.effect, "block"); assert.ok(row.failClosed);
  assert.equal(row.cls.inspection, "uninspectable");
});

test("unsupported binary (.dwg) → Gemini (unapproved AI): BLOCK; → internal: ALLOW", () => {
  const bytes = Buffer.concat([Buffer.from("AC1027"), Buffer.alloc(2000, 0), Buffer.from([0x11, 0x22, 0x00, 0x99])]);
  const up = multipart([{ name: "file", filename: "plan.dwg", type: "application/octet-stream", body: bytes }]);
  assert.equal(judge(up.body, up.contentType, "gemini.google.com").effect, "block");
  assert.equal(judge(up.body, up.contentType, "intranet.acme.internal").effect, "block", "an uncatalogued host is UNKNOWN_EXTERNAL, covered by the ANY_AI protections");
  assert.equal(judge(up.body, up.contentType, "10.0.0.5").effect, "allow");
});

test("screenshot → OCR → same detectors: inspected when the Vision helper is present, fail-closed when it is not", async () => {
  const helper = ["/Users/bharathkumar/Music/wrapbox-prototype/macos/ocr/build/wrapbox-ocr", path.join(HOME, "bin", "wrapbox-ocr")].find((p) => fs.existsSync(p));
  const ocrAvailable = extractorAvailability().some((e: Any) => e.id === "wrapbox.ocr.vision" && e.available);
  if (!helper || !ocrAvailable || process.platform !== "darwin") {
    // Honest path: without a helper an image is UNINSPECTABLE and blocked wherever a protection could apply.
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const up = multipart([{ name: "file", filename: "shot.png", type: "image/png", body: png }]);
    const row = await judgeAsync(up.body, up.contentType, "chatgpt.com");
    assert.equal(row.effect, "block"); assert.ok(row.failClosed);
    return;
  }
  const pngPath = path.join(HOME, "selftest.png");
  execFileSync(helper, ["--render-test", pngPath], { timeout: 20000 });
  const up = multipart([{ name: "file", filename: "shot.png", type: "image/png", body: fs.readFileSync(pngPath) }]);
  const row = await judgeAsync(up.body, up.contentType, "chatgpt.com");
  assert.equal(row.cls.inspection, "inspected", `OCR made the image inspectable (${row.cls.inspectReason ?? ""})`);
  assert.equal(row.cls.extractor, "wrapbox.ocr.vision");
  assert.equal(row.effect, "allow", "the rendered text holds nothing protected");
});

test("embedded credentials: nested JSON field and a base64-encoded token → ChatGPT: BLOCK", () => {
  const nested = JSON.stringify({ messages: [{ role: "user", content: "help me with this" }], config: { aws: { access_key_id: "AKIA" + "ABCDEFGHIJKLMNOP", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzzzzzzzzzz" } } });
  assert.equal(judge(nested, "application/json", "chatgpt.com").effect, "block");
  const encoded = JSON.stringify({ blob: Buffer.from(`GITHUB_TOKEN=${TOKEN}`).toString("base64") });
  assert.equal(judge(encoded, "application/json", "chatgpt.com").effect, "block", "an encoded copy of the token is still found");
});

test("unknown external destination: secret → new-ai-startup.io BLOCK; plain text ALLOW", () => {
  assert.equal(judge(`-----BEGIN RSA PRIVATE KEY-----\nMIIEfake\n-----END RSA PRIVATE KEY-----`, "text/plain", "new-ai-startup.io").effect, "block");
  const plain = judge("Q3 planning notes: move the offsite to Thursday.", "text/plain", "new-ai-startup.io");
  assert.equal(plain.effect, "allow");
  assert.equal(plain.call.tool_input.destination_class, "UNKNOWN_EXTERNAL");
});

test("approved vs unapproved AI: code → Copilot ALLOW, code → Gemini REVIEW, email → Gemini CONSTRAIN", () => {
  assert.equal(judge(PY, "text/plain", "copilot.microsoft.com").effect, "allow");
  assert.equal(judge(PY, "text/plain", "gemini.google.com").effect, "review");
  const em = judge("reach jane.doe@example-corp.test", "text/plain", "gemini.google.com");
  assert.equal(em.effect, "constrain");
  assert.equal(em.call.tool_input.destination_class, "KNOWN_AI_UNAPPROVED");
});

test("tenant identifier (EDM): an employee id from the index → BLOCK; an id not in the index → ALLOW; index holds no plaintext", () => {
  const hit = judge("Please review the file for EMP-100042 before Friday", "text/plain", "chatgpt.com");
  assert.equal(hit.effect, "block");
  assert.ok(hit.cls.typed.some((f: Any) => f.type === "HR.EMPLOYEE_ID" && f.detector === "wrapbox.edm"));
  const miss = judge("Please review the file for EMP-999999 before Friday", "text/plain", "chatgpt.com");
  assert.equal(miss.effect, "allow");
  const indexFile = fs.readdirSync(path.join(HOME, "edm")).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(HOME, "edm", f), "utf8")).join("");
  assert.ok(!indexFile.includes("EMP-100042") && !indexFile.includes("100042"), "the index stores hashes, never the identifiers");
});

test("semantic class with no detector (board material): carrier rule blocks uploads to AI, plain body passes — and the contract said so", () => {
  const bm = clauses.find((c: Any) => c.source.text.startsWith("Board material"));
  assert.equal(bm.binding.status, "understood_only");
  assert.ok(bm.issues.some((i: Any) => i.code === "carrier_rule"), "the admin chose block-carrier; the UI shows it");
  const up = multipart([{ name: "file", filename: "deck.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: docx("Q3 board pack: strategic options") }]);
  const row = judge(up.body, up.contentType, "gemini.google.com");
  assert.equal(row.effect, "block");
  assert.equal(row.matched?.meta?.kind, "carrier");
  assert.equal(judge("Q3 board pack: strategic options", "text/plain", "gemini.google.com").effect, "allow", "an inline body is not an upload — the honest limit of a carrier rule, stated in the UI");
  // A carrier rule is BLUNT by design: every upload to its destination is blocked, even an otherwise-allowed one.
  assert.equal(judge(multipart([{ name: "file", filename: "notes.csv", type: "text/csv", body: "a,b\n1,2\n" }]).body, multipart([{ name: "file", filename: "n.csv", type: "text/csv", body: "a,b\n" }]).contentType, "gemini.google.com").effect, "block");
});

test("false positives stay allowed: 'password reset' prose, the AWS docs example key, a non-Luhn 16-digit number, a version string", () => {
  for (const body of [
    "Please use the password reset link; your token will arrive by email shortly.",
    "Example from the AWS docs: AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "order 4111 1111 1111 1112 shipped",
    "build 10.20.30.40 passed on 2026-09-24",
  ]) {
    const row = judge(body, "text/plain", "chatgpt.com");
    assert.equal(row.effect, "allow", body);
  }
});

test("false negatives are honest: a single obfuscated SSN (dots) is not detected — and the evidence says only what was read", () => {
  const row = judge("ssn 219.09.9999 on file", "text/plain", "chatgpt.com");
  assert.equal(row.effect, "allow");
  assert.equal(row.cls.inspection, "inspected");
  assert.deepEqual(row.cls.types, []);
});

test("INVARIANT: no protected clause is ENFORCED when a required detector, parser or transform is unavailable", () => {
  const base = defaultSnapshot();
  // (a) every detector gone → every content protection is understood_only, and activation is held
  setRuntimeSnapshot({ ...base, detectors: base.detectors.map((d: Any) => ({ ...d, available: false })) });
  const v1 = validateSurface(SURFACE); setContractGroups(v1.groups);
  for (const c of v1.clauses) if (c.decision !== "ALLOW" && c.data?.classes?.length) assert.notEqual(c.binding.status, "enforced", c.source.text);
  assert.ok(v1.activationBlocked, "the contract cannot activate with its protections unenforceable");
  // (b) Tier-0 parser gone → data protections lose parse.* → not enforced
  setRuntimeSnapshot({ ...base, extractors: base.extractors.map((e: Any) => ({ ...e, available: false })) });
  const v2 = validateSurface(SURFACE); setContractGroups(v2.groups);
  for (const c of v2.clauses) if (c.decision !== "ALLOW" && c.data?.classes?.length) assert.notEqual(c.binding.status, "enforced", c.source.text);
  // (c) transforms gone → the CONSTRAIN is not enforced as CONSTRAIN (compiles to BLOCK or holds)
  setRuntimeSnapshot({ ...base, transforms: [] });
  const v3 = validateSurface(SURFACE); setContractGroups(v3.groups);
  const tok = v3.clauses.find((c: Any) => c.decision === "CONSTRAIN");
  assert.ok(tok && (tok.binding.effectiveDecision === "BLOCK" || tok.binding.status !== "enforced"), JSON.stringify(tok?.binding));
  setRuntimeSnapshot(null);
});

test("evidence v2: a fail-closed decision names its cause, the clause and the pins", () => {
  const up = multipart([{ name: "file", filename: "x.pdf", type: "application/pdf", body: Buffer.from("%PDF-1.7 not really") }]);
  const row = judge(up.body, up.contentType, "chatgpt.com");
  assert.equal(row.effect, "block"); assert.ok(row.failClosed);
  assert.equal(row.cls.state, "UNSUPPORTED_FORMAT");
  assert.ok(row.matched?.meta?.clause_id && row.matched?.meta?.pins?.dataTypes, "the matched protection carries clause id and registry pins");
  assert.ok(row.call.tool_input.finding_types.includes("UNINSPECTABLE.UNSUPPORTED_FORMAT"));
});

test("registry is the single vocabulary: every type a detector emits and every class the contract names is registered", () => {
  const reg = dataTypes();
  for (const r of rules) {
    const conds = Array.isArray(r.condition) ? r.condition : r.condition ? [r.condition] : [];
    for (const p of conds) if (p.op === "finding") for (const q of JSON.parse(p.value).any) assert.ok(reg.has(q.type) || reg.lineage(q.type).some((a: string) => reg.has(a)), q.type);
  }
  for (const f of judge(`${TOKEN} jane.doe@example-corp.test ${PY}`, "text/plain", "chatgpt.com").cls.typed) assert.ok(reg.has(f.type), f.type);
});
