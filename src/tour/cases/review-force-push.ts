import type { TourCase } from "../types";

// Alex decides on a held action in the Review Center. Just before the story
// starts (setup), Daniel's coding agent asked to force-push over main in
// production; the company's Engineering guardrails rule sent it to REVIEW.
// Alex reads who asked, why it was held, what it would touch and the safer
// route (a code write, so: feature branch + pull request), then denies it. The
// product records the denial: the request moves to Resolved, and its record
// ends "denied by Alex Morgan" / "Action remained blocked".
const c: TourCase = {
  id: "review-force-push",
  order: 50,
  persona: { userId: "u-alex", name: "Alex Morgan", role: "Engineering Manager" },
  title: "Decide on a risky push",
  goal: "Moments ago, Daniel's coding agent tried to overwrite main, the team's primary copy of the code (a \"force-push\"), and Wrapbox held it for a person to decide.",
  outcome: "Alex saw the full picture and denied the push. It never ran, and the record shows who asked, which rule held it and who decided.",
  start: "control",
  setup: ["simulate:gw-force-main"],
  // The poster is captured after its step's action: the review outcome, the rule
  // that decided and the start of the evidence record tell the story in one frame.
  poster: 8,
  steps: [
    {
      target: { selector: ".rail-item", text: "Review Center" },
      action: "click",
      title: "Open the Review Center",
      body: "Moments ago, Daniel's coding agent tried to overwrite main, the team's primary copy of the code (a \"force-push\"). Wrapbox held it, so Alex opens the Review Center.",
      say: "Okay, moments ago Daniel's coding agent tried a force-push, overwriting main, the team's primary copy of the code. Wrapbox held it, so Alex opens the Review Center.",
      // The whole request card (what, who asked, who decides): the caption sits above it.
      waitFor: { selector: ".rc-bundle .ecard", text: "force-push" },
    },
    {
      // The whole request card, so the header's expiry and "requester ≠ approver" tags are in view.
      target: { selector: ".rc-bundle .ecard", text: "force-push" },
      title: "Who asked, and who decides",
      body: "Daniel asked, through Claude Code; Alex, the engineering manager, decides before the request expires. The green requester ≠ approver tag is separation of duties, and Wrapbox enforces it.",
      say: "Daniel asked, through the Claude Code agent, and Alex, the engineering manager, decides before the request expires. See the green tag, requester is not the approver: Wrapbox enforces that, so nobody can approve their own request.",
    },
    {
      target: { selector: ".card .spread", text: "git push --force origin main" },
      title: "What the agent tried to run",
      body: "Wrapbox shows the exact command: a force-push to main of the checkout service, in production (the live system). REVIEW means it waits for a person's yes or no.",
      say: "Here's the exact command: a force-push to main of the checkout service, in production, the live system. So it's waiting on a person's yes or no.",
      placement: "top",
    },
    {
      target: { selector: ".grid.g3 > div", text: "Why" },
      title: "Why Wrapbox held it",
      body: "The company's own rule, from its Engineering guardrails: force pushes to main require engineering review. Wrapbox quotes the exact rule, so nobody has to guess.",
      say: "It was held by the company's own rule, from its Engineering guardrails: force pushes to main need engineering review. Wrapbox quotes that exact rule, so nobody has to guess.",
      placement: "top",
    },
    {
      target: { selector: ".grid.g3 > div", text: "Blast radius" },
      title: "What it would affect",
      body: "Blast radius means how much it would touch: 14 saved changes (commits) rewritten on main, a locked-down (\"protected\") branch, across 31 files. Teammates' work could be lost.",
      say: "Hmm — this is the blast radius, how much it would touch: fourteen saved changes rewritten on main, a locked-down branch, across thirty-one files. Teammates' work could be lost.",
      placement: "top",
    },
    {
      target: { selector: ".grid.g3 > div", text: "Safer alternative" },
      title: "A safer way to get there",
      body: "Because this is code, Wrapbox suggests putting the change on a separate copy (a branch) and opening a pull request, so teammates check it before it reaches main.",
      say: "Since this is code, Wrapbox suggests a safer way: put the change on a separate branch and open a pull request, so teammates check it before it reaches main.",
      placement: "top",
    },
    {
      target: { selector: "button", text: "Deny", exact: true },
      action: "click",
      title: "Alex denies the push",
      body: "Alex could approve it, approve it with limits, or steer it to the safer route. Rewriting main is too risky: Alex denies it, and nothing is left waiting.",
      say: "Alex could approve it, approve it with limits, or steer it to the safer route. But rewriting main is too risky, so Alex denies it, and nothing's left waiting.",
      placement: "top",
      waitFor: { selector: ".card.empty", text: "Nothing waiting" },
    },
    {
      target: { selector: "[role=tab]", text: "Resolved" },
      action: "click",
      title: "The decision is on record",
      body: "Under Resolved, the request now shows denied, with who asked, who decided and when. An earlier attempt, just below, was denied too.",
      say: "Yeah, under Resolved it now shows as denied, with who asked, who decided and when. And an earlier attempt, just below, was denied too.",
      waitFor: { selector: ".ecard", text: "Tried to force-push" },
    },
    {
      target: { selector: ".ecard", text: "Tried to force-push" },
      action: "click",
      title: "Open the full record",
      body: "Alex opens the full record. It shows the outcome (denied), who reviewed it, and, just below, the exact rule that held the push.",
      say: "Alex opens the full record. It shows the outcome, denied, who reviewed it, and just below, the exact rule that held the push.",
      waitFor: { within: ".drawer", selector: "dl.kv", text: "Reviewer" },
    },
    {
      target: { within: ".drawer", selector: ".pipe-stage", text: "Action remained blocked" },
      title: "The push never ran",
      body: "The record ends with the review, denied by Alex Morgan, and the outcome: the action remained blocked. Main was never rewritten.",
      say: "The record ends with the review, denied by Alex Morgan, and the outcome: the action stayed blocked. The push never ran, and main was never rewritten.",
      pad: 10,
    },
  ],
};
export default c;
