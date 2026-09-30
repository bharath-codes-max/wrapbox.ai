// Workspaces + onboarding: a fresh workspace is genuinely empty, the admin
// wizard's store writes are real, and the demo is never touched by it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { canActivate } from "../src/engine/coverage";
import { scenarioById } from "../src/engine/scenarios";

async function store() {
  return import("../src/state/store");
}

test("a fresh workspace starts at day one: no history, no rules, nothing connected", async () => {
  const s = await store();
  s.startFreshWorkspace();
  const st = s.getState();
  assert.equal(st.workspace, "fresh");
  assert.equal(st.events.length, 0);
  assert.equal(st.contracts.length, 0);
  assert.equal(st.standing.length, 0);
  assert.equal(st.autopilot.length, 0, "no Autopilot suggestions without history");
  assert.equal(st.onboarding.adminDone, false);
  assert.deepEqual(st.onboarding.connected, []);
  s.switchWorkspace("demo");
});

test("the Safety Kernel protects from the first second — even with zero company rules", async () => {
  const s = await store();
  s.startFreshWorkspace();
  const e = s.simulateById("net-unknown-dest")!;
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.decidedBy?.layer, "safety");
  assert.equal(s.getState().events.length, 1, "the self-test is a real recorded event");
  s.switchWorkspace("demo");
});

test("publishing the recommended pack only activates contracts Wrapbox can keep", async () => {
  const s = await store();
  s.startFreshWorkspace();
  const r = s.publishRecommendedContracts();
  for (const c of SEED_CONTRACTS) {
    const inStore = s.getState().contracts.find((x) => x.id === c.id)!;
    const expected = canActivate(c) ? "ACTIVE" : "DRAFT";
    assert.equal(inStore.status, expected, c.name);
    assert.ok((expected === "ACTIVE" ? r.active : r.draft).includes(c.id));
  }
  // Decisions after publishing are the same engine result the shadow evaluator predicts.
  const sc = scenarioById("ep-read-env")!;
  const predicted = s.shadowEvaluate(sc, s.getState().contracts, s.getState().kernel, s.getState().standing);
  assert.equal(s.simulateById("ep-read-env")!.decision, predicted);
  s.switchWorkspace("demo");
});

test("onboarding writes are real and land in the current workspace only", async () => {
  const s = await store();
  s.startFreshWorkspace();
  s.setOrg({ company: "Acme Health", domain: "acme.example", region: "eu", idp: "Okta", keyThumb: "0123456789abcdef" });
  s.setOnboarding({ categories: ["coding"], connected: ["endpoint", "gw-github"] });
  s.completeAdminOnboarding();
  const st = s.getState();
  assert.equal(st.org.company, "Acme Health");
  assert.deepEqual(st.onboarding.connected, ["endpoint", "gw-github"]);
  assert.equal(st.onboarding.adminDone, true);
  // The demo keeps its own org, history and completed onboarding.
  s.switchWorkspace("demo");
  const demo = s.getState();
  assert.equal(demo.workspace, "demo");
  assert.equal(demo.org.company, "Veridian Systems");
  assert.ok(demo.events.length > 0, "the demo's history is untouched");
  assert.equal(demo.onboarding.adminDone, true);
});

test("employee progress is tracked separately and never approves its own action", async () => {
  const s = await store();
  s.startFreshWorkspace();
  s.publishRecommendedContracts();
  s.setEmployeeProgress({ accepted: true, passkey: true });
  const e = s.simulateById("gw-force-main")!;
  assert.notEqual(s.approverFor(e), e.user, "the requester is never the approver");
  assert.equal(s.getState().onboarding.employee.accepted, true);
  assert.equal(s.getState().onboarding.employeeDone, false);
  s.completeEmployeeOnboarding();
  assert.equal(s.getState().onboarding.employeeDone, true);
  s.switchWorkspace("demo");
});
