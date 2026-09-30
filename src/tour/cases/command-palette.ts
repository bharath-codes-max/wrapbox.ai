import type { TourCase } from "../types";

// Sam isn't technical and doesn't know the menus, so Sam finds things by typing:
// the "Search screens…" box opens a list of every screen (the palette matches
// screen names only), a few letters narrow it, one click lands on Evidence, and
// Evidence's own search finds the one record tagged as financial data — the
// unregistered agent on Alex's finance laptop trying to send customer account
// numbers to an unknown address (EVT-00017). agents-inventory reaches the same
// record through the Agent filter; this case reaches it by search.
const c: TourCase = {
  id: "command-palette",
  order: 120,
  persona: { userId: "u-sam", name: "Sam Rivera", role: "Finance Controller" },
  title: "Find what you need by typing",
  goal: "Sam wants to know whether any AI agent has tried to send Veridian's financial data out of the company, without first learning the menus.",
  outcome: "Two short searches found the one record: customer account numbers an unregistered AI tool tried to send out, stopped before they left.",
  start: "control",
  poster: 3,
  steps: [
    {
      target: ".topbar-search",
      action: "click",
      title: "One search box on every screen",
      body: "Sam needs to know if any AI agent tried to send financial data out, but doesn't know the menus. The top search box (or ⌘K) lists every screen.",
      say: "Okay, Sam from finance wants to know if any AI agent tried to send financial data out, but doesn't know the menus. The top search box, or Command K, lists every screen.",
      waitFor: ".palette",
    },
    {
      // Spotlight the whole palette, so the list stays visible while it narrows;
      // afterwards, the palette once only Evidence is left (typed letters + result).
      target: ".palette",
      action: "type",
      text: "evid",
      title: "Type a few letters",
      body: "The list narrows as Sam types. After four letters, only one screen is left: Evidence, the record of every decision Wrapbox has made.",
      say: "The list narrows as Sam types, and after just four letters, only one screen is left: Evidence, the record of every decision Wrapbox has made.",
      waitFor: { selector: ".palette:has(.palette-item:only-child)", text: "Evidence" },
    },
    {
      target: { selector: ".palette-item", text: "Evidence" },
      action: "click",
      title: "Straight to the right screen",
      body: "One click and Sam is there, no menus learned. Each record says who acted, through which AI agent, what data was involved and what Wrapbox decided.",
      say: "Nice, one click and Sam's there, no menus to learn. Each record says who acted, through which AI agent, what data was involved, and what Wrapbox decided.",
      waitFor: { selector: ".page-head", text: "Evidence Explorer" },
    },
    {
      target: ".fsearch",
      action: "type",
      text: "financial",
      title: "One word, one record",
      body: "Evidence has its own search. Sam types “financial”, and 20 records narrow to one, tagged FINANCIAL.ACCOUNT: customer account numbers.",
      say: "Evidence has its own search too. Sam types the word financial, and twenty records narrow down to one, tagged as financial account data, meaning customer account numbers.",
      waitFor: { selector: ".ecard", text: "export.json" },
    },
    {
      target: { selector: ".ecard", text: "export.json" },
      action: "click",
      title: "There it is",
      body: "An unregistered AI tool on Alex Morgan's finance laptop tried to send account numbers to an unknown address. BLOCK means Wrapbox stopped it. Sam opens the record.",
      say: "There it is: an unregistered AI tool on Alex Morgan's finance laptop tried to send account numbers to an unknown address. Wrapbox stopped it, and Sam opens the record.",
      waitFor: { within: ".drawer", selector: "h2" },
    },
    {
      target: { within: ".drawer", selector: "ul", text: "Unknown high-risk external transfer" },
      title: "Stopped by an always-on rule",
      body: "The reason is written down. The Safety Kernel, Wrapbox's built-in rules no customer can switch off, stops sensitive data from going to an outside address nobody has vetted.",
      say: "The reason's written right there. The Safety Kernel, Wrapbox's built-in rules that no customer can switch off, stops sensitive data going to an outside address nobody has vetted.",
      pad: 12,
    },
    {
      target: { within: ".drawer", selector: ".grid", text: "Blocked before transmission" },
      title: "Sam's answer, no menus needed",
      body: "Three clicks and two short searches gave Sam the answer: the file held customer account numbers, and Wrapbox stopped it before that address received anything.",
      say: "So that's Sam's answer, from three clicks and two short searches. The file held customer account numbers, and Wrapbox stopped it before that address got anything.",
    },
  ],
};
export default c;
