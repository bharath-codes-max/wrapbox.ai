import type { TourCase } from "../types";

// Jordan's Support Agent refunds $18 (Stripe's answer is sealed at the
// gateway), then tells the customer $180. The output check holds the wrong
// reply with both values shown; the correct reply goes straight out.
const c: TourCase = {
  id: "output-check",
  order: 61,
  persona: { userId: "u-jordan", name: "Jordan Lee", role: "Support Lead" },
  title: "Catch an agent misreporting",
  goal: "Jordan's Support Agent issues refunds and then tells customers what happened. What it says has to match what Stripe actually did.",
  outcome: "The $18 refund ran and Stripe's answer was sealed; the reply claiming $180 was held with the exact mismatch, and the correct reply went straight out.",
  start: "simlab/agentic",
  poster: 3,
  steps: [
    {
      target: { selector: ".stream-item", text: "Support Agent refunds $18" },
      action: "click",
      title: "A small refund",
      body: "The Support Agent refunds $18.00 on order 77310 — inside its $20 per-action limit.",
      say: "Okay, the Support Agent refunds eighteen dollars on order seventy-seven three ten, inside its twenty dollar limit.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Stripe's answer is sealed",
      body: "Allowed — and Stripe's answer is sealed at the gateway: refund amount $18.00, with its own seal, ready to check anything said about it later.",
      say: "Allowed, and Stripe's answer gets sealed at the gateway: a refund of eighteen dollars, with its own seal, ready to check anything said about it later.",
      waitFor: { selector: ".pipe-stage", text: "result sealed" },
      hold: 1800,
    },
    {
      target: { selector: ".stream-item", text: "Agent tells the customer a different amount" },
      action: "click",
      title: "The agent writes to the customer",
      body: "Now the agent writes to the customer: “we've refunded $180.00”.",
      say: "Now the agent writes to the customer: we've refunded a hundred and eighty dollars.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Held: it doesn't match",
      body: "Held for review: the claim doesn't match Stripe's sealed result, and the safe fix is spelled out — correct it to $18.00.",
      say: "Held for review. The claim doesn't match Stripe's sealed result, and the safe fix is spelled out: correct it to eighteen dollars.",
      waitFor: { selector: ".aterm-line", text: "Decision REVIEW" },
      hold: 1600,
    },
    {
      target: { selector: ".pipe-stage", text: "Output check: MISMATCH" },
      title: "Both sides, side by side",
      body: "The output check shows both: the agent says $180.00, Stripe sealed $18.00.",
      say: "The output check shows both sides: the agent says one eighty, Stripe sealed eighteen.",
    },
    {
      target: { selector: ".stream-item", text: "Agent tells the customer the right amount" },
      action: "click",
      title: "The corrected reply",
      body: "The same reply, with the amount Stripe actually refunded.",
      say: "Here's the same reply, with the amount Stripe actually refunded.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "It matches, so it goes",
      body: "Allowed straight out: the claim matches the sealed result.",
      say: "And it goes straight out, because the claim matches the sealed result.",
      waitFor: { selector: ".aterm-line", text: "Decision ALLOW" },
      hold: 1400,
    },
    {
      target: { selector: ".rail-item", text: "Review Center" },
      action: "click",
      title: "The wrong reply waits",
      body: "The $180 reply waits in the Review Center for Alex Morgan — never for Jordan, who asked — with the mismatch as its reason.",
      say: "The one-eighty reply waits in the Review Center for Alex Morgan, never for Jordan, who asked, with the mismatch as its reason.",
      waitFor: { selector: ".rc-bundle .ecard", text: "reply" },
      pad: 10,
    },
  ],
};
export default c;
