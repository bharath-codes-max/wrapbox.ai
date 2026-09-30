import type { TourCase } from "../types";

// Priya checks where Wrapbox is plugged in and how much it can stop in each place,
// then sees what Wrapbox knows about every action and how one rule can cover many
// ways of doing the same thing. Everything shown lives on the Integrations page.
// Statuses come from the capability registry (5 enforced, 4 degraded, 0 understood
// only); counts and the replayed action (evt-00020) come from the demo workspace.
// The ecosystem cards never count toward enforcement: identity and chat delivery
// are simulated, decision export is real and its streaming is simulated.
const c: TourCase = {
  id: "integrations",
  order: 105,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "See where Wrapbox is plugged in",
  goal: "Priya, the admin, wants to know where Wrapbox sits today, how much it can really stop in each place, what it knows about every action, and how one rule can cover many ways of doing the same thing.",
  outcome: "Priya knows where Wrapbox can stop actions fully and where only partly, how it fits Veridian's identity, chat and SIEM tools, who is behind each action, and that one rule can cover many ways of doing the same thing.",
  start: "control",
  poster: 2,
  steps: [
    {
      target: { selector: ".rail-item", text: "Integrations" },
      action: "click",
      title: "Open Integrations",
      body: "Priya, the admin, wants to see where Wrapbox is plugged in. Integrations lists every place it checks AI agents: laptops, the network, GitHub, AWS and more.",
      say: "Okay, Priya's the admin here, and wants to know where Wrapbox is plugged in today. Integrations lists every place it checks AI agents: laptops, the network, GitHub, A-W-S and more.",
      waitFor: { selector: ".page-head", text: "The places Wrapbox sits" },
    },
    {
      target: ".metricband",
      title: "How strong is each connection?",
      // The band's own note for Degraded is "some parts only watched" (AWS governs only IAM,
      // S3 and ECS deploys; everything else there is watched), so no "most" here.
      body: "Five are enforced: Wrapbox can stop a bad action there before it runs. Four are degraded: they stop some parts and only watch others, and each card says which.",
      say: "So, how strong is each connection? In five places Wrapbox can stop a bad action before it runs, and four stop some parts and only watch the rest. Each card says which parts.",
    },
    {
      // Also resets the page to this tab if an earlier run left another one open.
      target: { selector: "button.tab", text: "Connected systems" },
      action: "click",
      title: "Every coding agent, same checks",
      body: "Claude Code, Cursor and Codex go through the same checks. This terminal replays a recorded action: tests run on Daniel's laptop, held and checked by Wrapbox, then allowed.",
      say: "Claude Code, Cursor and Codex all go through the same checks. This terminal replays a recorded test run on Daniel's laptop: Wrapbox held it, checked it, then allowed it.",
      // The trace itself: the whole terminal is taller than the space under the header.
      waitFor: ".aterm-body",
    },
    {
      target: { selector: ".ecard", text: "GitHub Organization" },
      title: "A fully enforced connection",
      body: "Pushes, pull requests and branch changes on the checkout-service code go through Wrapbox first, so it can stop a bad one. Two recorded actions went through here.",
      say: "GitHub is fully enforced. Pushes, pull requests and branch changes on the checkout service go through Wrapbox first, so it can stop a bad one, and two recorded actions came through here.",
    },
    {
      target: { selector: ".ecard", text: "macOS Endpoint runtime" },
      title: "Protection on the laptops",
      body: "On enrolled laptops, Wrapbox checks file access and program launches before they happen. Clipboard control is marked PENDING: planned, and not counted as protection yet.",
      say: "On enrolled laptops, Wrapbox checks file access and program launches before they happen. Clipboard control is marked pending, meaning it's planned, but not counted as protection yet.",
    },
    {
      target: { selector: ".ecard", text: "MCP registry" },
      title: "MCP tools, checked one call at a time",
      // The card's 2 recorded actions are the unregistered server's network sends, which the
      // Network Extension blocked, so don't imply Wrapbox failed to stop that server.
      body: "MCP servers give AI agents extra tools. Each remote tool call is checked, tool and arguments, before it runs. Local servers count only when a governed agent starts them, so it's degraded. One unregistered server was spotted.",
      say: "M-C-P servers give AI agents extra tools. Each remote tool call is checked, tool and arguments, before it runs. Local servers only count when a governed agent starts them, so it's marked degraded, and one unregistered server was spotted.",
    },
    {
      // The three ecosystem cards; each carries a "Simulated" chip and none counts in the band above.
      target: { selector: ".ecard-grid", text: "Slack · Microsoft Teams" },
      title: "Fits the tools you already run",
      body: "Three cards show how Wrapbox fits tools Veridian already runs. Okta or Entra for identity and Slack or Teams for approvals are simulated. Export to OCSF or OpenTelemetry works today; only streaming to a SIEM like Splunk is simulated.",
      say: "Further down, three cards show how Wrapbox fits tools Veridian already runs. Okta or Entra for identity, and Slack or Teams for approvals, are simulated. Export to O-C-S-F or Open Telemetry works today; only streaming it to a SIEM like Splunk is simulated.",
      placement: "top",
    },
    {
      target: { selector: "button.tab", text: "Identity model" },
      action: "click",
      title: "Who is behind every action",
      body: "Priya opens the Identity model. The action the terminal replayed is traced end to end: Daniel Kim, on Daniel-MBP, with Claude Code, through the terminal, on checkout-service.",
      say: "Priya opens the identity model. That replayed action is traced end to end: Daniel Kim, on Daniel's laptop, using Claude Code, through the terminal, on checkout service.",
      // The tabs + panel (only once the Identity tab is showing): its centre falls in the blank
      // gap above the chain, so the cursor doesn't cover the "Through: Terminal" chip.
      waitFor: { selector: ".page-tabs", text: "is never an identity" },
    },
    {
      // The card's own footnote: the user comes from company sign-in, never from the app.
      target: { selector: ".small.dim", text: "is never an identity" },
      title: "A real person, not an app",
      body: "Daniel's name comes from the company sign-in (Okta), not from the app the traffic came through. Every decision and evidence record carries this full chain.",
      say: "Daniel's name comes from the company sign-in, Okta, not from the app the traffic came through. And every decision and evidence record carries this whole chain.",
    },
    {
      target: { selector: "button.tab", text: "Action ontology" },
      action: "click",
      title: "Many ways, one plain verb",
      body: "Agents can do the same thing in many ways. The Action ontology, Wrapbox's dictionary of actions, turns each way into one plain verb, like DELETE.",
      say: "Agents can do the same thing in lots of ways. The action ontology, which is Wrapbox's dictionary of actions, turns each way into one plain verb, like delete.",
      waitFor: { selector: ".ecard", text: "rm build/tmp.txt" },
    },
    {
      target: { within: ".fbar", selector: ".fsearch" },
      action: "type",
      text: "tmp.txt",
      title: "Three ways, one rule",
      body: "Priya searches for one file. Deleting it with a shell command, Python or Node.js is the same DELETE, so one rule about deleting covers all three.",
      say: "Priya searches for one file, and here's the cool part: deleting it with a shell command, Python or Node J-S is the same delete, so one rule about deleting covers all three.",
      waitFor: ".ecard-grid",
      hold: 1800,
    },
  ],
};
export default c;
