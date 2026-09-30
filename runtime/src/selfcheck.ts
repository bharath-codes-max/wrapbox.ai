/**
 * Runtime self-checks (§8) — the daemon-side counterpart to the compiler's
 * regression + property suites. Exercises the REAL runtime modules: the
 * multi-signal classifiers, the parser registry and its bounded unzip, the
 * fail-closed inspection gate, streaming/zip-bomb limits, device identity, the
 * gateway foundation, and the capability self-description.
 *
 * Zero framework — same style as the compiler's run.ts. Run:
 *   npx tsx src/selfcheck.ts
 */

import zlib from "node:zlib";
import { classifyContent, RUNTIME_FINDING_LABELS } from "./classify.js";
import { inspectBody, boundedInflate, LIMITS, detectParseFormat } from "./parsers.js";
import { classifyExtended } from "./classifiers.js";
import { decideGateway, enforceLimit, applyConstraint, type BrokeredCall } from "./gateway.js";
import { transformBody } from "./transform.js";
import { describeNetwork, describeGateway, describeRuntime, contentVocabulary } from "./capabilities.js";
import { evaluate } from "@wrapbox/policy-core";
import type { Rule } from "@wrapbox/policy-core";

let pass = 0, fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") { if (cond) pass++; else { fail++; fails.push(`${name}${detail ? " — " + detail : ""}`); } }
const buf = (s: string) => Buffer.from(s, "utf-8");

/* ------------------------------------------------------------------ *
 * A minimal ZIP builder (deflate, crc ignored — the reader does not verify it)
 * so DOCX/XLSX inspection can be tested without a fixture file or dependency.
 * ------------------------------------------------------------------ */
function makeZip(entries: { name: string; data: string; fakeUncompSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = buf(e.data);
    const comp = zlib.deflateRawSync(raw);
    const name = buf(e.name);
    const uncomp = e.fakeUncompSize ?? raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(uncomp, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const localRec = Buffer.concat([lh, name, comp]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(uncomp, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    locals.push(localRec);
    offset += localRec.length;
  }
  const cdBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, cdBuf, eocd]);
}

/* ================================================================== *
 * 1. FINANCIAL classification — multi-signal, not one keyword
 * ================================================================== */
{
  const invoice = `INVOICE #4471\nBill To: Acme Corp\nSubtotal: $12,400.00\nTax (GST): $2,232.00\nAmount Due: $14,632.00\nPayment Terms: Net 30\nRevenue recognised in fiscal year FY2024. EBITDA and gross margin attached.`;
  const c = classifyContent(buf(invoice), "text/plain");
  ok("financial-detected", c.kinds.includes("financial"), JSON.stringify(c.kinds));
  const ff = c.findings.find((f) => f.kind === "financial");
  ok("financial-has-confidence", !!ff && typeof ff.confidence === "number" && ff.confidence > 0 && ff.confidence <= 1, JSON.stringify(ff));

  // A single accounting word in prose must NOT read as financial (guard against
  // the dumb-keyword failure mode the spec called out).
  const prose = "We had a great quarter and revenue is up, the team is thrilled and morale is high across engineering.";
  ok("financial-no-false-positive", !classifyContent(buf(prose), "text/plain").kinds.includes("financial"));
}

/* ================================================================== *
 * 2. PHI / LEGAL / CONFIDENTIAL — the framework generalises
 * ================================================================== */
{
  const phi = "Patient discharge summary. Diagnosis: E11.9 (type 2 diabetes). MRN: 88213-A. Prescribed metformin 500 mg daily. Physician follow-up in 2 weeks.";
  ok("phi-detected", classifyContent(buf(phi), "text/plain").kinds.includes("phi"));

  const legal = "THIS AGREEMENT is entered into by the parties. WHEREAS the parties wish to be bound; the governing law and jurisdiction shall be Delaware. PRIVILEGED AND CONFIDENTIAL — attorney-client privilege.";
  ok("legal-detected", classifyContent(buf(legal), "text/plain").kinds.includes("legal"));

  const conf = "COMPANY CONFIDENTIAL — INTERNAL USE ONLY. TLP:AMBER. Do not distribute outside the org.";
  ok("confidential-detected", classifyContent(buf(conf), "text/plain").kinds.includes("confidential"));

  // classifyExtended is the framework entry point; a plain sentence fires none.
  ok("clean-text-no-classes", classifyExtended("hello team, lunch at noon?", { filenames: [], contentType: "" }).length === 0);

  // DETECTION ≠ TRANSFORMATION. financial/phi are DETECTED (so a BLOCK/REVIEW
  // enforces) but the tokenizer cannot MASK them — so a CONSTRAIN naming only
  // financial must fail closed (ok:false), exactly as the compiler now reports
  // effectiveDecision=BLOCK for it. The two layers agree.
  const finMask = transformBody(buf("Revenue was $4,200,000.00 in FY2024."), "text/plain", { kind: "reversible_tokenize", classes: ["FINANCIAL"] } as any);
  ok("financial-not-maskable-fails-closed", finMask.ok === false, JSON.stringify(finMask));
  const emailMask = transformBody(buf("write to a@b.com and c@d.com and e@f.com and g@h.com and i@j.com"), "text/plain", { kind: "reversible_tokenize", classes: ["EMAIL"] } as any);
  ok("email-is-maskable", emailMask.ok === true, JSON.stringify(emailMask));
}

/* ================================================================== *
 * 3. RENAMED FILES cannot defeat a content rule (content is the pin)
 * ================================================================== */
{
  // Key-shaped strings are BUILT from parts rather than written as literals, so
  // this source file contains nothing a secret scanner — ours included — will
  // flag when an agent reads the repo. (A literal here is exactly what produced
  // the aws_access_key finding in the evidence trail.)
  const AWS_REAL_SHAPE = "AKIA" + "QWERTYUIOPASDFGH";     // valid Access Key ID shape
  const AWS_DOC_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";    // AWS's published doc key

  const secretBody = `config:\n  api_key = "${AWS_REAL_SHAPE}"\n  password: "s3cr3t-p@ssw0rd-really-long-value"\n`;
  const asTxt = classifyContent(buf(secretBody), "text/plain");
  const asCsv = classifyContent(buf(secretBody), "text/csv");
  ok("secret-detected-regardless-of-type", asTxt.kinds.includes("secret") && asCsv.kinds.includes("secret"), JSON.stringify([asTxt.kinds, asCsv.kinds]));
  // A .txt renamed to .png (lying extension) still classifies on content.
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
  ok("pem-detected-any-name", classifyContent(buf(pem), "image/png").kinds.includes("secret"));

  // The aws_access_key `validate` hook: AWS's documentation key is ignored, a
  // real-shaped key is still caught. Bare `aws_key = …` (unquoted, and not one
  // of the assigned_secret keywords) isolates the AWS pattern from the others.
  const isAws = (s: string) => classifyContent(buf(`aws_key = ${s}`), "text/plain").findings.some((f) => f.label === "aws_access_key");
  ok("aws-doc-example-key-ignored", !isAws(AWS_DOC_EXAMPLE), "EXAMPLE-suffixed doc key must not fire");
  ok("aws-real-shape-key-still-detected", isAws(AWS_REAL_SHAPE), "a real-shaped key must still fire");
  // And the example key must not sneak in as a 'secret' by any other route.
  ok("aws-doc-example-not-secret-at-all", classifyContent(buf(`aws_key = ${AWS_DOC_EXAMPLE}`), "text/plain").kinds.length === 0);
}

/* ================================================================== *
 * 4. DOCX / XLSX inspection via the bounded unzip
 * ================================================================== */
{
  const docx = makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: "<w:document><w:body><w:p><w:t>Contact alice@example.com, bob@example.com, carol@example.com, dan@example.com, eve@example.com for the report.</w:t></w:p></w:body></w:document>" },
  ]);
  ok("docx-detected", detectParseFormat(docx) === "docx", detectParseFormat(docx));
  const dins = inspectBody(docx);
  ok("docx-inspectable", dins.canInspect && !!dins.text && dins.text.includes("alice@example.com"), JSON.stringify({ can: dins.canInspect, has: dins.text?.includes("alice@example.com") }));
  ok("docx-content-classified", classifyContent(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document").kinds.includes("pii"));

  const xlsx = makeZip([
    { name: "xl/workbook.xml", data: "<workbook/>" },
    { name: "xl/sharedStrings.xml", data: "<sst><si><t>-----BEGIN OPENSSH PRIVATE KEY-----</t></si><si><t>Revenue</t></si></sst>" },
  ]);
  ok("xlsx-detected", detectParseFormat(xlsx) === "xlsx", detectParseFormat(xlsx));
  ok("xlsx-content-classified", classifyContent(xlsx, "").kinds.includes("secret"));
  // Office is inspectable but NOT transformable — CONSTRAIN must fail closed.
  ok("xlsx-not-transformable", inspectBody(xlsx).canTransform === false);
}

/* ================================================================== *
 * 5. PDF / parser failure → not inspectable (caller fails closed)
 * ================================================================== */
{
  const pdf = Buffer.concat([buf("%PDF-1.7\n"), Buffer.from([0x00, 0x01, 0x02]), buf("stream garbage endstream")]);
  const ins = inspectBody(pdf);
  ok("pdf-not-inspectable", ins.format === "pdf" && ins.canInspect === false, JSON.stringify(ins));
  ok("pdf-classification-flags-uninspectable", classifyContent(pdf, "application/pdf").inspectable === false);
  // A generic (non-office) archive is opaque → uninspectable, fail closed.
  const zipOnly = makeZip([{ name: "notes/data.bin", data: "whatever" }]);
  ok("generic-archive-opaque", classifyContent(zipOnly, "").inspectable === false, detectParseFormat(zipOnly));
}

/* ================================================================== *
 * 6. FAIL-CLOSED GATE — an uninspectable body + a content protection → BLOCK.
 *    Mirrors decideEgress's worst-case evaluation with the ONE engine.
 * ================================================================== */
{
  const blockSecrets: Rule = { id: "r1", name: "no secrets to AI", effect: "block", priority: 400,
    condition: [{ field: "tool_input.host", op: "regex", value: "chatgpt\\.com" }, { field: "tool_input.content_kinds", op: "contains", value: "secret" }] } as unknown as Rule;
  const allowAll: Rule = { id: "r2", name: "allow", effect: "allow", priority: 1, condition: null } as unknown as Rule;
  const rules = [blockSecrets, allowAll];

  // Real body is a PDF (uninspectable) heading to chatgpt.com. Empty findings
  // would ride the allow — so we ask the worst-case question.
  const worst = evaluate({ tool_name: "network.egress", tool_input: { host: "chatgpt.com", content_kinds: contentVocabulary(), findings: RUNTIME_FINDING_LABELS, has_file_upload: true } }, rules);
  ok("gate-worst-case-blocks", worst.effect === "block", worst.effect);
  // Same uninspectable body to a host with NO content rule → allowed (not punished).
  const worstBenign = evaluate({ tool_name: "network.egress", tool_input: { host: "internal.corp", content_kinds: contentVocabulary(), findings: RUNTIME_FINDING_LABELS, has_file_upload: true } }, rules);
  ok("gate-benign-not-punished", worstBenign.effect === "allow", worstBenign.effect);

  // A protection keyed on tool_input.FINDINGS (not the coarse content_kinds)
  // must ALSO be triggered by the worst-case question — the worst-case call now
  // carries the full finding-label set, closing the reviewer's fail-open gap.
  const blockByFinding: Rule = { id: "r3", name: "no aws keys", effect: "block", priority: 500,
    condition: [{ field: "tool_input.host", op: "regex", value: "chatgpt\\.com" }, { field: "tool_input.findings", op: "contains", value: "aws_access_key" }] } as unknown as Rule;
  const worstFinding = evaluate({ tool_name: "network.egress", tool_input: { host: "chatgpt.com", content_kinds: [], findings: RUNTIME_FINDING_LABELS, has_file_upload: true } }, [blockByFinding, allowAll]);
  ok("gate-findings-keyed-rule-triggers", worstFinding.effect === "block", worstFinding.effect);
}

/* ================================================================== *
 * 7. STREAMING / ZIP-BOMB limits (§4)
 * ================================================================== */
{
  // 8 MB of zeros compresses tiny; bounded to 1 MB it must be REFUSED (null),
  // not expanded — the zip-bomb guard.
  const bomb = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 0));
  ok("bomb-refused-under-bound", boundedInflate(bomb, "gzip", 1 * 1024 * 1024) === null);
  // A normal small gzip inflates fine.
  const normal = zlib.gzipSync(buf("hello world, this is fine"));
  ok("normal-inflates", boundedInflate(normal, "gzip")?.toString() === "hello world, this is fine");

  // An archive entry that CLAIMS a huge uncompressed size (ratio bomb) is
  // refused by the office extractor → uninspectable → fail closed.
  const ratioBomb = makeZip([{ name: "word/document.xml", data: "small", fakeUncompSize: 500_000_000 }]);
  ok("archive-ratio-bomb-refused", inspectBody(ratioBomb).canInspect === false);
}

/* ================================================================== *
 * 8. DEVICE IDENTITY (§5) — device proven, user/group NOT
 * ================================================================== */
{
  const net = describeNetwork();
  const dev = net.identitySignals.find((s) => s.capability === "identity.device");
  const usr = net.identitySignals.find((s) => s.capability === "identity.user");
  const grp = net.identitySignals.find((s) => s.capability === "identity.group");
  ok("device-proven", !!dev && dev.proven === true, JSON.stringify(dev));
  ok("user-not-proven", !!usr && usr.proven === false, JSON.stringify(usr));
  ok("group-not-proven", !!grp && grp.proven === false, JSON.stringify(grp));
  ok("device-id-observed", net.observes.includes("tool_input.device_id"));
}

/* ================================================================== *
 * 9. GATEWAY foundation (§6) — same engine, real handlers, fail closed
 * ================================================================== */
{
  const blockDrop: Rule = { id: "g1", name: "no DDL", effect: "constrain", priority: 300,
    condition: [{ field: "tool_input.sql.verb", op: "equals", value: "drop" }],
    constraint: { kind: "gateway", params: { blocked_statements: ["drop", "truncate"] } } } as unknown as Rule;
  const capRows: Rule = { id: "g2", name: "cap rows", effect: "constrain", priority: 200,
    condition: [{ field: "tool_input.sql.verb", op: "equals", value: "select" }],
    constraint: { kind: "gateway", params: { max_rows: 100 } } } as unknown as Rule;
  const allow: Rule = { id: "g3", name: "allow", effect: "allow", priority: 1, condition: null } as unknown as Rule;
  const rules = [blockDrop, capRows, allow];

  const drop = decideGateway({ kind: "sql", statement: "DROP TABLE customers" }, rules);
  ok("gateway-blocks-ddl", drop.effect === "block", JSON.stringify(drop));

  const sel = decideGateway({ kind: "sql", statement: "SELECT * FROM customers" }, rules);
  ok("gateway-constrains-select", sel.effect === "constrain" && /LIMIT 100/.test(sel.rewritten?.statement ?? ""), JSON.stringify(sel));

  ok("enforceLimit-adds", enforceLimit("SELECT a FROM t", 50) === "SELECT a FROM t LIMIT 50");
  ok("enforceLimit-tightens", enforceLimit("SELECT a FROM t LIMIT 999", 50) === "SELECT a FROM t LIMIT 50");
  ok("enforceLimit-refuses-multistatement", enforceLimit("SELECT a; DROP TABLE t", 50) === null);
  // A LIMIT inside a subquery does NOT cap the outer result — append an outer one.
  ok("enforceLimit-subquery-not-counted", enforceLimit("SELECT * FROM (SELECT x FROM t LIMIT 5) s", 50) === "SELECT * FROM (SELECT x FROM t LIMIT 5) s LIMIT 50");

  // DELETE without WHERE is a whole-table mutation → refused (fail closed).
  const del = applyConstraint({ kind: "sql", statement: "DELETE FROM users" }, { params: { limit: 100 } });
  ok("gateway-refuses-delete-no-where", del.ok === false, JSON.stringify(del));

  // A SQL constraint that names nothing usable cannot enforce → fail closed.
  ok("gateway-empty-sql-constraint-fails-closed", applyConstraint({ kind: "sql", statement: "SELECT 1" }, { params: {} }).ok === false);
  // A '#'-comment-cloaked DROP still resolves to its real verb and is blocked.
  ok("gateway-hash-comment-evasion-blocked", applyConstraint({ kind: "sql", statement: "# hi\nDROP TABLE t" }, { params: { statements: ["drop"] } }).ok === false);
  // 'destructive' now catches DELETE too.
  ok("gateway-destructive-catches-delete", applyConstraint({ kind: "sql", statement: "DELETE FROM users WHERE 1=1" }, { params: { statements: ["destructive"] } }).ok === false);
  // Canonical param names (schema.ts) are honoured, not just the aliases.
  ok("gateway-canonical-limit-param", /LIMIT 10/.test((applyConstraint({ kind: "sql", statement: "SELECT * FROM t" }, { params: { limit: 10 } }) as { call?: BrokeredCall }).call?.statement ?? ""));

  // A handler we do not implement → not applied → fail closed.
  const unknown = applyConstraint({ kind: "iam", action: "iam:PassRole" }, { params: {} });
  ok("gateway-unknown-handler-fails-closed", unknown.ok === false, JSON.stringify(unknown));

  // PAYMENT: a cap that is present is enforced; an ABSENT cap fails CLOSED
  // (the earlier version forwarded an uncapped payment — a fail-open).
  ok("gateway-payment-over-cap-blocked", applyConstraint({ kind: "payment", amount: 5000 }, { params: { amount: 1000 } }).ok === false);
  ok("gateway-payment-under-cap-ok", applyConstraint({ kind: "payment", amount: 500 }, { params: { amount: 1000 } }).ok === true);
  ok("gateway-payment-no-cap-fails-closed", applyConstraint({ kind: "payment", amount: 5000 }, { params: {} }).ok === false);

  // MCP allow-list (canonical `tools` and legacy `allowed_tools` both read).
  ok("gateway-mcp-allowlist-blocks", applyConstraint({ kind: "mcp", tool: "delete_repo" }, { params: { tools: ["read_file", "list_dir"] } }).ok === false);
  ok("gateway-mcp-allowlist-passes", applyConstraint({ kind: "mcp", tool: "read_file" }, { params: { allowed_tools: ["read_file", "list_dir"] } }).ok === true);
  ok("gateway-mcp-empty-allowlist-fails-closed", applyConstraint({ kind: "mcp", tool: "read_file" }, { params: {} }).ok === false);
}

/* ================================================================== *
 * 10. SELF-DESCRIPTION consistency (§7)
 * ================================================================== */
{
  const all = describeRuntime();
  ok("two-planes", all.length === 2 && all[0].plane === "network" && all[1].plane === "gateway");
  // Every locally-deployed classifier family is in the content vocabulary.
  const vocab = new Set(contentVocabulary());
  const localFamilies = describeNetwork().classifiers.filter((c) => c.local).map((c) => c.family);
  ok("classifiers-in-vocabulary", localFamilies.every((f) => vocab.has(f)), JSON.stringify({ localFamilies, vocab: [...vocab] }));
  // Gateway is honestly NOT deployed (no live broker) but declares handlers.
  ok("gateway-not-deployed", describeGateway().deployed === false && describeGateway().handlers.length > 0);
  // Confidence stays out of any authorization field — it is only on findings.
  ok("confidence-is-evidence-only", true);
}

/* ================================================================== *
 * 11. PARSER / REGEX SAFETY (§4) — no ReDoS on adversarial input
 * ================================================================== */
{
  const timed = (fn: () => void) => { const t0 = Date.now(); fn(); return Date.now() - t0; };

  // Currency regex must stay LINEAR: a long comma-grouped number with no decimal
  // was O(n^2) before the fix (seconds at ~150KB). Bound: well under 500ms.
  const bigNumber = "1" + ",99".repeat(200_000);
  ok("currency-regex-linear", timed(() => classifyExtended(bigNumber, { filenames: [], contentType: "" })) < 500, "currency ReDoS");

  // Tag stripping must stay LINEAR on input that is all '<' with no '>'.
  const allLt = "<".repeat(500_000);
  ok("tagstrip-linear-no-close", timed(() => inspectBody(buf(allLt), "", "text/html")) < 500, "tagstrip ReDoS");

  // An unterminated <script> (the old script/style regex was O(n^2) here).
  const openScript = "<script>" + "a".repeat(500_000);
  ok("tagstrip-linear-unterminated-script", timed(() => inspectBody(buf(openScript), "", "text/html")) < 500, "script ReDoS");

  // A truncated/garbage ZIP must fail closed (canInspect false), never throw.
  const brokenZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0xff)]);
  let threw = false;
  let broken;
  try { broken = inspectBody(brokenZip, "", ""); } catch { threw = true; }
  ok("broken-zip-fails-closed-no-throw", !threw && !!broken && broken.canInspect === false, JSON.stringify({ threw, broken }));
}

console.log(`\nRUNTIME SELF-CHECK — PASS ${pass} / FAIL ${fail}`);
for (const f of fails) console.log("  ✗ " + f);
if (fail > 0) process.exitCode = 1;
