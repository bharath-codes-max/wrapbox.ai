// The eight capabilities added from the ideation map's "needs invention" list.
// Every test drives the real engine (runScenario → decide) or the real store,
// and each rule is checked from both sides: the same action with and without
// the condition that changes the decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CONTRACTS, SEED_CONTRACTS } from "../src/model/contracts";
import { scenarioById, type Scenario } from "../src/engine/scenarios";
import { runScenario, setSeq, setTokenCounter } from "../src/engine/simulate";
import { decide, type ActionRequest } from "../src/engine/brain";
import { toOcsf, toOtlpLogs, executed } from "../src/engine/export";
import type { AgentStop, AgentTaint, IntentContract } from "../src/model/types";

const demo = () => structuredClone(DEMO_CONTRACTS) as IntentContract[];
const sc = (id: string) => { const x = scenarioById(id); assert.ok(x, `scenario ${id}`); return x!; };
function run(s: Scenario, opts: Parameters<typeof runScenario>[3] = {}, contracts = demo()) {
  setSeq(5000); setTokenCounter(500);
  return runScenario(s, contracts, "t0", opts).event;
}

// ── F23 · MCP per-tool-call control ─────────────────────────────────────────
test("MCP: a read-only tool on a registered server is allowed", () => {
  assert.equal(run(sc("mcp-list-issues")).decision, "ALLOW");
});
test("MCP: the same push_files tool — feature branch ALLOW, main REVIEW (argument-level)", () => {
  assert.equal(run(sc("mcp-push-feature")).decision, "ALLOW");
  const main = run(sc("mcp-push-main"));
  assert.equal(main.decision, "REVIEW");
  assert.equal(main.decidedBy?.clauseId, "cl-mcp-3");
});
test("MCP: the argument pattern is anchored — branch 'main-backup' is not 'main'", () => {
  const s = sc("mcp-push-main");
  const e = run({ ...s, environment: "development", mcp: { ...s.mcp!, args: { ...s.mcp!.args, branch: "main-backup" } } });
  assert.equal(e.decision, "ALLOW");
});
test("MCP: delete_file is blocked by name; write_file to .env blocked on the local stdio server", () => {
  assert.equal(run(sc("mcp-delete-file")).decidedBy?.clauseId, "cl-mcp-2");
  const w = run(sc("mcp-stdio-write-env"));
  assert.equal(w.decision, "BLOCK");
  assert.equal(w.decidedBy?.clauseId, "cl-mcp-4");
});
test("MCP: any tool on an unregistered server is refused", () => {
  const e = run(sc("mcp-unregistered"));
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.decidedBy?.clauseId, "cl-mcp-1");
});
test("MCP: the rules are policy — without the MCP tool policy, push to main is not held", () => {
  assert.equal(run(sc("mcp-push-main"), {}, structuredClone(SEED_CONTRACTS) as IntentContract[]).decision, "ALLOW");
});
test("MCP: the event and evidence record the tool call", () => {
  const e = run(sc("mcp-push-main"));
  assert.equal(e.mcp?.tool, "push_files");
  assert.ok(e.evidence.chain.some((n) => n.label === "MCP tool call" && n.detail.includes("github.push_files")));
});

// ── F13 · Kill switch ───────────────────────────────────────────────────────
const stop = (agent: string): AgentStop => ({ id: "s1", agent, by: "u-priya", reason: "Investigating", at: 1, active: true });
test("Kill switch: a stopped agent is blocked on every plane, before any rule", () => {
  for (const id of ["ep-run-tests", "gw-push-feature", "mcp-list-issues", "inj-deploy-staging"]) {
    const e = run(sc(id), { stops: [stop("a-claude-code")] });
    assert.equal(e.decision, "BLOCK", id);
    assert.equal(e.decidedBy?.layer, "killswitch", id);
  }
  // Another agent is untouched.
  assert.equal(run(sc("gw-select-50"), { stops: [stop("a-claude-code")] }).decision, "ALLOW");
});
test("Kill switch: break-glass cannot lift it; a resumed (inactive) stop does nothing", () => {
  const s = sc("gw-push-feature");
  const e = run(s, { stops: [stop("a-claude-code")], breakGlass: { resource: s.resource, environment: s.environment } });
  assert.equal(e.decision, "BLOCK");
  assert.equal(run(s, { stops: [{ ...stop("a-claude-code"), active: false }] }).decision, "ALLOW");
});
test("Kill switch: a stopped agent anywhere in a delegation chain blocks the action", () => {
  const e = run(sc("a2a-tests"), { stops: [stop("a-claude-code")] });
  assert.equal(e.decidedBy?.layer, "killswitch");
});
test("Kill switch (store): stopping cancels held requests, stops jobs, and approvals are refused until resume", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const held = store.simulateById("gw-force-main")!;
  assert.equal(held.reviewState?.status, "pending");
  const t = store.startTask("job-eng-checkout");
  store.advanceTask(t.taskId);
  assert.ok(store.stopAgent("a-claude-code", "u-priya", "Suspicious pushes"));
  const after = store.getState().events.find((e) => e.id === held.id)!;
  assert.equal(after.reviewState?.status, "denied");
  assert.equal(store.getState().tasks.find((x) => x.taskId === t.taskId)!.status, "stopped");
  // New actions are blocked; a new hold can't be approved into running.
  assert.equal(store.simulateById("ep-run-tests")!.decidedBy?.layer, "killswitch");
  assert.ok(store.resumeAgent("a-claude-code", "u-priya"));
  assert.equal(store.simulateById("ep-run-tests")!.decision, "ALLOW");
  const again = store.simulateById("gw-force-main")!;
  store.stopAgent("a-claude-code", "u-maya", "Again");
  store.resolveReview(again.id, "approved", "u-alex");
  assert.notEqual(store.getState().events.find((e) => e.id === again.id)!.reviewState?.status, "approved");
  store.resumeAgent("a-claude-code", "u-maya");
});

// ── F24 · Injection-aware decisions ─────────────────────────────────────────
const taint = (agent = "a-claude-code", minsAgo = 3, window = 30): AgentTaint => {
  const now = Date.now();
  return { agent, kind: "issue", label: "GitHub issue #482", eventId: "e1", at: now - minsAgo * 60000, expiresAt: now - minsAgo * 60000 + window * 60000 };
};
test("Injection: deploy to staging is ALLOW normally, REVIEW right after reading untrusted content", () => {
  assert.equal(run(sc("inj-deploy-staging")).decision, "ALLOW");
  const e = run(sc("inj-deploy-staging"), { taint: taint() });
  assert.equal(e.decision, "REVIEW");
  assert.equal(e.decidedBy?.layer, "injection");
});
test("Injection: non-risky work (running tests) is not slowed; expired watch has no effect", () => {
  assert.equal(run(sc("ep-run-tests"), { taint: taint() }).decision, "ALLOW");
  assert.equal(run(sc("inj-deploy-staging"), { taint: taint("a-claude-code", 45) }).decision, "ALLOW");
});
test("Injection: only the agent that read the content is watched", () => {
  assert.equal(run(sc("inj-deploy-staging"), { taint: taint("a-codex") }).decision, "ALLOW");
});
test("Injection (store): reading the issue puts Claude Code under watch; its deploy then waits", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  assert.equal(store.decisionNow(sc("inj-deploy-staging")), "ALLOW");
  assert.equal(store.simulateById("inj-read-issue")!.decision, "ALLOW");
  assert.ok(store.taintOf("a-claude-code"));
  assert.equal(store.decisionNow(sc("inj-deploy-staging")), "REVIEW");
  assert.equal(store.simulateById("inj-deploy-staging")!.decidedBy?.layer, "injection");
});

// ── F28 · Agent-to-agent chains ─────────────────────────────────────────────
test("Delegation: the Finance Agent alone may write; asked by the read-only Support Agent it may not", async () => {
  const store = await import("../src/state/store");
  const standing = store.standingSeed();
  const s = sc("a2a-escalate");
  assert.equal(run({ ...s, delegation: undefined }, { standing }).decision, "ALLOW");
  const e = run(s, { standing });
  assert.equal(e.decision, "REVIEW");
  assert.equal(e.decidedBy?.layer, "delegation");
  assert.ok(e.evidence.chain.some((n) => n.label === "Delegated via"));
});
test("Delegation: an unregistered agent in the chain blocks; a benign chain passes", () => {
  assert.equal(run(sc("a2a-unknown-hop")).decision, "BLOCK");
  assert.equal(run(sc("a2a-tests")).decision, "ALLOW");
});
test("Delegation: chains deeper than the limit need a person", () => {
  const s = sc("a2a-tests");
  const hops = ["a-claude-code", "a-codex", "a-claude-code", "a-codex"].map((agent) => ({ agent, asked: "pass it on" }));
  assert.equal(run({ ...s, delegation: hops }).decision, "REVIEW");
});

// ── F25 · Supplier agents ───────────────────────────────────────────────────
test("Supplier: inside the contract ALLOW; outside the contracted resource BLOCK", () => {
  assert.equal(run(sc("sup-meridian-read")).decision, "ALLOW");
  const e = run(sc("sup-meridian-export"));
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.decidedBy?.layer, "supplier");
  assert.equal(e.operator, "sup-meridian");
});
test("Supplier: the contract end date is real — the same write passes before it and fails after", () => {
  const s = sc("sup-northwind-expired");
  assert.equal(run(s, { timestamp: Date.parse("2026-08-15T12:00:00Z") }).decision, "ALLOW");
  const after = run(s, { timestamp: Date.parse("2026-09-10T12:00:00Z") });
  assert.equal(after.decision, "BLOCK");
  assert.equal(after.decidedBy?.layer, "supplier");
});
test("Supplier: break-glass never widens a supplier's contract", () => {
  const s = sc("sup-meridian-export");
  assert.equal(run(s, { breakGlass: { resource: s.resource, environment: s.environment } }).decision, "BLOCK");
});
test("Supplier: hosted and supplier agents act from their own host, not an employee laptop", () => {
  assert.equal(run(sc("sup-meridian-read")).device, "host-meridian");
  assert.equal(run(sc("hosted-refund-big")).device, "host-agentcore");
});

// ── F26 · Output check ──────────────────────────────────────────────────────
test("Output (store): nothing sealed → REVIEW; after the $18 refund, $180 is held and $18 passes", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const before = store.simulateById("out-reply-match")!;
  assert.equal(before.decision, "REVIEW");
  assert.equal(before.outputCheck?.status, "UNVERIFIABLE");
  const refund = store.simulateById("out-refund-18")!;
  assert.equal(refund.decision, "ALLOW");
  assert.equal(refund.resultSeal?.value, "$18.00");
  const bad = store.simulateById("out-reply-mismatch")!;
  assert.equal(bad.decision, "REVIEW");
  assert.equal(bad.decidedBy?.layer, "output");
  assert.equal(bad.outputCheck?.status, "MISMATCH");
  const good = store.simulateById("out-reply-match")!;
  assert.equal(good.decision, "ALLOW");
  assert.equal(good.outputCheck?.status, "MATCH");
});
test("Output: a refund that did not run seals nothing", () => {
  const s = sc("out-refund-18");
  const big = run({ ...s, blast: { spendUsd: 180, label: "$180 refund", severity: "moderate" } });
  assert.equal(big.decision, "REVIEW");
  assert.equal(big.resultSeal, undefined);
});

// ── F30 · Browser and hosted agents ─────────────────────────────────────────
test("Browser: the same tokenization rule as the network plane; purchases over the limit wait", () => {
  const f = run(sc("br-form-pii"));
  assert.equal(f.decision, "CONSTRAIN");
  assert.ok(f.payloadAfter && !f.payloadAfter.includes("alice@example.com"));
  assert.equal(run(sc("br-purchase")).decidedBy?.layer, "blast");
});
test("Hosted: the Safety Kernel and the blast-radius limits apply on AgentCore", () => {
  assert.equal(run(sc("hosted-export")).decidedBy?.layer, "safety");
  assert.equal(run(sc("hosted-refund-big")).decision, "REVIEW");
});

// ── F27 · Export to the tools teams already use ─────────────────────────────
test("OCSF: class follows the plane; required attributes present; outcome in the right field", () => {
  const file = toOcsf(run(sc("ep-read-env"))) as any;
  assert.equal(file.class_uid, 1001);
  assert.equal(file.type_uid, 100102);
  assert.equal(file.action_id, 2);
  assert.equal(file.disposition_id, 2);
  for (const k of ["time", "severity_id", "metadata", "actor", "device", "file", "activity_id", "category_uid"]) assert.ok(k in file, k);
  assert.equal(file.metadata.version, "1.3.0");
  const proc = toOcsf(run(sc("ep-run-tests"))) as any;
  assert.equal(proc.class_uid, 1007);
  assert.equal(proc.action_id, 1);
  const http = toOcsf(run(sc("net-pii-approved"))) as any;
  assert.equal(http.class_uid, 4002);
  assert.equal(http.http_response.code, 200);
  assert.equal(http.disposition_id, 99);
  const api = toOcsf(run(sc("gw-force-main"))) as any;
  assert.equal(api.class_uid, 6003);
  assert.ok(api.api.operation && api.cloud.provider);
  assert.equal(api.status_id, 2);
  assert.equal("disposition_id" in api, false, "API Activity has no Security Control profile");
  assert.equal(api.unmapped.wrapbox.decision, "REVIEW");
});
test("OCSF: a review that was approved exports as executed/Approved", () => {
  const e = run(sc("net-code-unapproved"));
  const approved = { ...e, reviewState: { ...e.reviewState!, status: "approved_scoped" as const, reviewer: "u-maya" } };
  assert.equal(executed(approved), true);
  assert.equal((toOcsf(approved) as any).disposition_id, 8);
});
test("OTLP: 64-bit times as decimal strings, integer severities, one record per decision", () => {
  const evs = [run(sc("ep-read-env")), run(sc("mcp-push-main"))];
  const out = toOtlpLogs(evs) as any;
  const recs = out.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(recs.length, 2);
  assert.equal(typeof recs[0].timeUnixNano, "string");
  assert.match(recs[0].timeUnixNano, /^\d{19}$/);
  assert.equal(typeof recs[0].severityNumber, "number");
  const attrs = Object.fromEntries(recs[1].attributes.map((a: any) => [a.key, a.value.stringValue]));
  assert.equal(attrs["gen_ai.tool.name"], "push_files");
  assert.equal(attrs["wrapbox.decision"], "REVIEW");
});

// ── Single matcher: MCP rules go through the same decide() everything uses ──
test("decide(): a hand-built MCP request matches the same clause as the scenario", () => {
  const s = sc("mcp-delete-file");
  const req: ActionRequest = {
    plane: s.plane, action: s.action, agent: s.agent, user: s.user, resource: s.resource, environment: s.environment,
    context: { environment: s.environment, resourceSensitivity: s.sensitivity, privileged: false, businessHours: true },
    mcp: s.mcp,
  };
  assert.equal(decide(req, demo()).decidedBy.clauseId, "cl-mcp-2");
});

// ── Describe → Build: drafting Veridian's own MCP sentences reproduces its rules ──
test("Drafter: the MCP tool policy's English compiles to the same MCP clauses", async () => {
  const { draftClauses } = await import("../src/engine/drafter");
  const { MCP_TOOL_CONTRACT } = await import("../src/model/contracts");
  const drafted = draftClauses(MCP_TOOL_CONTRACT.sourceText);
  assert.equal(drafted.length, MCP_TOOL_CONTRACT.clauses.length);
  drafted.forEach((d, i) => {
    const seed = MCP_TOOL_CONTRACT.clauses[i];
    assert.equal(d.effect, seed.effect, seed.text);
    assert.deepEqual(d.mcp, seed.mcp, seed.text);
    assert.deepEqual(d.requiredCapabilities, seed.requiredCapabilities, seed.text);
  });
  // And each drafted clause decides the scenarios the same way.
  const draftContract = { ...MCP_TOOL_CONTRACT, id: "ic-draft", clauses: drafted };
  const contracts = [...(structuredClone(SEED_CONTRACTS) as IntentContract[]), draftContract];
  for (const id of ["mcp-push-main", "mcp-delete-file", "mcp-stdio-write-env", "mcp-unregistered", "mcp-push-feature"]) {
    assert.equal(run(sc(id), {}, contracts).decision, run(sc(id)).decision, id);
  }
});

// ── Approver routing: money goes to Finance, never back to the requester ──
test("Routing: spend reviews go to the Finance Controller; the requester never decides", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const purchase = store.simulateById("br-purchase")!; // Jordan's browser agent, $450
  assert.equal(store.approverFor(purchase), "u-sam");
  const hosted = store.simulateById("hosted-refund-big")!; // Sam's own hosted agent, $2,400
  assert.equal(store.approverFor(hosted), "u-priya");
  const push = store.simulateById("mcp-push-main")!; // code, not money
  assert.equal(store.approverFor(push), "u-alex");
});
