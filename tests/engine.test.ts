// Engine outcome tests (§59) — the brain must produce the blueprint outcomes
// deterministically, and policy changes must change outcomes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { SCENARIOS, scenarioById } from "../src/engine/scenarios";
import { runScenario, setSeq, setTokenCounter } from "../src/engine/simulate";
import type { IntentContract } from "../src/model/types";

function run(id: string, contracts = SEED_CONTRACTS as IntentContract[]) {
  setSeq(1000);
  setTokenCounter(100);
  const sc = scenarioById(id);
  assert.ok(sc, `scenario ${id} exists`);
  return runScenario(sc!, contracts, "test0");
}

test("ALLOW: source code to approved AI", () => {
  assert.equal(run("net-code-approved").event.decision, "ALLOW");
});

test("CONSTRAIN: customer PII to approved AI is reversibly tokenized", () => {
  const { event, tokens } = run("net-pii-approved");
  assert.equal(event.decision, "CONSTRAIN");
  assert.ok(event.transformation && event.transformation.length >= 6, "emails+phones tokenized");
  assert.ok(event.payloadAfter && !event.payloadAfter.includes("alice@example.com"), "original email not in outbound payload");
  assert.ok(event.payloadAfter!.includes("EMAIL_TOKEN_"), "token present in outbound payload");
  assert.ok(event.payloadAfter!.includes("Alice Johnson"), "non-tokenized fields preserved");
  assert.ok(tokens.length >= 6, "vault tokens created");
  assert.ok(tokens.every((t) => t.restorable), "tokens restorable");
});

test("BLOCK: credential to approved AI blocked before transmission", () => {
  const { event } = run("net-cred-approved");
  assert.equal(event.decision, "BLOCK");
  assert.equal(event.payloadAfter, undefined, "nothing left the device");
});

test("REVIEW: source code to unapproved external", () => {
  const { event } = run("net-code-unapproved");
  assert.equal(event.decision, "REVIEW");
  assert.equal(event.reviewState?.status, "pending");
});

test("UNINSPECTABLE encrypted file fails closed, never clean", () => {
  const { event } = run("net-encrypted");
  assert.equal(event.decision, "BLOCK");
  assert.equal(event.capabilityState, "UNINSPECTABLE");
  assert.match(event.decisionReasons.join(" "), /UNINSPECTABLE/);
});

test("Unknown destination with sensitive data does not become trusted", () => {
  const { event } = run("net-unknown-dest");
  assert.equal(event.decision, "BLOCK");
  assert.ok(event.safetyRules.some((s) => s.ruleId === "sk-unknown-highrisk"));
});

test("ENDPOINT: read source ALLOW, read .env BLOCK, tests ALLOW, temp delete ALLOW", () => {
  assert.equal(run("ep-read-src").event.decision, "ALLOW");
  assert.equal(run("ep-read-env").event.decision, "BLOCK");
  assert.equal(run("ep-run-tests").event.decision, "ALLOW");
  assert.equal(run("ep-del-tmp").event.decision, "ALLOW");
});

test("ENDPOINT: destructive production-like action blocked; security change blocked", () => {
  assert.equal(run("ep-del-proddb").event.decision, "BLOCK");
  assert.equal(run("ep-security-change").event.decision, "BLOCK");
});

test("GATEWAY: feature push ALLOW; force-push main REVIEW; select 50 ALLOW", () => {
  assert.equal(run("gw-push-feature").event.decision, "ALLOW");
  assert.equal(run("gw-force-main").event.decision, "REVIEW");
  assert.equal(run("gw-select-50").event.decision, "ALLOW");
});

test("GATEWAY: 500k export blocked (mass export); DROP TABLE prod blocked; IAM admin escalated", () => {
  assert.equal(run("gw-export-500k").event.decision, "BLOCK");
  assert.equal(run("gw-drop-table").event.decision, "BLOCK");
  const iam = run("gw-iam-admin").event.decision;
  assert.ok(iam === "BLOCK" || iam === "REVIEW", `IAM change escalated (got ${iam})`);
});

test("CONTEXT: same DELETE verb — test db ALLOW, production db BLOCK", () => {
  assert.equal(run("ctx-del-testdb").event.decision, "ALLOW");
  assert.equal(run("ctx-del-proddb").event.decision, "BLOCK");
});

test("SAFETY KERNEL: private key exfiltration blocked with zero contracts", () => {
  const { event } = runNoContracts("sk-privkey-exfil");
  assert.equal(event.decision, "BLOCK");
  assert.ok(event.safetyRules.some((s) => s.ruleId === "sk-cred-exfil"));
});

function runNoContracts(id: string) {
  setSeq(2000);
  setTokenCounter(200);
  return runScenario(scenarioById(id)!, [], "test0");
}

test("POLICY CHANGE changes outcome: deactivating credential clause still blocked by Safety Kernel; deactivating PII clause allows plain send", () => {
  // Remove the PII tokenization clause → PII send becomes ALLOW (approved AI is permitted).
  const modified = structuredClone(SEED_CONTRACTS) as IntentContract[];
  const ai = modified.find((c) => c.id === "ic-external-ai")!;
  ai.clauses = ai.clauses.filter((cl) => cl.id !== "cl-ai-2");
  const { event } = run("net-pii-approved", modified);
  assert.equal(event.decision, "ALLOW", "removing the clause changes CONSTRAIN → ALLOW");
  // Credentials remain blocked even without the contract clause (Safety Kernel).
  const mod2 = structuredClone(SEED_CONTRACTS) as IntentContract[];
  const ai2 = mod2.find((c) => c.id === "ic-external-ai")!;
  ai2.clauses = ai2.clauses.filter((cl) => cl.id !== "cl-ai-3");
  const cred = run("net-cred-approved", mod2);
  assert.equal(cred.event.decision, "BLOCK", "Safety Kernel still blocks credential exfiltration");
});

test("Evidence: every event carries a causal chain and chained hash", () => {
  for (const sc of SCENARIOS) {
    setSeq(3000);
    setTokenCounter(300);
    const { event } = runScenario(sc, SEED_CONTRACTS as IntentContract[], "prevX");
    assert.ok(event.evidence.chain.length >= 4, `${sc.id} has causal chain`);
    assert.equal(event.evidence.prevHash, "prevX");
    assert.ok(event.evidence.hash.length === 8);
    assert.ok(event.decisionReasons.length > 0, `${sc.id} has explainable reasons`);
  }
});

test("Blast radius threshold changes authorization (26th file)", async () => {
  const { decide } = await import("../src/engine/brain");
  const base = {
    plane: "ENDPOINT" as const, action: "WRITE" as const, agent: "a-claude-code",
    user: "u-daniel", resource: "src/big-refactor", environment: "development" as const,
    context: { environment: "development" as const, resourceSensitivity: "internal" as const, privileged: false, businessHours: true },
  };
  const under = decide({ ...base, blastRadius: { files: 25, label: "25 files", severity: "low" } }, SEED_CONTRACTS as IntentContract[]);
  const over = decide({ ...base, blastRadius: { files: 26, label: "26 files", severity: "moderate" } }, SEED_CONTRACTS as IntentContract[]);
  assert.equal(under.decision, "ALLOW");
  assert.equal(over.decision, "REVIEW");
});
