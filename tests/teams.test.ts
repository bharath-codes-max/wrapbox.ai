// Four teams, four agents, four permission slips — each risky step goes to
// the right approver, never the requester.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_JOBS } from "../src/engine/scenarios";

async function run(jobId: string) {
  const store = await import("../src/state/store");
  store.resetDemoData();
  const t = store.startTask(jobId);
  store.advanceTask(t.taskId);
  const task = () => store.getState().tasks.find((x) => x.taskId === t.taskId)!;
  const ev = (i: number) => store.getState().events.find((e) => e.id === task().steps[i].eventId)!;
  return { store, task, ev };
}

test("every job's approver is a different person from the one who asked", () => {
  for (const j of TASK_JOBS) assert.notEqual(j.approver, j.user, j.title);
});

test("Finance · Q3 report: the 50,000-row customer export parks for Security; sending waits for it", async () => {
  const { store, task, ev } = await run("job-fin-q3");
  assert.deepEqual(task().steps.map((s) => s.state).slice(0, 3), ["done", "done", "done"]);
  assert.equal(task().steps[3].state, "parked");
  assert.match(ev(3).decidedBy!.label, /Bulk export of customer records requires security review/);
  assert.equal(store.approverFor(ev(3)), "u-maya");
  assert.equal(task().steps[5].state, "waiting_dependency");
  store.resolveReview(ev(3).id, "approved", store.approverFor(ev(3)));
  assert.equal(task().status, "completed");
  assert.equal(ev(3).reviewState!.reviewer, "u-maya");
});

test("Support · refund: AI draft is tokenized, the $1,240 refund parks for Finance, then the ticket closes", async () => {
  const { store, task, ev } = await run("job-sup-refund");
  const draft = ev(2);
  assert.equal(draft.decision, "CONSTRAIN");
  assert.ok(draft.payloadAfter && !draft.payloadAfter.includes("alice@example.com"));
  assert.ok(store.getState().tokens.some((t) => t.eventId === ev(2).id), "tokens from the task reach the vault");
  assert.equal(task().steps[3].state, "parked");
  assert.equal(store.approverFor(ev(3)), "u-sam");
  assert.equal(task().steps[4].state, "waiting_dependency");
  store.resolveReview(ev(3).id, "approved", "u-sam");
  assert.equal(task().steps[5].state, "done");
  assert.equal(task().status, "completed");
});

test("Operations · outage: staging restart runs, production restart parks, admin rights are blocked", async () => {
  const { store, task, ev } = await run("job-ops-staging");
  assert.equal(task().steps[1].state, "done"); // restart staging — inside the slip
  assert.equal(task().steps[2].state, "parked"); // restart production — outside the slip
  assert.equal(ev(2).decidedBy?.layer, "envelope");
  assert.equal(task().steps[3].state, "blocked"); // admin rights — Safety Kernel
  assert.equal(ev(3).decidedBy?.layer, "safety");
  store.resolveReview(ev(2).id, "approved_scoped", store.approverFor(ev(2)));
  assert.equal(task().steps[4].state, "done"); // prod health check covered by the scoped grant
  assert.equal(task().status, "stopped"); // shown as PARTLY DONE: the admin-rights step stayed blocked
});

test("busy morning: all four teams run side by side, each parked on its own approver", async () => {
  const store = await import("../src/state/store");
  store.resetDemoData();
  for (const j of TASK_JOBS) { const t = store.startTask(j.id); store.advanceTask(t.taskId); }
  const pending = store.getState().events.filter((e) => e.reviewState?.status === "pending");
  const approvers = new Set(pending.map((e) => store.approverFor(e)));
  assert.equal(store.getState().tasks.length, 4);
  assert.ok(approvers.has("u-alex") && approvers.has("u-maya") && approvers.has("u-sam"));
  store.resetDemoData();
});
