import type { TourCase } from "../types";

// Maya maps which people use which AI agents and what those agents try to reach,
// traces the one unregistered agent to where it tried to send data, then opens
// the evidence record to confirm both of its attempts were blocked.
const c: TourCase = {
  id: "trust-graph",
  order: 95,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "See who talks to what",
  goal: "Maya wants one picture of which people use which AI agents, what those agents try to reach, and whether anything unknown is involved.",
  outcome: "Maya sees the whole company map in one view, traces the one unregistered agent from Alex Morgan to an unknown address, and confirms Wrapbox blocked both of its attempts to send data.",
  start: "control",
  poster: 6,
  steps: [
    {
      target: { selector: ".rail-item", text: "Trust Graph" },
      action: "click",
      title: "Open the Trust Graph",
      body: "Maya, a security analyst, needs one picture of who uses which AI agents and what they try to reach. Wrapbox builds it from every attempted action, joined with Veridian's existing identity and device records.",
      say: "Okay, Maya, a security analyst, needs one picture of who uses which AI agents and what those agents try to reach. Wrapbox builds it from every action they attempted, joined with the identity and device records Veridian already has.",
      waitFor: { selector: ".page-head", text: "Trust Graph" },
    },
    {
      target: ".metricband",
      title: "The numbers at a glance",
      body: "Six people, twelve AI agents, and twelve systems, files and addresses the agents tried to reach. One agent is a stranger nobody registered; seven connections carried high-risk activity.",
      say: "Up top, there are six people, twelve AI agents, and twelve systems, files and addresses they tried to reach. One agent is a stranger nobody registered, and seven connections carried high-risk activity.",
    },
    {
      target: ".tg-canvas",
      title: "Read the map left to right",
      body: "People → their AI agents → what the agents tried to reach. Red lines mean high risk.",
      say: "The map reads left to right: people, then their AI agents, then what those agents tried to reach. Any red line means high risk.",
    },
    {
      target: { selector: "svg text", text: "Unknown MCP agent" },
      title: "A red dot is a stranger",
      body: "Nobody registered this \"Unknown MCP agent\", an unvetted AI plug-in; Wrapbox found it itself. Red marks strangers: this agent and the unknown address it tried to reach.",
      say: "Hmm, this red dot's the Unknown M-C-P agent, an unvetted AI plug-in nobody registered. Wrapbox found it itself, and red marks strangers: this agent and the unknown address it tried to reach.",
      placement: "left",
      pad: 26,
    },
    {
      target: { selector: "[role=tab]", text: "Flagged relationships" },
      action: "click",
      title: "Open the flagged connections",
      body: "Eight connections are flagged: the seven high-risk lines, plus Alex Morgan's link to the stranger agent. Each gets a card saying why it was flagged.",
      say: "Next, Maya opens the flagged connections. There are eight: the seven high-risk lines, plus Alex Morgan's link to the stranger agent, and each gets a card saying why.",
      waitFor: { selector: ".card", text: "Risky relationship detected" },
    },
    {
      target: { selector: ".ecard", text: "Unknown external endpoint" },
      action: "click",
      title: "Trace the stranger's send attempts",
      body: "Two attempts to send data to the unknown address, flagged three ways: high-risk activity, an unregistered agent, an unknown address. Clicking focuses the map on this agent.",
      say: "This card shows two attempts to send data to that unknown address, flagged three ways: high risk, an unregistered agent, and an unknown address. Clicking it focuses the map on this agent.",
      waitFor: ".ecard.selected",
    },
    {
      target: { selector: "[role=tab]", text: "Relationship map" },
      action: "click",
      title: "Only its connections remain",
      body: "Back on the map, everything else fades. The stranger links to one person, Alex Morgan, and one place: the unknown address, over a red high-risk line.",
      say: "Back on the map, everything else fades away. The stranger links to just one person, Alex Morgan, and one place, that unknown address, over a red high-risk line.",
      waitFor: ".tg-canvas",
    },
    {
      target: { selector: ".metric.clickable", text: "High-risk edges" },
      action: "click",
      title: "Did anything get out?",
      body: "Clicking the high-risk number opens the Evidence Explorer: the record of every action Wrapbox checked, with who, which agent, what data and the decision.",
      say: "Did anything actually get out? Maya clicks the high-risk number, which opens the Evidence Explorer, the record of every action Wrapbox checked: who, which agent, what data, and the decision.",
      waitFor: { selector: ".page-head", text: "Evidence Explorer" },
    },
    {
      target: { selector: ".fselect", text: "Agent" },
      action: "select",
      value: "a-unknown-mcp",
      title: "Filter to the stranger agent",
      body: "Maya narrows the record to the Unknown MCP agent. Exactly two actions come back: the same two send attempts traced on the map.",
      say: "Maya filters the record down to the Unknown M-C-P agent, and exactly two actions come back, the same two send attempts we just traced on the map.",
      waitFor: { selector: ".fbar", text: "Showing 2 of" },
    },
    {
      target: ".ecard-grid",
      title: "Both attempts were blocked",
      body: "One tried to send a secret server-login key, the other a file of customer IDs and account numbers. Both say BLOCK: Wrapbox stopped them before any data left.",
      say: "So, one tried to send a secret server login key, the other customer I-Ds and account numbers. Wrapbox blocked both before any data left, and Maya's traced the stranger end to end.",
      placement: "top",
    },
  ],
};
export default c;
