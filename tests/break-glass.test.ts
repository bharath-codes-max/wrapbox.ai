// Break-glass covers one system for a short time, stamps only what it changed,
// records who was notified, and never overrides the Safety Kernel.
import { test } from "node:test";
import assert from "node:assert/strict";

async function fresh() {
  const store = await import("../src/state/store");
  store.resetDemoData();
  return store;
}

test("in scope: force-push to production main goes through, stamped BREAK-GLASS", async () => {
  const store = await fresh();
  assert.equal(store.simulateById("gw-force-main")!.decision, "REVIEW");
  store.startBreakGlass("u-priya", "INC-4471 hotfix", "r-checkout", "production", "checkout-service — production branch (main)", 30);
  const e = store.simulateById("gw-force-main")!;
  assert.equal(e.decision, "ALLOW");
  assert.equal(e.decidedBy?.layer, "breakglass");
  assert.equal(e.breakGlass, true);
  store.resetDemoData();
});

test("out of scope: other systems are unchanged", async () => {
  const store = await fresh();
  store.startBreakGlass("u-priya", "INC-4471", "r-checkout", "production", "checkout", 30);
  const drop = store.simulateById("gw-drop-table")!; // payments-prod
  assert.notEqual(drop.decision, "ALLOW");
  assert.notEqual(drop.decidedBy?.layer, "breakglass");
  assert.equal(drop.breakGlass, undefined);
  store.resetDemoData();
});

test("the Safety Kernel never yields, even in scope", async () => {
  const store = await fresh();
  store.startBreakGlass("u-priya", "INC-4471", "r-aws-prod", "production", "AWS Production", 30);
  const e = store.simulateById("gw-iam-admin")!;
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.decidedBy?.layer, "safety");
  assert.equal(e.breakGlass, undefined);
  assert.ok(e.decisionReasons.some((r: string) => /never yields/.test(r)));
  store.resetDemoData();
});

test("actions that were allowed anyway are not stamped", async () => {
  const store = await fresh();
  store.startBreakGlass("u-priya", "INC-4471", "r-customer-db", "production", "customer-db", 30);
  const e = store.simulateById("gw-select-50")!;
  assert.equal(e.decision, "ALLOW");
  assert.equal(e.breakGlass, undefined);
  store.resetDemoData();
});

test("notified list excludes the requester; duration clamps to 5–60; ended session stops overriding", async () => {
  const store = await fresh();
  store.startBreakGlass("u-alex", "INC", "r-checkout", "production", "checkout", 500);
  const bg = store.getState().breakGlass.at(-1)!;
  assert.equal(bg.durationMin, 60);
  assert.deepEqual(bg.notified, ["u-maya"]);
  store.endBreakGlass(bg.id);
  assert.equal(store.simulateById("gw-force-main")!.decision, "REVIEW");
  store.resetDemoData();
});

test("with the history-rewrite kernel rule enforced, only the SRE-approval deploy is overridable in AWS Production", async () => {
  const store = await fresh();
  store.installKernelUpdate(); store.enforceKernelRule("sk-history-rewrite");
  assert.equal(store.simulateById("gw-deploy-hotfix")!.decision, "REVIEW");
  store.startBreakGlass("u-priya", "SEV-1", "r-aws-prod", "production", "AWS Production", 30);
  const deploy = store.simulateById("gw-deploy-hotfix")!;
  assert.equal(deploy.decision, "ALLOW");
  assert.equal(deploy.breakGlass, true);
  assert.equal(store.simulateById("gw-iam-admin")!.decision, "BLOCK");
  store.resetDemoData();
});

test("DROP TABLE under a payments-prod override stays blocked: the Safety Kernel also caught it", async () => {
  const store = await fresh();
  store.startBreakGlass("u-priya", "SEV-1", "r-payments-prod", "production", "payments-prod", 15);
  const e = store.simulateById("gw-drop-table")!;
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.breakGlass, undefined);
  assert.ok(e.decisionReasons.some((r: string) => /never yields/.test(r)));
  store.resetDemoData();
});
