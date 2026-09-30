import type { TourCase } from "../types";

// Maya stops Claude Code everywhere in one step. Before the story starts
// (setup) the agent has a force-push to main waiting for review; stopping it
// cancels that request, and its next ordinary action is refused by the kill
// switch — the first check in decide(), ahead of every rule.
const c: TourCase = {
  id: "kill-switch",
  order: 92,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "Stop an agent everywhere",
  goal: "Claude Code is behaving oddly and Maya needs it stopped on every system at once — not one permission at a time — while she investigates.",
  outcome: "One step stopped Claude Code everywhere: its held request was cancelled, its next action was refused, and the stop is on record with Maya's name and reason.",
  start: "control",
  setup: ["simulate:gw-force-main"],
  poster: 5,
  steps: [
    {
      target: { selector: ".rail-item", text: "Agents" },
      action: "click",
      title: "Open the agent list",
      body: "Claude Code has a force-push to main waiting for review, and Maya wants the agent stopped while she looks into it. She opens Agents.",
      say: "Okay, Claude Code has a force-push to main waiting for review, and Maya wants the agent stopped while she looks into it. She opens Agents.",
      waitFor: { selector: ".card", text: "Agents detected" },
    },
    {
      target: { selector: ".ecard", text: "Claude Code" },
      action: "click",
      title: "The kill switch sits on the agent",
      body: "Claude Code's card opens with the kill switch at the top: one step that stops this agent on every plane at once.",
      say: "Claude Code's card opens with the kill switch right at the top: one step that stops this agent on every plane at once.",
      waitFor: { within: ".drawer", selector: ".killswitch" },
    },
    {
      target: { within: ".drawer", selector: "button", text: "Stop this agent everywhere" },
      action: "click",
      title: "See what a stop will do",
      body: "Wrapbox spells it out first: the one held request will be cancelled, and every action is refused on the laptop, network, gateways, browser and hosted planes.",
      say: "Before anything happens, Wrapbox spells it out: the one held request gets cancelled, and every action is refused on the laptop, network, gateways, browser and hosted planes.",
      waitFor: { within: ".drawer", selector: "input", text: "Reason for stopping" },
    },
    {
      target: { within: ".drawer", selector: "input", text: "Reason for stopping" },
      action: "type",
      text: "Odd pushes to main after reading an outside issue",
      title: "Say why",
      body: "Maya types the reason. It goes on the record, next to her name.",
      say: "Maya types the reason, and it goes on the record next to her name.",
    },
    {
      target: { within: ".drawer", selector: "select", text: "Stopped by" },
      action: "select",
      value: "u-maya",
      title: "Record who stopped it",
      body: "She records herself as the person stopping it.",
      say: "She records herself as the person stopping it.",
    },
    {
      target: { within: ".drawer", selector: "button", text: "Stop everywhere", exact: true },
      action: "click",
      title: "Stopped everywhere",
      body: "Claude Code is stopped. Nothing lifts this — not an approval, not break-glass — until a person resumes it.",
      say: "And it's stopped. Nothing lifts this, not an approval and not break-glass, until a person resumes it.",
      waitFor: { within: ".drawer", selector: ".killswitch", text: "Stopped everywhere" },
    },
    {
      target: { selector: ".rail-item", text: "Review Center" },
      action: "click",
      title: "The held request is cancelled",
      body: "The force-push that was waiting is gone from the queue: cancelled, never run, with the stop written into its record.",
      say: "Over in the Review Center, the force-push that was waiting is gone: cancelled, never run, with the stop written into its record.",
      waitFor: { selector: ".card.empty", text: "Nothing waiting" },
    },
    {
      target: { selector: ".rail-item", text: "Simulation Lab" },
      action: "click",
      title: "Now try something ordinary",
      body: "To prove it, Maya asks Claude Code for something routine in the Simulation Lab.",
      say: "To prove it, Maya asks Claude Code for something routine in the Simulation Lab.",
      waitFor: { selector: "[role=tab]", text: "Endpoint" },
    },
    {
      target: { selector: "[role=tab]", text: "Endpoint" },
      action: "click",
      title: "Even a test run",
      body: "Running tests is normally allowed. The forecast now says BLOCK — changed because the agent is stopped.",
      say: "Running tests is normally allowed, but the forecast now says block, changed because the agent is stopped.",
      waitFor: { selector: ".stream-item", text: "Agent runs tests" },
    },
    {
      target: { selector: ".stream-item", text: "Agent runs tests" },
      action: "click",
      title: "Pick the test run",
      body: "Maya picks “Agent runs tests”: npm test in the checkout service.",
      say: "Maya picks the test run: npm test in the checkout service.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Refused before it runs",
      body: "Blocked before it runs, decided by the kill switch — checked before any rule, on every plane.",
      say: "Blocked before it runs, and decided by the kill switch, which is checked before any rule, on every plane.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 2400,
    },
  ],
};
export default c;
