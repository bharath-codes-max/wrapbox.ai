// "Which rule decided" + drafter + shadow what-if tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { scenarioById } from "../src/engine/scenarios";
import { runScenario, pipelineFor, setSeq, setTokenCounter, getTokenCounter } from "../src/engine/simulate";
import { draftClauses } from "../src/engine/drafter";
import type { IntentContract } from "../src/model/types";

const seed = () => structuredClone(SEED_CONTRACTS) as IntentContract[];
function run(id: string, contracts: IntentContract[]) {
  setSeq(5000);
  setTokenCounter(500);
  return runScenario(scenarioById(id)!, contracts, "t").event;
}

const WALKTHROUGH =
  "Customer email addresses and phone numbers must be tokenized before they are uploaded to external AI. " +
  "Credentials and API keys must never be uploaded to external sites. " +
  "Uploading source code to external AI requires security review.";

function withMyRules(): IntentContract[] {
  const clauses = draftClauses(WALKTHROUGH);
  return [...seed(), {
    id: "ic-mine", name: "My first rules", author: "u-priya", createdAt: 0, version: 1,
    status: "ACTIVE", sourceText: WALKTHROUGH, clauses, coverage: "ENFORCED",
  }];
}

test("drafter: walkthrough sentences compile to CONSTRAIN / BLOCK / REVIEW", () => {
  const c = draftClauses(WALKTHROUGH);
  assert.equal(c.length, 3);
  assert.equal(c[0].effect, "CONSTRAIN");
  assert.equal(c[0].transform, "REVERSIBLE_TOKENIZE");
  assert.deepEqual(c[0].dataClasses, ["PII.EMAIL", "PII.PHONE"]);
  assert.equal(c[1].effect, "BLOCK");
  assert.ok(c[1].dataClasses.includes("CREDENTIAL.API_KEY"));
  assert.equal(c[2].effect, "REVIEW");
  assert.deepEqual(c[2].dataClasses, ["SOURCE_CODE"]);
});

test("drafter: 'approved AI' means allowed, not needs-approval", () => {
  const [c] = draftClauses("Employees may use approved AI services for normal business work.");
  assert.equal(c.effect, "ALLOW");
  assert.deepEqual(c.destinations, ["APPROVED_AI"]);
  const [r] = draftClauses("Production deployments require SRE approval.");
  assert.equal(r.effect, "REVIEW");
  const [a] = draftClauses("The security team must approve every export.");
  assert.equal(a.effect, "REVIEW");
});

test("drafter: 'sent' and 'shared' are recognised as sending", () => {
  const [c] = draftClauses("Passwords must never be sent or shared outside the company.");
  assert.deepEqual(c.actions, ["NETWORK_SEND", "DATA_EXPORT"]);
  assert.equal(c.effect, "BLOCK");
  assert.notEqual(c.destinations, "ANY");
});

test("decidedBy names the user's rule when it changes the outcome", () => {
  const before = run("net-code-approved", seed());
  assert.equal(before.decision, "ALLOW");
  const after = run("net-code-approved", withMyRules());
  assert.equal(after.decision, "REVIEW");
  assert.equal(after.decidedBy?.layer, "contract");
  const decided = after.matchedContracts.find((m) => m.clauseId === after.decidedBy?.clauseId);
  assert.equal(decided?.contractName, "My first rules");
  assert.equal(decided?.effect, "REVIEW");
  // every matched rule carries its own effect
  assert.ok(after.matchedContracts.length >= 2);
  assert.ok(after.matchedContracts.every((m) => m.effect));
});

test("pipeline lists every rule checked and marks exactly one as deciding", () => {
  const ev = run("net-code-approved", withMyRules());
  const brain = pipelineFor(scenarioById("net-code-approved")!, ev).find((s) => s.key === "brain")!;
  assert.ok(brain.items && brain.items.length === ev.matchedContracts.length);
  assert.equal(brain.items!.filter((i) => i.decided).length, 1);
  assert.match(brain.items!.find((i) => i.decided)!.text, /source code/i);
});

test("decidedBy: safety kernel, context and default layers", () => {
  assert.equal(run("sk-privkey-exfil", []).decidedBy?.layer, "safety");
  // no contract forbids prod deploys in [] → context engine escalates
  const sc = { ...scenarioById("ctx-del-testdb")!, id: "x", environment: "production" as const, sensitivity: "internal" as const, blast: undefined };
  setSeq(1); setTokenCounter(1);
  assert.equal(runScenario(sc, [], "t").event.decidedBy?.layer, "context");
  assert.equal(run("ep-run-tests", []).decidedBy?.layer, "default");
  assert.equal(run("net-encrypted", seed()).decidedBy?.layer, "uninspectable");
});

test("private-key exfil: company rule decides today, Safety Kernel alone still blocks with zero rules", () => {
  const withRules = run("sk-privkey-exfil", seed());
  assert.equal(withRules.decision, "BLOCK");
  assert.equal(withRules.decidedBy?.layer, "contract"); // "Credentials must never be transmitted externally"
  assert.ok(withRules.safetyRules.some((r) => r.ruleId === "sk-cred-exfil")); // second lock
  const noRules = run("sk-privkey-exfil", []);
  assert.equal(noRules.decision, "BLOCK");
  assert.equal(noRules.decidedBy?.layer, "safety");
  // customer data to an unknown address: no company rule covers it → kernel decides
  assert.equal(run("net-unknown-dest", seed()).decidedBy?.layer, "safety");
});

test("explicit enterprise BLOCK keeps credit over the safety kernel", () => {
  const ev = run("net-cred-approved", seed());
  assert.equal(ev.decision, "BLOCK");
  assert.equal(ev.decidedBy?.layer, "contract");
});

test("shadow what-if does not consume token ids", async () => {
  const { shadowEvaluate } = await import("../src/state/store");
  setTokenCounter(40);
  shadowEvaluate(scenarioById("net-pii-approved")!, seed());
  assert.equal(getTokenCounter(), 40);
});
