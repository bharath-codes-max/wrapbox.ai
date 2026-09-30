import type { TourCase } from "../types";

// Sam hands the Q3 revenue report to the finance agent. The routine steps run
// on their own; the bulk customer export parks for Maya, who steers it to the
// safer version, and the job finishes by itself with a record of Maya's decision.
const c: TourCase = {
  id: "finance-report",
  order: 62,
  persona: { userId: "u-sam", name: "Sam Rivera", role: "Finance Controller" },
  title: "Build a report, safely",
  goal: "Sam needs the Q3 revenue report and wants the finance agent to build it without free rein over customer data.",
  outcome: "The routine steps ran on their own, the one risky export waited for Maya, and the job finished using the safer version Maya chose, with a record of who decided.",
  start: "tasks",
  poster: 2,
  steps: [
    {
      target: { selector: ".ecard", text: "Prepare the Q3 revenue report" },
      title: "A job with a permission slip",
      body: "Sam asks the finance agent for the Q3 revenue report. The job comes with limits, and a named approver for anything risky: Maya, not Sam.",
      say: "Sam needs the third-quarter revenue report and asks the finance agent to build it. The job comes with limits, and anything risky goes to a named approver: Maya, not Sam.",
    },
    {
      // The second "Start" on the page belongs to the Finance card.
      target: { selector: "button", text: "Start", exact: true, nth: 1 },
      action: "click",
      title: "Start the job, inside its limits",
      // The engine holds forbidden scope for approval (REVIEW); stricter layers may still block,
      // so the caption states the yes as necessary, not sufficient.
      body: "Sam presses Start. The agent may read customer data and write and send the report. Passwords, secret files and the payments database are off-limits without a person's yes.",
      say: "Sam presses Start. The agent can read customer data, and write and send the report, but passwords, secret files and the payments database are off-limits without a person's yes.",
      waitFor: { selector: ".grid.g2", text: "Forbidden" },
    },
    {
      target: ".scroll-thin",
      title: "Routine steps ran on their own",
      body: "Wrapbox checked each step just before it ran. Four got ALLOW, cleared to run with no one's approval: both revenue queries, the charts and the summary.",
      say: "Okay, Wrapbox checked each step just before it ran. Four were cleared to run with no one's approval: both revenue queries, the charts and the summary.",
    },
    {
      target: { selector: ".card .card", text: "Safe Continuation active" },
      title: "One step is paused",
      body: "The customer export got REVIEW: held until a person decides. Safe Continuation means the rest kept going; only sending the report to the CFO waits for it.",
      say: "The customer export, though, is held until a person decides. That's Safe Continuation: the rest kept going, and only sending the report to the CFO waits for it.",
      // Above the card, so step 4's REVIEW / PARKED chips in the timeline stay visible.
      placement: "top",
    },
    {
      target: { selector: "a", text: "Review Center" },
      action: "click",
      title: "It goes to Maya, not Sam",
      body: "The request lands in the Review Center for Maya, the security analyst. The person who asked can never approve their own request.",
      say: "The request lands in the Review Center for Maya, the security analyst. Remember, the person who asked can never approve their own request.",
      waitFor: { selector: ".ecard-fields", text: "Decides" },
    },
    {
      target: { selector: ".card", text: "Safer alternative" },
      title: "Why it was held",
      body: "A company rule says bulk customer exports need a security review, and this one is 50,000 rows. The safer option: a summary, or 500 rows at most.",
      say: "A company rule says bulk customer exports need a security review, and this one is fifty thousand rows. The safer option is a summary, or five hundred rows at most.",
    },
    {
      target: { selector: "button", text: "Constrain" },
      action: "click",
      title: "Maya picks the safer version",
      body: "Not just yes or no: Maya picks Constrain, meaning the export may run, but only in the safer form. Nothing is left waiting for a decision.",
      say: "And it isn't just yes or no. Maya picks Constrain, meaning the export can run, but only in the safer form, and nothing's left waiting.",
      waitFor: { selector: ".card", text: "Nothing waiting" },
    },
    {
      target: { selector: ".rail-item", text: "Tasks" },
      action: "click",
      title: "The job carried on by itself",
      body: "Back in Tasks, nothing is parked and one job is completed. Maya's decision resumed it automatically; nobody had to press Start again.",
      say: "Nice. Back in Tasks, nothing's parked and one job is completed. Maya's decision got it moving again automatically, so nobody had to press Start again.",
      waitFor: { selector: ".card", text: "Completed" },
    },
    {
      target: { selector: ".tab", text: "Finished" },
      action: "click",
      title: "The report is finished",
      body: "All six steps show done, and the report went to the CFO. Step 4 keeps its REVIEW tag as a reminder it was held. The job reads COMPLETED.",
      say: "All six steps show done, and the report went to the CFO. Step four still carries its review tag, a reminder it was held, and the job reads completed.",
      waitFor: ".scroll-thin",
    },
    {
      target: { within: ".scroll-thin", selector: "div", text: "Export every customer" },
      action: "click",
      title: "A record of who decided",
      // Lands on the last lines of the evidence chain, where the record itself states the rule that
      // decided, who decided ("Review: constrained by Maya Chen") and what ran ("Outcome: Constrained
      // alternative executed"). The spotlight sits on the Outcome line so the Review line above stays clear.
      body: "Clicking the export step opens its record: held by the company rule, then constrained by Maya Chen. Only the safer version ran; the full 50,000-row export never did.",
      say: "So clicking the export step opens its record: held by the company rule, then Maya Chen chose the safer version. Only that version ran, and the full fifty-thousand-row export never did.",
      waitFor: { within: ".drawer", selector: ".pipe-stage", text: "Constrained alternative executed" },
    },
  ],
};
export default c;
