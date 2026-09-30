import type { TourCase } from "../types";

// Jordan hands a whole support ticket to the Support Agent. The $1,240 refund
// is over the agent's $20-per-action spending limit, so it parks and goes to
// Sam in Finance; the viewer plays Sam's part and approves it once, the
// decision is recorded under Sam's name, and the job then finishes by itself.
const c: TourCase = {
  id: "refund-task",
  order: 60,
  persona: { userId: "u-jordan", name: "Jordan Lee", role: "Support Lead" },
  title: "Refund waits for Finance",
  goal: "Jordan wants the Support Agent to resolve a refund ticket end to end, without giving it free rein over company money.",
  outcome: "The routine work ran on its own, the $1,240 refund waited for Sam in Finance, and the ticket closed once Sam's yes was on record.",
  start: "tasks",
  poster: 1,
  steps: [
    {
      // The four job cards each have a Start button; the refund job is the third.
      target: { selector: "button", text: "Start", exact: true, nth: 2 },
      action: "click",
      title: "Jordan hands over a ticket",
      body: "Jordan, a support lead, gives refund ticket #4821 to the Support Agent, but not free rein over money. Wrapbox checks each step first; one already waits for approval.",
      say: "Okay, this is Jordan, a support lead, handing refund ticket forty-eight twenty-one to the Support Agent, but not free rein over money. Wrapbox checks every step first, and one is already waiting.",
      waitFor: { selector: ".card", text: "Task envelopes" },
      pad: 10,
    },
    {
      // Starting the job already opens it under "In progress"; the timeline is
      // below, so this step scrolls to it rather than clicking an open tab.
      target: { selector: ".scroll-thin", text: "Refund $1,240" },
      title: "Every step is checked first",
      body: "ALLOW: ran as asked. CONSTRAIN: ran with a change — the AI drafted the reply without seeing the customer's real email or phone. REVIEW: waits for a person.",
      say: "Some steps ran as asked, and one ran with a change: the AI drafted the reply without seeing the customer's real email or phone. One is waiting for a person.",
    },
    {
      target: { selector: ".card .card", text: "Safe Continuation active" },
      title: "Only the refund needs a yes",
      body: "Safe Continuation: only the risky step stops. The refund waits for Sam in Finance; steps that need the refund (the reply, closing the ticket) wait with it.",
      say: "This is Safe Continuation: only the risky step stops. The refund waits for Sam in Finance, and the steps that need it, sending the reply and closing the ticket, wait with it.",
      placement: "top",
    },
    {
      target: { selector: "a", text: "Review Center" },
      action: "click",
      title: "Go where approvals happen",
      body: "The Review Center is where people decide the few actions an agent may not take alone. A request never goes to the person who made it.",
      say: "The Review Center is where people decide the few things an agent can't do alone. And a request never goes to the person who made it.",
      // The page's own promise: every request goes to the right approver, never the requester.
      waitFor: { selector: ".sim-note", text: "never the requester" },
    },
    {
      // The Review Center opens on "Awaiting your decision"; point at the whole
      // request card: who asked / who decides / progress, plus the header's
      // "requester ≠ approver" tag.
      target: { selector: ".rc-bundle .ecard", text: "Finance Controller" },
      title: "Waiting for Sam, not Jordan",
      body: "The request arrives with its context: Jordan asked, Sam in Finance decides, and three of the job's six steps are already done. The requester ≠ approver tag makes the split plain.",
      say: "The request comes with its context: Jordan asked, Sam in Finance decides, and three of the job's six steps are already done. The green tag makes it plain: the requester isn't the approver.",
      pad: 12,
    },
    {
      // The whole request card: what Sam is asked to approve, and why it stopped.
      target: { selector: ".card", text: "exceeds budget" },
      title: "Why the refund stopped",
      body: "The Blast-Radius Governor checks how much one action can affect. An agent may spend up to $20 per action on its own; this refund is $1,240.",
      say: "The Blast Radius Governor checks how much one action can affect. An agent can spend up to twenty dollars per action on its own, and this refund is twelve hundred and forty.",
      placement: "top",
    },
    {
      target: { selector: "button", text: "Approve once" },
      action: "click",
      title: "Approve just this one refund",
      body: "Playing Sam's part, we click Approve once. Only this refund goes ahead, the waiting list empties, and the agent's $20 limit stays as it is.",
      say: "Playing Sam's part, we click Approve once. Only this refund goes ahead, the waiting list empties, and the agent's twenty dollar limit stays just as it is.",
      waitFor: { selector: ".card.empty", text: "Nothing waiting" },
    },
    {
      target: { selector: "[role=tab]", text: "Resolved" },
      action: "click",
      title: "Sam's yes is on record",
      body: "The refund now shows as approved and issued. The record keeps who asked (Jordan Lee), who decided (Sam Rivera) and when.",
      say: "Nice. The refund now shows as approved and issued, and the record keeps it all: Jordan Lee asked, Sam Rivera decided, and when.",
      waitFor: { selector: ".ecard", text: "88142" },
    },
    {
      target: { selector: ".rail-item", text: "Tasks" },
      action: "click",
      title: "The job picks up again",
      body: "Back in Tasks: nothing parked, one job completed. Sam's yes was enough; the agent resumed on its own and nobody had to restart it.",
      say: "Back in Tasks, nothing's parked and one job is completed. Sam's yes was all it took: the agent carried on by itself, and nobody had to restart it.",
      waitFor: { selector: ".card", text: "Task envelopes" },
    },
    {
      target: { selector: "[role=tab]", text: "Finished" },
      action: "click",
      title: "Six steps, all done",
      body: "After Sam's yes, the refund ran, then the agent sent the reply and closed the ticket. Each step's decision, including Sam's approval, stays on record.",
      say: "So all six steps are done. After Sam's yes, the refund ran, the agent sent the reply and closed the ticket, and every decision, Sam's included, stays on record.",
      waitFor: { selector: ".scroll-thin", text: "Close the ticket" },
    },
  ],
};
export default c;
