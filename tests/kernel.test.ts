// Safety Kernel as a Wrapbox-managed, versioned pack: install → observe → enforce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { scenarioById } from "../src/engine/scenarios";
import { runScenario, setSeq, setTokenCounter } from "../src/engine/simulate";
import {
  BASELINE_KERNEL, KERNEL_RELEASES, OBSERVE_WINDOW_DAYS, enforceRule, factsFromEvent,
  installRelease, installedRules, kernelRule, pendingRelease, type KernelState,
} from "../src/engine/kernel";
import { buildCoverageMatrix } from "../src/engine/coverage";
import type { IntentContract } from "../src/model/types";

const seed = () => structuredClone(SEED_CONTRACTS) as IntentContract[];
const T0 = Date.UTC(2026, 8, 24);
function run(id: string, kernel: KernelState, now = T0) {
  setSeq(9000);
  setTokenCounter(900);
  return runScenario(scenarioById(id)!, seed(), "t", { kernel, timestamp: now }).event;
}

test("baseline pack: 6 rules, all enforcing, and an update is available", () => {
  assert.equal(installedRules(BASELINE_KERNEL).length, 6);
  assert.ok(Object.values(BASELINE_KERNEL.modes).every((m) => m === "enforcing"));
  assert.equal(pendingRelease(BASELINE_KERNEL)?.version, "2026.09.2");
});

test("force-push main: REVIEW on the baseline pack", () => {
  const e = run("gw-force-main", BASELINE_KERNEL);
  assert.equal(e.decision, "REVIEW");
  assert.equal(e.safetyObserved, undefined);
});

test("after installing the update the new rule OBSERVES: decision unchanged, 'would have blocked' recorded", () => {
  const k = installRelease(BASELINE_KERNEL, KERNEL_RELEASES[1], T0);
  assert.equal(k.version, "2026.09.2");
  assert.equal(k.modes["sk-history-rewrite"], "observing");
  assert.equal(pendingRelease(k), undefined);
  const e = run("gw-force-main", k);
  assert.equal(e.decision, "REVIEW");
  assert.deepEqual(e.safetyObserved?.map((r) => r.ruleId), ["sk-history-rewrite"]);
  // a normal feature-branch push is untouched
  assert.equal(run("gw-push-feature", k).safetyObserved, undefined);
});

test("enforcing the new rule turns force-push main into BLOCK, decided by the Safety Kernel", () => {
  const k = enforceRule(installRelease(BASELINE_KERNEL, KERNEL_RELEASES[1], T0), "sk-history-rewrite");
  const e = run("gw-force-main", k);
  assert.equal(e.decision, "BLOCK");
  assert.equal(e.decidedBy?.layer, "safety");
  assert.equal(e.decidedBy?.ruleId, "sk-history-rewrite");
  assert.equal(run("gw-push-feature", k).decision, "ALLOW");
});

test("an observing rule enforces on its own once the observation window has passed", () => {
  const k = installRelease(BASELINE_KERNEL, KERNEL_RELEASES[1], T0);
  const later = T0 + (OBSERVE_WINDOW_DAYS + 1) * 24 * 3600 * 1000;
  assert.equal(run("gw-force-main", k, later).decision, "BLOCK");
});

test("a rule can be replayed over recorded history (update impact preview)", () => {
  const past = run("gw-force-main", BASELINE_KERNEL);
  assert.equal(kernelRule("sk-history-rewrite")!.test(factsFromEvent(past)), true);
  assert.equal(kernelRule("sk-history-rewrite")!.test(factsFromEvent(run("gw-push-feature", BASELINE_KERNEL))), false);
});

test("Coverage Map lists the new rule, marked as observing", () => {
  assert.equal(buildCoverageMatrix(seed(), BASELINE_KERNEL, T0).safety.length, 6);
  const m = buildCoverageMatrix(seed(), installRelease(BASELINE_KERNEL, KERNEL_RELEASES[1], T0), T0);
  const row = m.safety.find((r) => r.id === "sk-history-rewrite")!;
  assert.match(row.source, /observing/);
});

test("store: install and enforce update the saved state; reset restores the baseline", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  assert.equal(store.installKernelUpdate(), true);
  assert.equal(store.getState().kernel.modes["sk-history-rewrite"], "observing");
  assert.equal(store.installKernelUpdate(), false); // nothing left to install
  store.enforceKernelRule("sk-history-rewrite");
  assert.equal(store.getState().kernel.modes["sk-history-rewrite"], "enforcing");
  store.resetDemoData();
  assert.equal(store.getState().kernel.version, "2026.09.1");
});

test("token vault: restore allowed only inside the company, every attempt logged", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const tok = store.getState().tokens[0];
  assert.ok(tok, "seed has tokens");
  const inside = store.restoreToken(tok.id, "Priya Menon (inside Veridian)", true)!;
  const outside = store.restoreToken(tok.id, "ai.enterprise.example (outside Veridian)", false)!;
  assert.equal(inside.allowed, true);
  assert.equal(outside.allowed, false);
  assert.match(outside.reason, /outside/);
  assert.equal(store.getState().restorations.length, 2);
  store.resetDemoData();
  assert.equal(store.getState().restorations.length, 0);
});

test("policy autopilot: accept creates a DRAFT (never active) or narrows a permission", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const before = store.getState().contracts.length;
  store.acceptAutopilot("ap-001");
  const draft = store.getState().contracts.find((c) => c.id === "ic-ap-001")!;
  assert.equal(store.getState().contracts.length, before + 1);
  assert.equal(draft.status, "DRAFT");
  assert.equal(store.getState().autopilot.find((a) => a.id === "ap-001")!.status, "accepted");
  // accepting twice does nothing
  assert.equal(store.acceptAutopilot("ap-001"), undefined);
  store.acceptAutopilot("ap-002");
  const sp = store.getState().standing.find((x) => x.id === "sp-002")!;
  assert.equal(sp.maxRows, 200);
  store.resetDemoData();
});
