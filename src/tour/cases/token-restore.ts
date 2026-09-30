import type { TourCase } from "../types";

// Jordan checks who can see a customer email that Wrapbox hid from an outside AI:
// Token Vault → the round trip (the seeded "Customer PII → approved AI" event,
// where Priya's customer list went to the approved AI with emails tokenized) →
// restore for a requester inside Veridian (allowed) and for the outside AI
// (denied) → both attempts in the restore log. In this prototype "inside" and
// "outside" are the two requester cards on the page (a choice Jordan tries),
// not a live identity check — step 4 frames it as trying both requesters.
const c: TourCase = {
  id: "token-restore",
  order: 80,
  persona: { userId: "u-jordan", name: "Jordan Lee", role: "Support Lead" },
  title: "Who can see a hidden email",
  goal: "Jordan's support team emails customers, so Jordan wants to know who can see a customer's real address after Wrapbox hid it from an outside AI.",
  outcome: "Jordan sees the same token turned back into the real email for Priya inside Veridian, denied to the outside AI, and both attempts written to the restore log.",
  start: "control",
  poster: 6,
  steps: [
    {
      target: { selector: ".rail-item", text: "Token Vault" },
      action: "click",
      title: "Open the Token Vault",
      body: "Jordan's support team emails customers. Jordan wants to know who can see a customer's real email once Wrapbox has hidden it from an outside AI.",
      say: "Jordan's support team emails customers. So Jordan opens the Token Vault to find out who can see a customer's real email once Wrapbox has hidden it from an outside AI.",
      waitFor: ".page-head",
    },
    {
      target: { selector: ".g3 > .card", text: "1 · Sent to the AI" },
      title: "The AI only saw a stand-in",
      body: "Earlier, Priya sent a customer list to an approved AI service outside Veridian. On the way out, Wrapbox swapped each email for a stand-in called a token.",
      say: "Earlier, Priya sent a customer list to an approved AI outside Veridian. On the way out, Wrapbox swapped each email for a stand-in called a token, and that's all the AI saw.",
    },
    {
      target: { selector: ".g3 > .card", text: "2 · The AI's reply" },
      title: "The reply uses the stand-in",
      body: "The AI wrote its reply with the token where the customer's email belongs. To send it, someone at Veridian needs the real address back.",
      say: "The AI wrote its reply with that token where the customer's email belongs. To actually send it, someone at Veridian needs the real address back.",
    },
    {
      target: { selector: "button[role=tab]", text: "Who gets it back" },
      action: "click",
      title: "Same token, two requesters",
      body: "This tab lets Jordan try one token with two requesters: Priya, who works inside Veridian, and the outside AI that received it.",
      say: "Here's the cool part: Jordan can try the same token with two requesters. One is Priya, inside Veridian, and the other is the outside AI that received it.",
      waitFor: ".ecard-grid",
    },
    {
      target: { selector: ".ecard:nth-child(1) button", text: "Restore", exact: true },
      action: "click",
      title: "First, a request from inside",
      body: "Restore asks Wrapbox to swap the token back for the real email. Wrapbox checks that the requester is inside Veridian and the token is still valid.",
      say: "First, a request from inside. Restore asks Wrapbox to swap the token back for the real email, and Wrapbox checks the requester is inside Veridian and the token's still valid.",
      waitFor: { selector: ".ecard", text: "ALLOWED" },
    },
    {
      target: ".ecard[data-tone=allow] .ecard-body",
      title: "The real email comes back",
      body: "Allowed: Priya gets the reply with the customer's real address. This page shows it masked, so the address itself never appears here.",
      say: "Nice, it's allowed. Priya gets the reply with the customer's real address, and this page shows it masked, so the address itself never appears here.",
    },
    {
      target: { selector: ".ecard:nth-child(2) button", text: "Restore", exact: true },
      action: "click",
      title: "Now the outside AI asks",
      body: "The AI that received the token asks for the real email. Denied: outside parties only ever hold tokens, so the AI keeps seeing the stand-in.",
      say: "Now the outside AI that received the token asks for the real email. It's denied, because outside parties only ever hold tokens, so the AI keeps seeing the stand-in.",
      waitFor: { selector: ".ecard", text: "DENIED" },
      placement: "top",
    },
    {
      target: { selector: "button[role=tab]", text: "Restore log" },
      action: "click",
      title: "Both attempts are on record",
      body: "Every request for a real value is logged, allowed or denied: who asked, when, the answer and why. “PII.EMAIL” means a personal email address.",
      say: "So, same token, two answers, and both attempts are on record. Every request for a real value is logged, allowed or denied, with who asked, when, the answer and why.",
      waitFor: ".ecard-grid",
    },
  ],
};
export default c;
