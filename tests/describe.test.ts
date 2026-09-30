// Plain-language sentences and user/device identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_CONTRACTS } from "../src/model/contracts";
import { scenarioById } from "../src/engine/scenarios";
import { runScenario, setSeq, setTokenCounter } from "../src/engine/simulate";
import { describe } from "../src/ui/describe";
import { deviceById } from "../src/model/org";
import type { IntentContract, SimulationEvent } from "../src/model/types";

function ev(id: string): SimulationEvent {
  setSeq(7000);
  setTokenCounter(700);
  return runScenario(scenarioById(id)!, SEED_CONTRACTS as IntentContract[], "t").event;
}

test("sentences read like a person wrote them, tense follows the outcome", () => {
  assert.equal(describe(ev("net-code-approved")), "Sent checkout.ts to Claude");
  assert.equal(describe(ev("net-cred-approved")), "Tried to send config.yaml to Claude");
  assert.equal(describe(ev("net-code-unapproved")), "Waiting for approval to send checkout.ts to FreeAIChat");
  assert.equal(describe(ev("net-pii-approved")), "Sent customers.csv to Enterprise AI — private data hidden");
  assert.equal(describe(ev("ep-read-env")), "Tried to open the secrets file .env");
  assert.equal(describe(ev("ep-run-tests")), "Ran npm test");
  assert.equal(describe(ev("gw-force-main")), "Waiting for approval to force-push to checkout-service");
  assert.equal(describe(ev("gw-select-50")), "Queried 50 rows from customer-db");
  assert.equal(describe(ev("gw-drop-table")), "Tried to delete payments-prod (8,421,392 rows)");
  assert.equal(describe(ev("sk-privkey-exfil")), "Tried to send ~/.ssh/id_rsa to an unknown address (185.220.101.42)");
});

test("after a human decides, the sentence follows the human outcome", () => {
  const approved = { ...ev("net-code-unapproved"), status: "completed" as const };
  assert.equal(describe(approved), "Sent checkout.ts to FreeAIChat");
  const denied = { ...ev("net-code-unapproved"), status: "blocked" as const };
  assert.match(describe(denied), /^Tried to send/);
});

test("an action happens on the person's own laptop, not the agent's", () => {
  const e = ev("net-code-approved"); // Daniel using Claude (Claude is registered on Maya's laptop)
  assert.equal(e.user, "u-daniel");
  assert.equal(deviceById(e.device)?.name, "Daniel-MBP");
});
