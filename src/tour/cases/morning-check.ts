import type { TourCase } from "../types";

// Maya's morning check: read the Control Room, then follow one number back to
// the recorded events behind it.
const c: TourCase = {
  id: "morning-check",
  order: 20,
  persona: { userId: "u-maya", name: "Maya Chen", role: "Security Analyst" },
  title: "The morning security check",
  goal: "Maya starts each morning by checking what the company's AI agents did and whether anything is waiting on a person.",
  outcome: "In a few clicks Maya knows what ran, what was stopped and that nothing is waiting — and can open the records behind the numbers.",
  start: "control",
  poster: 1,
  steps: [
    {
      target: ".metricband",
      title: "Maya's morning starts here",
      body: "Four numbers: AI agents at work (plus one unknown agent Wrapbox spotted), requests waiting on a person, blocked actions touching passwords or keys, and high-risk actions.",
      say: "This is where Maya starts every morning, with four numbers: agents at work plus one unknown agent Wrapbox spotted, requests waiting on a person, blocked password or key actions, and high-risk actions.",
    },
    {
      target: ".overview-decision",
      title: "What happened to every action",
      body: "Allowed ran as asked. Constrained ran only after Wrapbox changed it to make it safe. Reviewed waited for a person to decide. Blocked never ran.",
      say: "Here's what happened to every action. Allowed ran as asked, constrained ran only after Wrapbox changed it to be safe, reviewed waited for a person to decide, and blocked never ran.",
    },
    {
      target: 'button[aria-label="Reviews"]',
      title: "Nothing is waiting on Maya",
      body: "Requests that need a person's yes or no land here. This morning none are waiting — every held action has already been decided.",
      say: "Anything that needs a person's yes or no lands here in Reviews. This morning nothing's waiting, because every held action has already been decided.",
    },
    {
      target: { selector: ".metric", text: "Secrets protected" },
      action: "click",
      title: "Where does this number come from?",
      body: "Every tile links to where its number comes from. Maya clicks Secrets protected and lands in Evidence, the record of every decision Wrapbox made.",
      say: "Here's the cool part: every tile links to where its number comes from. Maya clicks Secrets protected and lands in Evidence, the record of every decision Wrapbox made.",
      waitFor: { selector: ".page-head", text: "Evidence Explorer" },
    },
    {
      target: { selector: ".fselect", text: "Decision" },
      action: "select",
      value: "BLOCK",
      title: "Show only what was stopped",
      body: "Maya keeps only the blocked actions. The counter shows how many records match out of the whole log — the same number the Control Room listed as Blocked.",
      say: "Maya filters down to just the blocked actions. The counter shows how many records match out of the whole log, and it's the same number the Control Room showed as blocked.",
      waitFor: ".fcount",
    },
    {
      target: ".fsearch input",
      action: "type",
      text: "CREDENTIAL.",
      title: "Narrow to passwords and keys",
      body: "Wrapbox labels every password or key it finds \"CREDENTIAL.\" plus its kind. Searching that label leaves only the blocked actions that involved one.",
      say: "Wrapbox tags every password or key it finds with the label credential, plus what kind it is. Searching that label leaves only the blocked actions that involved one.",
      waitFor: ".fcount",
    },
    {
      target: ".ecard-grid",
      title: "The number, record by record",
      body: "The cards match the Control Room tile one for one. Each shows who asked, through which agent and app, what data was involved, and when.",
      say: "Yeah, the cards match the Control Room tile one for one. Each shows who asked, through which agent and app, what data was involved, and when.",
    },
    {
      target: { selector: ".ecard", nth: 0 },
      action: "click",
      title: "Open one attempt",
      body: "One click opens the full record: Alex Morgan's laptop, the unknown agent the Control Room flagged, and the address the private key was headed to.",
      say: "One click opens the full record. There's Alex Morgan's laptop, the unknown agent the Control Room flagged, and the address the private key was headed to.",
      waitFor: { within: ".drawer", selector: "dl.kv" },
    },
    {
      target: { within: ".drawer", selector: "ul", text: "Enterprise forbid" },
      title: "Why it was stopped",
      body: "The company's own rule — passwords and keys must never be sent outside — made the call. Two always-on Wrapbox safety rules would each have blocked it too.",
      say: "So why was it stopped? The company's own rule, never send passwords or keys outside, made the call, and two always-on Wrapbox safety rules would each have blocked it too.",
    },
    {
      target: { within: ".drawer", selector: ".grid", text: "Blocked before transmission" },
      title: "Nothing left the device",
      body: "The private key never reached that unknown address. The counts Maya checked this morning — decisions, secrets, high-risk actions — are built from records like this one.",
      say: "The private key never reached that unknown address. In a few clicks, Maya knows what ran, what was stopped and that nothing's waiting, and every number traces back to records like this.",
    },
  ],
};
export default c;
