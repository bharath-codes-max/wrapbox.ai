import type { TourCase } from "../types";

// Maya answers an auditor from the Evidence Explorer. Maya searches the ledger
// for anything involving passwords or keys (every match is BLOCK, including a
// locked archive Wrapbox could not read, which fails closed because it could
// hide a key), then opens the card for an unidentified agent trying to upload
// Alex's private SSH key, and walks the record: who and what, what the
// detector found, proof it was never transmitted, the company rule that
// decided it, the Safety Kernel rules that back it up as a second lock, and
// the seal — computed over the decision's facts plus the previous record's
// seal. The complete record is the answer; the seal is its integrity layer.
// Everything shown is the seeded company's own history.
const c: TourCase = {
  id: "evidence-prove",
  order: 110,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "Prove what happened",
  goal: "An auditor asks Maya to prove that no passwords or keys have left the company through an AI agent.",
  outcome: "Maya shows that every record involving a password or key was blocked, and gives the auditor the complete record proving Alex Morgan's private key never left the laptop, sealed so any edit would show.",
  start: "control",
  poster: 6,
  steps: [
    {
      target: { selector: ".rail-item", text: "Evidence" },
      action: "click",
      title: "Open the Evidence Explorer",
      body: "An auditor wants proof that no passwords or keys have left the company through an AI agent. Maya opens Evidence, where every Wrapbox decision is recorded.",
      say: "So, an auditor asks Maya to prove that no passwords or keys have left the company through an AI agent. Maya opens Evidence, where every Wrapbox decision gets recorded.",
      waitFor: { selector: ".overview-card", text: "Complete decision records" },
    },
    {
      target: { selector: ".overview-card", text: "Complete decision records" },
      title: "One complete record per decision",
      body: "All 20 decisions have one complete record: who, which agent and tool, the action, data and destination, the rule and reason, any approver, and the outcome. Each is also sealed to the one before (simulated here).",
      say: "All twenty decisions have one complete record: who asked, which agent and tool, the action, the data and where it was going, the rule and reason, any approver, and the outcome. And each one is sealed to the one before, which is simulated in this demo.",
    },
    {
      target: ".fsearch",
      action: "type",
      text: "credential",
      title: "Search for passwords and keys",
      body: "Four matches, all stopped (BLOCK). One is a locked zip that could hide a key.",
      say: "Maya searches for credentials, meaning passwords and keys. Four matches come back, and every one was blocked, including a locked zip file that could be hiding a key.",
      waitFor: ".ecard-grid",
    },
    {
      target: { selector: ".ecard.clickable-card", text: "id_rsa" },
      action: "click",
      title: "Open the private key record",
      body: "An unidentified agent on Alex Morgan's laptop tried to send Alex's private SSH key, a key for logging in to servers, to an unknown address. Maya opens it.",
      say: "An unidentified agent on Alex Morgan's laptop tried to send Alex's private S-S-H key, a server login key, to an unknown address. Maya opens that record.",
      waitFor: { within: ".drawer", selector: "h2" },
    },
    {
      target: { within: ".drawer", selector: "dl.kv", text: "Device" },
      title: "Who, where and what",
      body: "The record names Alex Morgan, the laptop, the unidentified agent, the exact upload it tried, where it was headed and the kind of data inside.",
      say: "First, the record names Alex Morgan, the laptop, the unidentified agent, the exact upload it tried, where it was headed, and what kind of data was inside.",
    },
    {
      target: { within: ".drawer", selector: ".ecard", text: "PRIVATE_KEY" },
      title: "What Wrapbox found inside",
      body: "Before deciding, Wrapbox's secrets detector read what was being sent and recognised a private key, with full confidence. The rules then acted on that finding.",
      say: "Before deciding anything, Wrapbox's secrets detector read what was being sent and recognised a private key, with full confidence. Then the rules acted on that finding.",
    },
    {
      target: { within: ".drawer", selector: ".grid", text: "Blocked before transmission" },
      title: "Proof it never left",
      body: "The record shows what the agent tried to send and states plainly: blocked before transmission. The unknown address never received the key.",
      say: "Here's the cool part: the record shows what the agent tried to send, and says plainly it was blocked before it went out. The unknown address never got the key.",
    },
    {
      target: { within: ".drawer", selector: ".rule-item", text: "Credentials must never" },
      title: "The company's own rule decided",
      body: "Veridian's own rule, “Credentials must never be transmitted externally”, matched this upload and made the call. The record names the rule and marks it: this rule decided.",
      say: "Veridian's own rule, credentials must never be transmitted externally, matched this upload and made the call. The record names that rule and marks it as the one that decided.",
    },
    {
      target: { within: ".drawer", selector: ".grid", text: "Second lock" },
      title: "Backed up by a second lock",
      body: "Wrapbox's built-in safety rules, the Safety Kernel, are a second lock. Each one shown would have blocked this on its own, even without Veridian's rule.",
      say: "And there's a second lock: Wrapbox's built-in safety rules, called the Safety Kernel. Each one shown here would have blocked this on its own, even without Veridian's rule.",
    },
    {
      target: { within: ".drawer", selector: ".row", text: "Evidence chain" },
      title: "The complete record, sealed",
      body: "This complete record is Maya's answer, and its seal keeps it honest: the first code covers who, which agent, what, where and the decision, plus the previous record's seal. Change one and it stops matching.",
      say: "So this complete record is Maya's answer, and its seal keeps it honest. The first code here locks in who, which agent, what, where and the decision, plus the previous record's seal, so change anything and it stops matching.",
      pad: 10,
    },
  ],
};
export default c;
