import type { TourCase } from "../types";

// Reference case: Priya writes a company rule in plain words.
// Priya is the persona the product records as author on Save as draft, and the header avatar.
const c: TourCase = {
  id: "intent-plain-english",
  order: 30,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "Write a rule in plain English",
  goal: "Priya wants customer emails and phone numbers disguised before they are sent outside the company.",
  outcome: "Priya's own sentence became a rule Wrapbox can check, saved as a draft that changes nothing until someone switches it on.",
  start: "intent",
  poster: 4,
  steps: [
    {
      target: { selector: "button", text: "Draft contract" },
      action: "click",
      title: "Start a new rule",
      body: "Priya wants customer emails and phone numbers disguised before they leave the company. Wrapbox calls a written company rule a contract, so Priya drafts one.",
      say: "Okay, Priya wants customer emails and phone numbers disguised before they leave the company. Wrapbox calls a written company rule a contract, so Priya starts drafting one.",
      waitFor: { within: ".drawer", selector: ".field", nth: 0 },
    },
    {
      target: ".drawer input.input",
      action: "type",
      text: "Protect customer contact details",
      title: "Give it a clear name",
      body: "A plain name, so anyone on the team can recognise the rule later.",
      say: "Priya names it Protect customer contact details, a plain name anyone on the team can recognise later.",
    },
    {
      target: ".drawer textarea",
      action: "type",
      text: "Customer email addresses and phone numbers must be tokenized before they are sent anywhere outside the company.",
      title: "Write it in everyday words",
      body: "Priya swaps the example text for one plain sentence. 'Tokenized' means each email or phone number is replaced with a stand-in code before it leaves.",
      say: "Then Priya swaps the example text for one plain sentence. Tokenized just means each email or phone number gets replaced with a stand-in code before it leaves.",
    },
    {
      target: { within: ".drawer", selector: "button", text: "Compile" },
      action: "click",
      title: "Turn the sentence into a rule",
      body: "Wrapbox reads the sentence and works out which data it protects and what must happen to that data.",
      say: "Priya hits Compile, and Wrapbox reads the sentence and works out which data it protects and what has to happen to that data.",
      waitFor: { within: ".drawer", selector: ".card", nth: 0 },
    },
    {
      target: { within: ".drawer", selector: ".card", nth: 0 },
      title: "Check what Wrapbox understood",
      body: "CONSTRAIN: the message still goes, but emails and phone numbers are swapped for stand-ins. Fail closed: if Wrapbox can't read what's being sent, it blocks it.",
      say: "Now, here's what Wrapbox understood. The message still goes out, but with stand-ins for emails and phone numbers, and if Wrapbox can't read what's being sent, it blocks it.",
    },
    {
      target: { within: ".drawer", selector: ".row", text: "Coverage rollup" },
      title: "No promise it can't keep",
      body: "ENFORCED means Wrapbox has a working check for this today. If a needed check were missing, it would say so and refuse to switch the rule on.",
      say: "Wrapbox makes no promise it can't keep. Enforced means there's a working check for this today, and if one were missing, it would say so and refuse to switch the rule on.",
      pad: 10,
    },
    {
      target: { within: ".drawer", selector: "button", text: "Save as draft" },
      action: "click",
      title: "Saved as a draft",
      body: "The rule joins the team's list as a DRAFT under Priya's name. The top bar's rule count doesn't move: a draft changes nothing yet.",
      say: "Priya saves it, and it joins the team's list as a draft under Priya's name. Notice the rule count up top doesn't move, because a draft changes nothing yet.",
      waitFor: { selector: ".ecard", text: "Protect customer contact details" },
    },
    {
      target: { selector: ".ecard", text: "Protect customer contact details" },
      action: "click",
      title: "The finished rule, spelled out",
      body: "Opened, it shows what the rule covers: emails and phone numbers sent to AI tools, outside websites, unknown destinations or partners — and the check it relies on.",
      say: "Nice. Opened up, it shows what the rule covers, emails and phone numbers sent to AI tools, outside websites, unknown destinations or partners, plus the check it relies on.",
      waitFor: { within: ".drawer", selector: ".card", text: "requires" },
    },
    {
      target: { within: ".drawer", selector: ".row", text: "Activate" },
      title: "Ready, and still switched off",
      body: "Priya's sentence is now a rule Wrapbox can check. It stays off until someone presses Activate, and Simulate impact lets the team try it safely first.",
      say: "In the end, Priya's own sentence is a rule Wrapbox can check. It stays off until someone presses Activate, and Simulate impact lets the team try it safely first.",
      pad: 10,
    },
  ],
};
export default c;
