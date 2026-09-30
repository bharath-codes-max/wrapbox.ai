import type { TourCase } from "../types";

// Daniel opens Core Brain to see how every decision is made: the checks and their
// order, a real decision and the check that settled it, the detectors that spot
// sensitive data, and the capabilities Wrapbox openly admits it lacks.
const c: TourCase = {
  id: "core-brain",
  order: 115,
  persona: { userId: "u-daniel", name: "Daniel Kim", role: "Developer" },
  title: "How Wrapbox makes a decision",
  goal: "Daniel wants to see how Wrapbox decides what coding agents like Claude Code may do.",
  outcome: "Daniel knows the fourteen checks and how they decide, why Claude Code's test run was allowed, what catches a leaked password, and the gaps Wrapbox openly admits.",
  start: "control",
  poster: 3,
  steps: [
    {
      target: "button.topbar-search",
      action: "click",
      title: "Find the Core Brain",
      body: "Daniel's coding agents run under Wrapbox. To see how it decides what they may do, Daniel opens the screen search to find Core Brain.",
      say: "Okay, Daniel's coding agents, like Claude Code, run under Wrapbox, and Daniel wants to see how it decides what they're allowed to do. Daniel opens the screen search to find Core Brain.",
      waitFor: { selector: ".palette-item", text: "Core Brain" },
    },
    {
      target: { selector: ".palette-item", text: "Core Brain" },
      action: "click",
      title: "One engine for every decision",
      body: "Actions on laptops, in network traffic and on company systems all come to this one engine, and every decision comes with its reasons written down.",
      say: "So, whether it's on a laptop, in network traffic or on a company system, every action comes to this one engine, and every decision has its reasons written down.",
      waitFor: ".page-head",
    },
    {
      // Clicking the tab also resets a tab remembered from an earlier visit.
      // engine/brain.ts decide() runs every check in order and keeps the strictest answer
      // (a later check never loosens it); only Break Glass can lift a hold, never a Safety
      // Kernel no. The spotlight stays on the tab (its count is the fourteen checks).
      target: { selector: ".tab", text: "How it decides" },
      action: "click",
      title: "Fourteen checks, strictest answer wins",
      body: "Every action goes through the same fourteen checks, in the same order, and the strictest answer wins. Only an emergency override can loosen it — never the kill switch or the Safety Kernel.",
      say: "Every action goes through the same fourteen checks, in the same order, and the strictest answer wins. Only an emergency override can loosen that, and never the kill switch or the Safety Kernel.",
    },
    {
      target: { selector: ".card", text: "Latest action on your checkout code" },
      title: "Start with a real decision",
      body: "Daniel's coding agent, Claude Code, ran the checkout tests. ALLOW means it ran as asked; “No rule restricts this action” means none of the checks objected.",
      say: "Here's a real one: Claude Code, Daniel's coding agent, ran the checkout tests. It was allowed, so it ran as asked, since none of the checks objected.",
    },
    {
      target: { selector: ".ecard", text: "Can we see inside?" },
      title: "Check one: can it see inside?",
      body: "If Wrapbox can't read what's being sent, like an encrypted zip, and a rule protects that kind of data, the action stops. That's what “fail closed” means.",
      say: "The first check asks if Wrapbox can see inside. If it can't read what's sent, like an encrypted zip, and a rule protects that data, it fails closed and the action stops.",
    },
    {
      target: { selector: ".ecard", text: "Your rules" },
      title: "Next, your company's own rules",
      body: "Rules your team wrote in plain words; if several match, the strictest wins. “Decided 10” means these rules made the call on 10 recorded actions.",
      say: "Next come your company's own rules, the ones your team wrote in plain words. If several match, the strictest wins, and these rules made the call on ten recorded actions.",
    },
    {
      target: { selector: ".ecard", text: "Safety Kernel" },
      title: "Then, rules nobody can switch off",
      body: "Built-in rules, like never sending passwords or keys outside the company. Your own rules can't turn them off, and they've stopped 3 recorded actions.",
      say: "Then there's the Safety Kernel, built-in rules like never sending passwords or keys outside the company. Your own rules can't turn them off, and they've stopped three recorded actions.",
    },
    {
      target: { selector: ".tab", text: "Detectors" },
      action: "click",
      title: "Detectors spot sensitive data",
      body: "Each card is one detector and the kind of data it finds, like email addresses (PII.EMAIL). That's how the checks know what an agent is sending.",
      say: "Over on Detectors, each card is one detector and the kind of data it finds, like email addresses. That's how the checks know what an agent is actually sending.",
      waitFor: { selector: ".ecard", text: "pii-email-v2" },
    },
    {
      target: ".fsearch",
      action: "type",
      text: "password",
      title: "What catches a leaked password?",
      body: "Daniel searches for passwords. One detector covers API keys, private keys and passwords, and it's marked ENFORCED: working today, not planned.",
      say: "Hmm, what catches a leaked password? Daniel searches, and one detector covers A-P-I keys, private keys and passwords, and it's marked enforced, so it's working today, not just planned.",
      waitFor: { selector: ".ecard", text: "secrets-v2" },
    },
    {
      target: { selector: ".tab", text: "Capability truthfulness" },
      action: "click",
      title: "No promise it can't keep",
      body: "Wrapbox lists six things it can't fully do yet. UNINSPECTABLE means it can't read encrypted files, so rules that depend on reading them can't be switched on.",
      say: "Finally, Wrapbox openly admits six things it can't fully do yet. It can't read encrypted files, for one, so rules that depend on reading them can't be switched on.",
      waitFor: { selector: ".ecard", text: "Encrypted content" },
      placement: "left",
    },
  ],
};
export default c;
