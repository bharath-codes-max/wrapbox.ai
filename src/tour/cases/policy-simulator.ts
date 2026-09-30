import type { TourCase } from "../types";

// Maya tests a rule change against the company's real history before anyone
// makes it: Maya switches one rule off in the Policy Simulator (a preview only),
// replays recorded actions and the scenario library through the live decision
// engine, sees the one action that would lose its protection, and confirms the
// live rule was never touched.
const c: TourCase = {
  id: "policy-simulator",
  order: 40,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "Test a rule change safely",
  goal: "Engineers have asked to drop the review step when code goes to AI tools the company hasn't approved, and Maya wants to know what that would really change first.",
  outcome: "Maya saw, from the company's own history, the one action that would lose its protection, and the live rules stayed exactly as they were.",
  start: "control",
  poster: 4,
  steps: [
    {
      target: { selector: ".rail-item", text: "Policy Simulator" },
      action: "click",
      title: "Open the Policy Simulator",
      body: "Engineers asked to drop one review step. Maya tests the idea here first: a safe preview where nothing changes the live rules.",
      say: "So, engineers want to drop a review step for code sent to unapproved AI tools. Maya tests the idea here first, in a safe preview that never changes the live rules.",
      waitFor: { selector: ".page-head", text: "Policy Simulator" },
    },
    {
      target: { selector: ".ecard", text: "External AI usage" },
      title: "Today's rules, one tick each",
      body: "Each card is a company policy (a \"contract\"); ticked rules are on. Tags: ALLOW (goes ahead), CONSTRAIN (changed first, e.g. emails masked), REVIEW (a person approves), BLOCK (stopped).",
      say: "Each card is a company policy, and ticked rules are on. The tags say if an action goes ahead, gets changed first, like masking emails, waits for a person, or gets stopped.",
    },
    {
      target: { selector: "label.rule-item", text: "Source code may go to approved AI" },
      action: "click",
      title: "Switch one rule off, in preview",
      body: "This rule lets code go to approved AI tools, but a person must review it before it goes anywhere else. Maya unticks it, only inside this preview.",
      say: "This rule lets code go to approved AI tools, but anywhere else needs a person's review first. Maya unticks it, only inside this preview.",
      waitFor: { selector: ".ecard", text: "3 of 4 on in preview" },
    },
    {
      target: { selector: "[role=tab]", text: "See what would happen" },
      action: "click",
      title: "Replay the company's real history",
      body: "Wrapbox runs the company's 20 recorded actions through its live decision engine twice: once under today's rules, once with Maya's change. Nothing is recorded.",
      say: "Now Wrapbox runs the company's twenty recorded actions through its live decision engine twice, once under today's rules and once with Maya's change. Nothing gets recorded.",
      waitFor: { selector: "button.tab", text: "Your history" },
    },
    {
      target: { selector: ".card", text: "Impact preview" },
      placement: "top",
      title: "One past action would change",
      body: "Left, today's rules: 2 actions held for a person's approval (REVIEW). Right, with the change: one of them would go straight through (ALLOW).",
      say: "On the left, today's rules held two actions for a person's approval. On the right, with the change, one of them would just go straight through.",
    },
    {
      target: { selector: ".card", text: "Heads up" },
      title: "A red flag for weaker protection",
      body: "Wrapbox warns when something protected today would simply be allowed. Built-in Safety Kernel rules, which can't be switched off, would still apply either way.",
      say: "Hmm — Wrapbox warns when something that's protected today would simply be allowed. The built-in Safety Kernel rules can't be switched off, so they'd still apply either way.",
    },
    {
      target: { selector: ".ecard", text: "Sent checkout.ts to FreeAIChat" },
      title: "The exact action at stake",
      body: "Daniel pasted the company's checkout code into FreeAIChat, an unapproved AI tool. Today a person must approve that first; with the change it would go straight out.",
      say: "Daniel pasted the company's checkout code into Free AI Chat, an unapproved AI tool. Today a person has to okay that first, but with the change it would go straight out.",
    },
    {
      target: { selector: "button.tab", text: "Scenario library" },
      action: "click",
      title: "Try situations not seen yet",
      body: "Maya also replays 44 standard situations, including some this company hasn't met yet. Again, only one outcome changes: REVIEW becomes ALLOW.",
      say: "Maya also replays forty-four standard situations, including some this company hasn't run into yet. Again, just one outcome changes: a held action would now go straight through.",
      waitFor: { selector: ".card", text: "1 of 44 outcomes change" },
    },
    {
      target: { selector: "[role=tab]", text: "Make it real" },
      action: "click",
      title: "A preview, never the real thing",
      body: "This page never changes what Wrapbox enforces: the top bar still says 18 rules. Rules are really switched on or off in Intent Studio.",
      say: "To be clear, this page never changes what Wrapbox enforces, and the top bar still says eighteen rules. Rules really get switched on or off in Intent Studio.",
      waitFor: { selector: ".card", text: "Open Intent Studio" },
    },
    {
      target: { selector: "button", text: "Open Intent Studio" },
      action: "click",
      title: "The live rule is untouched",
      body: "In Intent Studio, External AI usage is still ACTIVE (switched on) with all 4 rules (clauses), the REVIEW one included. Maya's test changed nothing live.",
      say: "Nice. In Intent Studio, External AI usage is still on with all four rules, review step included. Maya saw the one action that would lose protection, and nothing live changed.",
      waitFor: { selector: ".ecard", text: "External AI usage" },
    },
  ],
};
export default c;
