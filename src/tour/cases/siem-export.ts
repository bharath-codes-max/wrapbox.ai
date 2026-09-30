import type { TourCase } from "../types";

// Maya's SOC lives in the SIEM. Evidence exports exactly the records shown as
// OCSF 1.3.0 or OpenTelemetry (OTLP/JSON) — the walkthrough points at the
// buttons without downloading — and Integrations says plainly that live
// streaming to Splunk is the simulated part.
const c: TourCase = {
  id: "siem-export",
  order: 112,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "Send decisions to the SIEM",
  goal: "Maya's SOC works in its SIEM and doesn't want another console — every Wrapbox decision should land where her team already looks.",
  outcome: "Maya can export exactly the records she's looking at as OCSF or OpenTelemetry, each carrying the complete decision, and knows live streaming to Splunk is the part still simulated.",
  start: "control",
  poster: 2,
  steps: [
    {
      target: { selector: ".rail-item", text: "Evidence" },
      action: "click",
      title: "One record per decision",
      body: "Maya opens Evidence: one complete record per decision, the same records her SOC needs.",
      say: "Maya's team lives in their SIEM, so she opens Evidence: one complete record per decision, which is exactly what her SOC needs.",
      waitFor: { selector: ".overview-card", text: "Complete decision records" },
    },
    {
      target: { selector: ".fselect", text: "Decision" },
      action: "select",
      value: "BLOCK",
      title: "Pick what to send",
      body: "She narrows the ledger to blocked actions — what her SOC wants first.",
      say: "She narrows the ledger to blocked actions, which is what her SOC wants first.",
      waitFor: ".fcount",
    },
    {
      target: { selector: "div", text: "Export the records shown" },
      title: "Two standard formats",
      body: "Export sends exactly the records shown. OCSF 1.3.0 files each one by where it happened — file, process, HTTP or API activity. OTLP sends them as OpenTelemetry logs.",
      say: "Export sends exactly the records shown. O-C-S-F files each one by where it happened, as file, process, H-T-T-P or A-P-I activity, and O-T-L-P sends them as Open Telemetry logs.",
      pad: 10,
    },
    {
      target: { selector: ".ecard", nth: 0 },
      action: "click",
      title: "What each record carries",
      body: "Every exported record carries the whole decision: who, which agent, the action, the data, the destination, the rule and reason, any approver, and the outcome.",
      say: "And every exported record carries the whole decision: who, which agent, the action, the data, where it was going, the rule and reason, any approver, and the outcome.",
      waitFor: { within: ".drawer", selector: "dl.kv" },
    },
    {
      target: { selector: ".rail-item", text: "Integrations" },
      action: "click",
      title: "What's real, what's simulated",
      body: "On Integrations, the SIEM card is honest about which part works today.",
      say: "Over on Integrations, the SIEM card is honest about which part works today.",
      waitFor: { selector: ".ecard", text: "SIEM export" },
    },
    {
      target: { selector: ".ecard", text: "SIEM export" },
      title: "Export live, streaming simulated",
      body: "Export works today. Streaming it live into a SIEM such as Splunk is the part still simulated — and the card says exactly that.",
      say: "Export works today. Streaming it live into a SIEM like Splunk is the part that's still simulated, and the card says exactly that.",
      placement: "top",
    },
  ],
};
export default c;
