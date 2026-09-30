import type { TourCase } from "../types";

// Maya investigates one blocked action end to end in Live Actions.
const c: TourCase = {
  id: "live-actions-investigate",
  order: 25,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "Investigate a blocked action",
  goal: "Maya wants to understand exactly why an AI agent was stopped from moving customer data out of the company.",
  outcome: "Maya knows who asked, what the agent tried, which rule stopped it and the safer path, all in one complete record, sealed so any edit shows.",
  start: "control",
  poster: 5,
  steps: [
    {
      target: { selector: ".rail-item", text: "Live Actions" },
      action: "click",
      title: "Open Live Actions",
      body: "Maya, a security analyst, wants to know exactly why an AI agent was stopped from moving customer data out. Every agent action Wrapbox checks is listed here.",
      say: "Okay, Maya, a security analyst, wants to know exactly why an AI agent was stopped from moving customer data out. Maya opens Live Actions, which lists every agent action Wrapbox checks.",
      waitFor: { selector: ".overview-card", text: "Live decision stream" },
    },
    {
      target: ".decision-legend",
      title: "Four possible outcomes",
      body: "Allowed runs as asked. Constrained runs in a safer form, for example with sensitive data masked. Reviewed waits for a person to approve. Blocked never runs.",
      say: "There are four possible outcomes. Allowed runs as asked, constrained runs in a safer form, like with sensitive data masked, reviewed waits for a person to approve, and blocked never runs.",
    },
    {
      target: { selector: ".fselect", text: "Decision" },
      action: "select",
      value: "BLOCK",
      title: "Show only what was blocked",
      body: "Maya narrows the list to actions Wrapbox stopped before they could run: 7 of the 20 recorded.",
      say: "Maya narrows the list to just the actions Wrapbox stopped before they could run. That's seven of the twenty recorded.",
      waitFor: ".fbar",
    },
    {
      target: { selector: ".ecard", text: "500,000 rows" },
      action: "click",
      title: "Open one blocked action",
      body: "A finance agent tried to copy 500,000 rows of customer data to an outside website. Maya opens the full record.",
      say: "A finance agent tried to copy five hundred thousand rows of customer data to an outside website. Maya opens the full record.",
      waitFor: { within: ".drawer", selector: "h2" },
    },
    {
      target: { within: ".drawer", selector: "dl.kv" },
      title: "Who asked, and what was tried",
      body: "Alex Morgan's Internal Finance Agent asked its database tool to copy half a million customer IDs and email addresses from live company systems to an outside site.",
      say: "It was Alex Morgan's Internal Finance Agent. It asked its database tool to copy half a million customer I-Ds and email addresses from live company systems to an outside site.",
    },
    {
      target: { within: ".drawer", selector: "ul" },
      title: "Three checks raised a flag",
      body: "The company's own rule asks for a security review of bulk exports, a built-in safety rule flags mass exports, and 500,000 rows is far over the 500-row limit.",
      say: "Three checks flagged it: the company's own rule wants a security review for bulk exports, a built-in safety rule flags mass exports, and it's far past the five hundred row limit.",
    },
    {
      target: { within: ".drawer", selector: ".card", text: "Safe alternative" },
      title: "A safer way forward",
      body: "The record doesn't just say no. It suggests a safer, smaller request: a summary, or a sample of 500 rows or fewer.",
      say: "Here's the nice part: the record doesn't just say no. It suggests a safer, smaller request instead, either a summary or a sample of five hundred rows or fewer.",
    },
    {
      target: { within: ".drawer", selector: ".card", text: "This rule made the decision" },
      title: "The strictest rule decided",
      body: "The company's own rule would only have held it for a person to approve. Wrapbox's Safety Kernel, built-in rules no one can switch off, blocked it outright.",
      say: "The company's own rule would only have held it for a person to approve. But Wrapbox's Safety Kernel, built-in rules nobody can switch off, blocked it outright, so the strictest rule won.",
    },
    {
      target: { within: ".drawer", selector: ".pipe" },
      title: "The whole story, one record",
      body: "The evidence chain keeps the story in one place: the person, agent, tool, data found, destination, the rule that decided and the outcome.",
      say: "The evidence chain keeps it all in one place: the person, agent, tool, data found, destination, the rule that decided and the outcome.",
    },
    {
      target: { within: ".drawer", selector: ".row", text: "Evidence chain" },
      title: "Sealed, so any edit shows",
      body: "The code on the right seals who asked, the agent, action, destination, decision and deciding rule, plus the previous record's seal. Change any and it stops matching.",
      say: "So Maya has the whole story. The code on the right seals who asked, the agent, action, destination, decision and rule, plus the previous record's seal, so any edit shows.",
    },
  ],
};
export default c;
