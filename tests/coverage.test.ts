// Coverage stays in sync with the rules that are switched on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { CAPABILITIES } from "../src/model/registries";
import { buildCoverageMatrix, contractCoverage, canActivate } from "../src/engine/coverage";
import { draftClauses } from "../src/engine/drafter";
import type { IntentContract } from "../src/model/types";

const seed = () => structuredClone(SEED_CONTRACTS) as IntentContract[];
const byId = (cs: IntentContract[], id: string) => cs.find((c) => c.id === id)!;
const activeClauseCount = (cs: IntentContract[]) =>
  cs.filter((c) => c.status === "ACTIVE").reduce((n, c) => n + c.clauses.length, 0);

test("one matrix row per switched-on rule (matches the topbar 'Enforcing N rules')", () => {
  const cs = seed();
  const m = buildCoverageMatrix(cs);
  assert.equal(m.rules.length, activeClauseCount(cs));
  assert.equal(m.rules.length, 14);
});

test("activating a contract moves its rows from 'not switched on' to live; deactivating moves them back", () => {
  const cs = seed();
  const mine: IntentContract = {
    id: "ic-mine", name: "My first rules", author: "u-priya", createdAt: 0, version: 1, status: "DRAFT",
    sourceText: "", coverage: "ENFORCED",
    clauses: draftClauses("Customer email addresses must be tokenized before they are uploaded to external AI. Credentials must never be uploaded to external sites."),
  };
  cs.push(mine);
  let m = buildCoverageMatrix(cs);
  assert.equal(m.rules.length, 14);
  assert.equal(m.inactive.filter((r) => r.source === "My first rules").length, 2);

  mine.status = "ACTIVE";
  m = buildCoverageMatrix(cs);
  assert.equal(m.rules.length, 16);
  assert.equal(m.inactive.filter((r) => r.source === "My first rules").length, 0);

  byId(cs, "ic-external-ai").status = "DEACTIVATED";
  m = buildCoverageMatrix(cs);
  assert.equal(m.rules.length, 12);
  assert.ok(m.inactive.some((r) => r.source === "External AI usage" && r.inactiveReason === "Switched off"));
});

test("contract coverage is the weakest required skill — Engineering guardrails is DEGRADED (Cloud)", () => {
  const cs = seed();
  assert.equal(contractCoverage(byId(cs, "ic-external-ai")), "ENFORCED");
  assert.equal(contractCoverage(byId(cs, "ic-engineering")), "DEGRADED");
  assert.equal(contractCoverage(byId(cs, "ic-hr-legal")), "DEGRADED");
  assert.equal(contractCoverage(byId(cs, "ic-health")), "PENDING");
  // stored snapshots agree with the live calculation
  for (const c of cs) assert.equal(c.coverage, contractCoverage(c), c.name);
});

test("a contract needing a missing skill cannot be activated", () => {
  assert.equal(canActivate(byId(seed(), "ic-health")), false);
  assert.equal(canActivate(byId(seed(), "ic-engineering")), true);
});

test("store refuses to activate a PENDING contract", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  assert.equal(store.setContractStatus("ic-health", "ACTIVE"), false);
  assert.equal(store.getState().contracts.find((c) => c.id === "ic-health")!.status, "DRAFT");
  assert.equal(store.setContractStatus("ic-hr-legal", "DEACTIVATED"), true);
});

test("each gap lists the live promises it holds back, worst first", () => {
  const cs = seed();
  const m = buildCoverageMatrix(cs);
  const semantic = m.gaps.find((g) => g.id === "cap-semantic")!;
  assert.deepEqual(semantic.affects!.rules.map((r) => r.source), ["HR & privileged material", "HR & privileged material"]);
  const cloud = m.gaps.find((g) => g.id === "cap-gw-cloud")!;
  assert.equal(cloud.affects!.rules.length, 1); // Engineering: production deploys
  assert.equal(cloud.affects!.safety.length, 2); // destructive prod + permission escalation
  const clipboard = m.gaps.find((g) => g.id === "cap-ep-clipboard")!;
  assert.equal(clipboard.affects!.rules.length + clipboard.affects!.safety.length, 0);
  const totals = m.gaps.map((g) => g.affects!.rules.length + g.affects!.safety.length);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
  // switching the HR contract off removes its rules from the semantic gap
  byId(cs, "ic-hr-legal").status = "DEACTIVATED";
  assert.equal(buildCoverageMatrix(cs).gaps.find((g) => g.id === "cap-semantic")!.affects!.rules.length, 0);
});

test("known gaps are every skill not fully enforced, and the counts add up", () => {
  const m = buildCoverageMatrix(seed());
  assert.equal(m.gaps.length, CAPABILITIES.filter((c) => c.status !== "ENFORCED").length);
  assert.ok(m.gaps.some((g) => g.status === "UNINSPECTABLE"));
  const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, m.rules.length + m.safety.length + m.gaps.length);
});
