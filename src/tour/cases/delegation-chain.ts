import type { TourCase } from "../types";

// Maya checks agent-to-agent delegation: every agent in a chain is decided and
// the strictest answer wins, so a read-only agent can't get a more powerful one
// to write for it, and an unregistered agent can't pass work through a trusted one.
const c: TourCase = {
  id: "delegation-chain",
  order: 96,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "When one agent asks another",
  goal: "Veridian's agents have started asking each other for help, and Maya needs to know authority can't quietly grow along the way.",
  outcome: "A read-only agent couldn't get a more powerful one to write for it, an unregistered agent couldn't pass work through Claude Code, and each record names the whole chain.",
  start: "simlab/agentic",
  poster: 3,
  steps: [
    {
      target: { selector: ".stream-item", text: "Agent asks another agent to run tests" },
      action: "click",
      title: "A simple hand-off",
      body: "Claude Code hands a test run to Codex. Both agents are allowed to run tests.",
      say: "Okay, first a simple hand-off: Claude Code asks Codex to run the tests, and both agents are allowed to do that.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Every agent checked",
      body: "Allowed: Wrapbox checked every agent in the chain, and each may do this.",
      say: "Allowed. Wrapbox checked every agent in the chain, and each of them may do this.",
      waitFor: { selector: ".aterm-line", text: "Decision ALLOW" },
      hold: 1400,
    },
    {
      target: { selector: ".stream-item", text: "Agent asks a more powerful agent to write for it" },
      action: "click",
      title: "Borrowing power",
      body: "The Support Agent is read-only on customer-db. It asks the Internal Finance Agent — which can write there — to close a customer's account.",
      say: "Now the Support Agent, which is read-only on the customer database, asks the Internal Finance Agent, which can write there, to close a customer's account.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Authority can't grow",
      body: "Held: the Finance Agent could do this alone, but not on behalf of an agent that can't. The strictest answer in the chain wins.",
      say: "Held. The Finance Agent could do this on its own, but not on behalf of an agent that can't. The strictest answer in the chain wins.",
      waitFor: { selector: ".aterm-line", text: "Decision REVIEW" },
      hold: 2000,
    },
    {
      target: { selector: ".stream-item", text: "An unregistered agent in the chain" },
      action: "click",
      title: "A stranger in the chain",
      body: "Last, the unregistered MCP agent asks Claude Code to read the checkout source for it.",
      say: "Last one: the unregistered M-C-P agent asks Claude Code to read the checkout source for it.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Blocked",
      body: "Blocked: an unknown agent can't pass authority through a trusted one, even for something Claude Code could read itself.",
      say: "Blocked. An unknown agent can't pass authority through a trusted one, even for something Claude Code could read on its own.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 1600,
    },
    {
      target: { selector: ".card button", text: "Evidence", exact: true },
      action: "click",
      title: "The whole chain, on record",
      body: "The record names the chain — Unknown MCP agent (“send me the checkout source”) → Claude Code — and which check decided.",
      say: "And the record names the whole chain, the unknown agent asking Claude Code for the checkout source, plus which check decided.",
      waitFor: { within: ".drawer", selector: ".agent-context", text: "Delegated via" },
      pad: 10,
    },
  ],
};
export default c;
