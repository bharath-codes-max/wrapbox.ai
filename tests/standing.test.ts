// Standing permissions are enforced: limits, "may not", revoke, expiry; tasks unaffected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { scenarioById } from "../src/engine/scenarios";
import { runScenario, setSeq, setTokenCounter } from "../src/engine/simulate";
import type { IntentContract, StandingPermission } from "../src/model/types";

async function seedStanding() {
  const { standingSeed } = await import("../src/state/store");
  return standingSeed(Date.UTC(2026, 8, 24));
}
function run(id: string, standing: StandingPermission[], now = Date.UTC(2026, 8, 24, 12)) {
  setSeq(8000); setTokenCounter(800);
  return runScenario(scenarioById(id)!, structuredClone(SEED_CONTRACTS) as IntentContract[], "t", { standing, timestamp: now }).event;
}

test("active permissions: in-scope everyday work flows", async () => {
  const sp = await seedStanding();
  assert.equal(run("gw-select-50", sp).decision, "ALLOW");
  assert.equal(run("gw-select-300", sp).decision, "ALLOW"); // within 500
  assert.equal(run("gw-push-feature", sp).decision, "ALLOW");
});

test("narrowing the row limit (Autopilot 500 → 200) makes a 300-row query need a yes", async () => {
  const sp = (await seedStanding()).map((p) => (p.id === "sp-002" ? { ...p, maxRows: 200 } : p));
  const e = run("gw-select-300", sp);
  assert.equal(e.decision, "REVIEW");
  assert.equal(e.decidedBy?.layer, "standing");
  assert.match(e.decidedBy!.label, /above the standing limit of 200/);
  assert.equal(run("gw-select-50", sp).decision, "ALLOW");
});

test("revoked or expired: that agent's everyday work there needs a yes", async () => {
  const revoked = (await seedStanding()).map((p) => (p.id === "sp-002" ? { ...p, status: "revoked" as const } : p));
  assert.equal(run("gw-select-50", revoked).decision, "REVIEW");
  const expired = (await seedStanding()).map((p) => (p.id === "sp-001" ? { ...p, expiresAt: Date.UTC(2026, 8, 1) } : p));
  const e = run("gw-push-feature", expired);
  assert.equal(e.decision, "REVIEW");
  assert.match(e.decidedBy!.label, /expired/);
});

test("store: autopilot narrowing and revoke/grant-again change real decisions; tasks keep their own authority", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  store.acceptAutopilot("ap-002");
  assert.equal(store.getState().standing.find((p) => p.id === "sp-002")!.maxRows, 200);
  assert.equal(store.simulateById("gw-select-300")!.decision, "REVIEW");
  store.revokeStanding("sp-001");
  assert.equal(store.simulateById("gw-push-feature")!.decision, "REVIEW");
  // the engineering task commits to the same repo — its slip is the authority
  const t = store.startTask("job-eng-checkout"); store.advanceTask(t.taskId);
  const commit = store.getState().tasks.find((x) => x.taskId === t.taskId)!.steps[4];
  assert.equal(commit.decision, "ALLOW");
  store.grantStandingAgain("sp-001", "u-priya");
  assert.equal(store.simulateById("gw-push-feature")!.decision, "ALLOW");
  store.resetDemoData();
});
