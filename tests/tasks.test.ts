// Task Envelope is really enforced; park / resume; once vs scoped vs deny.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/engine/brain";
import { SEED_CONTRACTS } from "../src/model/contracts";
import type { IntentContract, TaskEnvelope } from "../src/model/types";

async function freshTask() {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const t = store.startTask();
  store.advanceTask(t.taskId);
  const task = () => store.getState().tasks.find((x) => x.taskId === t.taskId)!;
  const eventOf = (i: number) => store.getState().events.find((e) => e.id === task().steps[i].eventId)!;
  return { store, task, eventOf };
}

test("start: production deploy (step 6) parks; independent steps finish; step 10 waits", async () => {
  const { task } = await freshTask();
  const st = task().steps.map((s) => s.state);
  assert.equal(st[5], "parked");
  assert.deepEqual([st[6], st[7], st[8]], ["done", "done", "done"]);
  assert.equal(st[9], "waiting_dependency");
  assert.equal(task().status, "parked");
});

test("Approve once: only the deploy is allowed — the production health check parks for its own review", async () => {
  const { store, task, eventOf } = await freshTask();
  store.resolveReview(eventOf(5).id, "approved", "u-alex");
  assert.equal(task().steps[5].state, "done");
  assert.equal(task().steps[9].state, "parked");
  assert.equal(eventOf(9).decidedBy?.layer, "envelope"); // production is outside the envelope
  assert.equal(task().status, "parked");
});

test("Approve scoped: the task may use production for the rest of the job — health check runs, task completes", async () => {
  const { store, task, eventOf } = await freshTask();
  store.resolveReview(eventOf(5).id, "approved_scoped", "u-alex");
  assert.equal(task().grants?.[0]?.environment, "production");
  assert.equal(task().steps[9].state, "done");
  assert.equal(eventOf(9).decision, "ALLOW");
  assert.equal(task().status, "completed");
  assert.match(eventOf(5).reviewState!.scope!, /This task may use/);
});

test("Deny: the deploy stays blocked, the step that needed it is skipped, task is stopped", async () => {
  const { store, task, eventOf } = await freshTask();
  store.resolveReview(eventOf(5).id, "denied", "u-alex");
  assert.equal(task().steps[5].state, "blocked");
  assert.equal(task().steps[9].state, "skipped");
  assert.equal(task().status, "stopped");
});

test("the envelope is enforced by the brain: outside scope, forbidden, file budget, expiry", () => {
  const cs = structuredClone(SEED_CONTRACTS) as IntentContract[];
  const now = Date.UTC(2026, 8, 24, 12);
  const env: TaskEnvelope = {
    taskId: "t", title: "Fix checkout", agent: "a-claude-code", user: "u-daniel",
    allowedResources: ["src/"], allowedActions: ["READ", "WRITE"], environment: "development",
    forbidden: ["production", ".env"], durationMin: 30, startedAt: now, fileBudget: 2, filesUsed: 0,
    status: "active", steps: [],
  };
  const base = {
    plane: "ENDPOINT" as const, agent: "a-claude-code", user: "u-daniel", environment: "development" as const,
    context: { environment: "development" as const, resourceSensitivity: "internal" as const, privileged: false, businessHours: true },
    envelope: env, now,
  };
  assert.equal(decide({ ...base, action: "READ", resource: "src/app.ts" }, cs).decision, "ALLOW");
  assert.equal(decide({ ...base, action: "READ", resource: "billing/app.ts" }, cs).decision, "REVIEW"); // outside scope
  assert.equal(decide({ ...base, action: "READ", resource: ".env" }, cs).decidedBy.layer, "envelope"); // forbidden
  assert.equal(decide({ ...base, action: "WRITE", resource: "src/a.ts", envelope: { ...env, filesUsed: 2 } }, cs).decision, "REVIEW"); // budget
  assert.equal(decide({ ...base, action: "READ", resource: "src/app.ts", now: now + 31 * 60_000 }, cs).decision, "REVIEW"); // expired
  const granted = { ...env, grants: [{ resource: "r-aws-prod", environment: "production" as const, grantedBy: "u-alex", at: now }] };
  assert.equal(decide({ ...base, action: "READ", resource: "r-aws-prod", environment: "production", envelope: granted }, cs).decision, "ALLOW");
});
