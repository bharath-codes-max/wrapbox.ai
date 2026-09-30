import type { TourCase } from "../types";

// Priya shows per-tool-call MCP control. Veridian's MCP tool policy is four
// plain sentences compiled to clauses that name MCP tools and argument
// patterns; the Simulation Lab then runs the same push_files tool with safe and
// unsafe arguments, a local stdio server, and an unregistered server.
const c: TourCase = {
  id: "mcp-tool-control",
  order: 107,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "Control each MCP tool call",
  goal: "Veridian's coding agents use MCP tools, and Priya wants each call checked — which tool, with which arguments — not just which server it goes to.",
  outcome: "The same push_files tool ran on a feature branch and was held on main; writing .env and any call to an unregistered server were refused — all from rules written in plain English.",
  start: "intent",
  poster: 5,
  steps: [
    {
      target: { selector: ".ecard", text: "MCP tool policy" },
      action: "click",
      title: "Rules written in plain English",
      body: "Veridian's MCP tool policy is four plain sentences. Each one compiled to a rule that names MCP tools and their arguments.",
      say: "Veridian's M-C-P tool policy is just four plain sentences, and each one compiled into a rule that names M-C-P tools and their arguments.",
      waitFor: { within: ".drawer", selector: ".clause-facts", text: "push_files" },
    },
    {
      target: { within: ".drawer", selector: ".clause-facts", text: "push_files" },
      title: "Tool and arguments",
      body: "This rule reads: push_files, when the branch is main, needs engineering review. The argument is part of the rule, not just the tool's name.",
      say: "This one reads: push files, when the branch is main, needs engineering review. So the argument is part of the rule, not just the tool's name.",
    },
    {
      route: "simlab/mcp",
      target: { selector: ".stream-item", text: "MCP: push files to a feature branch" },
      action: "click",
      title: "Same tool, safe arguments",
      body: "In the Simulation Lab, Claude Code calls push_files with branch = fix/checkout-rounding.",
      say: "In the Simulation Lab, Claude Code calls push files on a feature branch.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Allowed",
      body: "Allowed: nothing restricts pushing to a feature branch.",
      say: "Allowed. Nothing restricts pushing to a feature branch.",
      waitFor: { selector: ".aterm-line", text: "Decision ALLOW" },
      hold: 1600,
    },
    {
      target: { selector: ".stream-item", text: "MCP: push files straight to main" },
      action: "click",
      title: "Same tool, main branch",
      body: "Now the very same tool — but the branch argument is main.",
      say: "Now the very same tool, but this time the branch argument is main.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Held for engineering review",
      body: "Held for review, decided by the MCP rule's argument match — the gateway saw tools/call, the tool and its arguments before anything ran.",
      say: "Held for engineering review. The gateway saw the tool call, the tool and its arguments before anything ran, and the argument match decided it.",
      waitFor: { selector: ".aterm-line", text: "Decision REVIEW" },
      hold: 2000,
    },
    {
      target: { selector: ".stream-item", text: "Local MCP: write a secrets file" },
      action: "click",
      title: "A local MCP server",
      body: "Next, a local (stdio) MCP server on the laptop — a channel network gateways never see. Claude Code asks it to write .env.",
      say: "Next, a local M-C-P server running on the laptop, a channel network gateways never see. Claude Code asks it to write the dot env file.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Secrets file: blocked",
      body: "Blocked: MCP file tools may not write secrets files. Local servers a governed agent starts run behind Wrapbox's endpoint shim.",
      say: "Blocked. M-C-P file tools may not write secrets files, because local servers a governed agent starts run behind Wrapbox's endpoint shim.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 1800,
    },
    {
      target: { selector: ".stream-item", text: "MCP: tool call to an unregistered server" },
      action: "click",
      title: "A server nobody registered",
      body: "Last, Claude Code calls list_files on the MCP server nobody registered.",
      say: "And last, Claude Code calls list files on the M-C-P server nobody registered.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Unregistered: refused",
      body: "Even a harmless-looking call is refused: tool calls to unregistered MCP servers are blocked.",
      say: "Even a harmless-looking call is refused, because tool calls to unregistered M-C-P servers are blocked.",
      waitFor: { selector: ".aterm-line", text: "Decision BLOCK" },
      hold: 2400,
    },
  ],
};
export default c;
