// Self-test: prove the REAL engine agrees with every intended verdict in the
// Enforcement Playground.
//
// Every assertion below goes through runAction() → evaluate() / rewrite() /
// permitCheck() in src/lib/engine.ts. If a row disagrees, the RULE or the ACT is
// wrong — never patch the UI, and never hardcode a verdict to make a row pass.
//
// Run:  npx tsx src/data/playground.selftest.ts

import type { Decision } from "./agents";
import { AGENT_POOLS, PLAYGROUND_RULES, POLICY_TOGGLES, SURFACES, actionById, runAction, type ScenarioAction } from "./playground";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
}

function must(id: string): ScenarioAction {
  const a = actionById(id);
  if (!a) throw new Error(`no such action: ${id}`);
  return a;
}

/* ============================================================================
 * 1 · THE DECISION TABLE
 * Rows 1–34 are the spec's table. Rows marked "+" are the extra actions on the
 * Claude Desktop / Claude Code CLI / Slack / Salesforce cards, asserted the same
 * way so no action in the playground is untested.
 * ========================================================================== */

const TABLE: { row: string; id: string; want: Decision; note?: string }[] = [
  { row: "1", id: "pg-browser-upload-pii", want: "BLOCK" },
  { row: "2", id: "pg-browser-claude", want: "ALLOW" },
  { row: "3", id: "pg-browser-incognito", want: "BLOCK" },
  { row: "4", id: "pg-browser-sanitized", want: "ALLOW" },
  { row: "5", id: "pg-cursor-env", want: "BLOCK" },
  { row: "6", id: "pg-cursor-edit", want: "ALLOW" },
  { row: "7", id: "pg-cursor-force", want: "CONSTRAIN", note: "rewrite → --force-with-lease" },
  { row: "8", id: "pg-cursor-rmrf", want: "BLOCK" },
  { row: "9", id: "pg-vscode-aws", want: "BLOCK" },
  { row: "10", id: "pg-vscode-refactor", want: "ALLOW" },
  { row: "11", id: "pg-vscode-main", want: "REVIEW", note: "sre-oncall ×2" },
  { row: "12", id: "pg-agent-model", want: "BLOCK" },
  { row: "13", id: "pg-agent-read", want: "ALLOW" },
  { row: "14", id: "pg-agent-idrsa", want: "BLOCK" },
  { row: "15", id: "pg-stripe-120", want: "ALLOW" },
  { row: "16", id: "pg-stripe-3500", want: "REVIEW", note: "payments-manager" },
  { row: "17", id: "pg-stripe-50000", want: "BLOCK" },
  { row: "18", id: "pg-stripe-integrity", want: "REVIEW" },
  { row: "19", id: "pg-db-analytics", want: "ALLOW" },
  { row: "20", id: "pg-db-pii", want: "CONSTRAIN", note: "mask + LIMIT" },
  { row: "21", id: "pg-db-drop", want: "BLOCK" },
  { row: "22", id: "pg-db-update", want: "REVIEW", note: "sre-oncall ×2" },
  { row: "23", id: "pg-gh-feature", want: "ALLOW" },
  { row: "24", id: "pg-gh-main", want: "REVIEW" },
  { row: "25", id: "pg-gh-protection", want: "BLOCK" },
  { row: "26", id: "pg-gh-deploy", want: "ALLOW", note: "+ permit" },
  { row: "27", id: "pg-aws-read", want: "ALLOW" },
  { row: "28", id: "pg-aws-public", want: "BLOCK" },
  { row: "29", id: "pg-aws-iam", want: "REVIEW" },
  { row: "30", id: "pg-aws-staging", want: "ALLOW" },
  { row: "31", id: "pg-slack-internal", want: "ALLOW" },
  { row: "32", id: "pg-slack-export", want: "BLOCK" },
  { row: "33", id: "pg-sf-read", want: "ALLOW" },
  { row: "34", id: "pg-sf-bulk", want: "REVIEW" },
  // Extra surfaces — same rules, different agent and different surface.
  { row: "+", id: "pg-cli-dotenv", want: "BLOCK" },
  { row: "+", id: "pg-cli-tests", want: "ALLOW" },
  { row: "+", id: "pg-cli-hotfix-main", want: "REVIEW" },
  { row: "+", id: "pg-desktop-csv", want: "ALLOW" },
  { row: "+", id: "pg-desktop-gcloud", want: "BLOCK" },
  { row: "+", id: "pg-desktop-summarizer", want: "BLOCK" },
  { row: "+", id: "pg-slack-external-ok", want: "ALLOW" },
  { row: "+", id: "pg-sf-warehouse", want: "ALLOW" },
];

console.log("\nWrapbox Enforcement Playground · engine self-test");
console.log("=".repeat(96));
console.log(`${PLAYGROUND_RULES.length} rules · ${SURFACES.length} surfaces · ${SURFACES.reduce((n, s) => n + s.actions.length, 0)} actions · every verdict from src/lib/engine.ts\n`);

console.log("1 · DECISION TABLE");
console.log("-".repeat(96));
console.log(`  ${"#".padEnd(4)}${"action".padEnd(26)}${"plane".padEnd(10)}${"got".padEnd(11)}${"want".padEnd(11)}rule · reason`);
for (const t of TABLE) {
  const a = must(t.id);
  const r = runAction(a);
  const who = `${r.verdict.rule} · ${r.verdict.reason}`;
  console.log(`  ${t.row.padEnd(4)}${t.id.replace(/^pg-/, "").padEnd(26)}${r.plane.padEnd(10)}${r.verdict.decision.padEnd(11)}${t.want.padEnd(11)}${who}`);
  ok(`row ${t.row} ${t.id} → ${t.want}`, r.verdict.decision === t.want, `got ${r.verdict.decision} from rule ${r.verdict.rule} (${r.verdict.reason})`);
}

/* ============================================================================
 * 2 · Approver detail the table names
 * ========================================================================== */
console.log("\n2 · APPROVERS AND QUORUM");
console.log("-".repeat(96));
{
  const checks: { id: string; approvers: string; quorum?: number }[] = [
    { id: "pg-vscode-main", approvers: "sre-oncall", quorum: 2 },
    { id: "pg-gh-main", approvers: "sre-oncall", quorum: 2 },
    { id: "pg-db-update", approvers: "sre-oncall", quorum: 2 },
    { id: "pg-stripe-3500", approvers: "payments-manager", quorum: 1 },
    { id: "pg-stripe-integrity", approvers: "platform-security", quorum: 1 },
    { id: "pg-aws-iam", approvers: "cloud-security", quorum: 2 },
    { id: "pg-sf-bulk", approvers: "data-governance", quorum: 1 },
  ];
  for (const c of checks) {
    const r = runAction(must(c.id));
    console.log(`  ${c.id.replace(/^pg-/, "").padEnd(26)}approvers=${String(r.verdict.approvers).padEnd(20)}quorum=${String(r.verdict.quorum)}`);
    ok(`${c.id} approvers = ${c.approvers}`, r.verdict.approvers === c.approvers, `got ${String(r.verdict.approvers)}`);
    ok(`${c.id} quorum = ${c.quorum}`, (r.verdict.quorum ?? 1) === c.quorum, `got ${String(r.verdict.quorum)}`);
  }
}

/* ============================================================================
 * 3 · Real rewrites and a real permit
 * ========================================================================== */
console.log("\n3 · REWRITES AND PERMIT");
console.log("-".repeat(96));
{
  const force = runAction(must("pg-cursor-force"));
  console.log(`  force-push  in:  ${must("pg-cursor-force").act.command}`);
  console.log(`              out: ${force.rewritten}`);
  ok("row 7 rewritten contains --force-with-lease", !!force.rewritten?.includes("--force-with-lease"), `got ${String(force.rewritten)}`);
  ok("row 7 rewrite drops the bare --force", !/\s--force(?!-)/.test(force.rewritten ?? ""), `got ${String(force.rewritten)}`);

  const mask = runAction(must("pg-db-pii"));
  console.log(`  pii read    in:  ${must("pg-db-pii").act.sql}`);
  console.log(`              out: ${mask.rewritten}`);
  ok("row 20 rewritten contains wbx_mask(email)", !!mask.rewritten?.includes("wbx_mask(email)"), `got ${String(mask.rewritten)}`);
  ok("row 20 rewritten contains wbx_mask(phone)", !!mask.rewritten?.includes("wbx_mask(phone)"), `got ${String(mask.rewritten)}`);
  ok("row 20 rewritten contains LIMIT", /\blimit\b/i.test(mask.rewritten ?? ""), `got ${String(mask.rewritten)}`);

  const deploy = runAction(must("pg-gh-deploy"));
  console.log(`  deploy      permitId: ${deploy.permitId}   receipt: ${deploy.receiptId}`);
  ok("row 26 mints a permit id", !!deploy.permitId, `got ${String(deploy.permitId)}`);
  ok("row 26 permit id is deterministic", runAction(must("pg-gh-deploy")).permitId === deploy.permitId, "two runs disagreed");

  // No permit is minted where no rule carries one.
  const ordinary = runAction(must("pg-cursor-edit"));
  ok("an ordinary ALLOW mints no permit", ordinary.permitId === undefined, `got ${String(ordinary.permitId)}`);
}

/* ============================================================================
 * 4 · Receipt ids are deterministic and unique
 * ========================================================================== */
console.log("\n4 · DETERMINISM");
console.log("-".repeat(96));
{
  const ids = TABLE.map((t) => runAction(must(t.id)).receiptId);
  const again = TABLE.map((t) => runAction(must(t.id)).receiptId);
  ok("receipt ids are stable across runs", ids.join() === again.join(), "two runs disagreed");
  ok("receipt ids are unique per action", new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} collision(s)`);
  console.log(`  ${ids.length} receipts, ${new Set(ids).size} distinct · sample ${ids.slice(0, 5).join(", ")}`);
  ok("no rule matches on agent identity (when.subject)", PLAYGROUND_RULES.every((r) => !r.when.subject), "a rule uses when.subject — the agent could change the verdict");

  // A receipt names a DECISION EVENT, not an action. Re-deciding the same action
  // under different policy or a different asker must mint a different id, or one
  // id would denote two contradictory records.
  const secrets = POLICY_TOGGLES.find((t) => t.ruleIds.includes("secrets-never"));
  if (secrets) {
    const onIds = POLICY_TOGGLES.filter((t) => t.defaultOn).map((t) => t.id);
    const offIds = onIds.filter((i) => i !== secrets.id);
    const a = runAction(must("pg-cursor-env"), { enabledToggleIds: onIds });
    const b = runAction(must("pg-cursor-env"), { enabledToggleIds: offIds });
    ok("a different policy state mints a different receipt", a.receiptId !== b.receiptId, `both runs returned ${a.receiptId} while deciding ${a.verdict.decision} then ${b.verdict.decision}`);
    ok("that pair really did decide differently", a.verdict.decision !== b.verdict.decision, `both ${a.verdict.decision}`);
  }
  const byCursor = runAction(must("pg-cursor-env"), { agent: "Cursor" });
  const byCli = runAction(must("pg-cursor-env"), { agent: "Claude Code (CLI)" });
  ok("a different asker mints a different receipt", byCursor.receiptId !== byCli.receiptId, `both returned ${byCursor.receiptId}`);
  ok("…while the verdict is unchanged", byCursor.verdict.decision === byCli.verdict.decision, `${byCursor.verdict.decision} vs ${byCli.verdict.decision}`);
}

/* ============================================================================
 * 5 · AGENT INDEPENDENCE — the whole point of the "Try another agent" control
 * ========================================================================== */
console.log("\n5 · AGENT INDEPENDENCE");
console.log("-".repeat(96));
for (const id of ["pg-cursor-env", "pg-agent-model", "pg-db-drop"]) {
  const a = must(id);
  const pool = AGENT_POOLS[a.agentPool];
  const agents = [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];
  const runs = agents.map((agent) => runAction(a, { agent }));
  const line = runs.map((r, i) => `${agents[i]}=${r.verdict.decision}`).join("  ");
  console.log(`  ${id.replace(/^pg-/, "").padEnd(20)}${line}`);
  ok(`${id} decision is identical across ${agents.length} agents`, new Set(runs.map((r) => r.verdict.decision)).size === 1, line);
  ok(`${id} rule is identical across ${agents.length} agents`, new Set(runs.map((r) => r.verdict.rule)).size === 1, runs.map((r) => r.verdict.rule).join(", "));
  ok(`${id} receipt labels the agent that asked`, runs.every((r, i) => r.agent === agents[i]), runs.map((r) => r.agent).join(", "));
}

/* ============================================================================
 * 6 · TOGGLE REALITY — a toggle must really change the engine's answer
 * ========================================================================== */
console.log("\n6 · POLICY TOGGLES");
console.log("-".repeat(96));
{
  const all = POLICY_TOGGLES.map((t) => t.id);
  const withoutPii = all.filter((t) => t !== "pii-secrets");

  const probes = ["pg-cursor-env", "pg-db-pii", "pg-slack-export"];
  let changed = 0;
  for (const id of probes) {
    const a = must(id);
    const on = runAction(a, { enabledToggleIds: all });
    const off = runAction(a, { enabledToggleIds: withoutPii });
    const back = runAction(a, { enabledToggleIds: all });
    console.log(`  ${id.replace(/^pg-/, "").padEnd(20)}on=${on.verdict.decision.padEnd(11)}off=${off.verdict.decision.padEnd(11)}restored=${back.verdict.decision}`);
    if (on.verdict.decision !== off.verdict.decision) changed++;
    ok(`${id} decision is restored when the toggle goes back on`, back.verdict.decision === on.verdict.decision, `${on.verdict.decision} → ${off.verdict.decision} → ${back.verdict.decision}`);
  }
  ok("turning the PII/secrets toggle off changes at least one row", changed > 0, "no row changed — the toggle is decorative");
  ok("turning the PII/secrets toggle off changes the secrets row specifically", runAction(must("pg-cursor-env"), { enabledToggleIds: withoutPii }).verdict.decision === "ALLOW", `got ${runAction(must("pg-cursor-env"), { enabledToggleIds: withoutPii }).verdict.decision}`);

  // Every toggle must be wired to rules that actually exist.
  const ruleIds = new Set(PLAYGROUND_RULES.map((r) => r.id));
  const dangling = POLICY_TOGGLES.flatMap((t) => t.ruleIds).filter((r) => !ruleIds.has(r));
  ok("every toggle points at real rules", dangling.length === 0, `dangling: ${dangling.join(", ")}`);
  const covered = new Set(POLICY_TOGGLES.flatMap((t) => t.ruleIds));
  const uncovered = PLAYGROUND_RULES.map((r) => r.id).filter((r) => !covered.has(r) && r !== "allow-ordinary");
  ok("every enforcing rule sits under a toggle", uncovered.length === 0, `not covered: ${uncovered.join(", ")}`);
}

/* ============================================================================
 * 7 · STRUCTURE — the contract the UI codes against
 * ========================================================================== */
console.log("\n7 · STRUCTURE");
console.log("-".repeat(96));
{
  const actions = SURFACES.flatMap((s) => s.actions);
  ok("every action id is unique", new Set(actions.map((a) => a.id)).size === actions.length, "duplicate action id");
  ok("every surface has 3–4 actions", SURFACES.every((s) => s.actions.length >= 3 && s.actions.length <= 4), SURFACES.filter((s) => s.actions.length < 3 || s.actions.length > 4).map((s) => `${s.id}=${s.actions.length}`).join(", "));
  ok("every surface plane matches its group", SURFACES.every((s) => s.plane === (s.group.startsWith("runtime-") ? "runtime" : "gateway")), "a surface plane disagrees with its group");
  ok("every default agent is in its pool", actions.every((a) => AGENT_POOLS[a.agentPool].includes(a.defaultAgent)), actions.filter((a) => !AGENT_POOLS[a.agentPool].includes(a.defaultAgent)).map((a) => a.id).join(", "));
  ok("every action has a why sentence", actions.every((a) => a.why.trim().length > 20), "a why sentence is missing or too short");
  ok("every action returns a result sentence", actions.every((a) => runAction(a).result.trim().length > 0), "an action produced no result sentence");
  ok("the decision table covers every action", new Set(TABLE.map((t) => t.id)).size === actions.length, `table ${TABLE.length} vs actions ${actions.length}`);
  console.log(`  ${SURFACES.length} surfaces, ${actions.length} actions, ${TABLE.length} asserted rows`);
}

console.log("\n" + "=".repeat(96));
console.log(`RESULT: ${passed} passed, ${failed} failed\n`);
// Signal a non-zero exit for CI without depending on @types/node in tsconfig.
if (failed > 0) (globalThis as { process?: { exit?: (code: number) => void } }).process?.exit?.(1);
