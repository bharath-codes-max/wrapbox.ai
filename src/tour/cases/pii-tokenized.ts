import type { TourCase } from "../types";

// Priya sends a customer list to the company's approved AI. Wrapbox lets it go,
// but swaps the emails and phone numbers for tokens on the way out, and locks
// the real values in the Token Vault under their tokens.
const c: TourCase = {
  id: "pii-tokenized",
  order: 75,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "Share customer data safely",
  goal: "Priya, a Wrapbox admin, wants proof that customer contact details stay inside Veridian when a customer list is sent to the company's approved AI.",
  outcome: "The file reached the AI with emails and phone numbers swapped for stand-ins, and the real values are locked in the Token Vault, where only Veridian staff can swap them back.",
  start: "simlab/network",
  poster: 6,
  steps: [
    {
      target: { selector: ".stream-item", text: "Customer PII → approved AI" },
      action: "click",
      title: "Replay an everyday moment",
      body: "Priya replays an everyday moment: a customer list with PII (personal details) going to the approved AI. The forecast is CONSTRAIN: allowed, but changed first.",
      say: "Priya, a Wrapbox admin, wants proof customer contact details stay inside Veridian. So Priya replays a customer list going to the approved AI, and it's forecast as allowed, but changed first.",
      waitFor: { selector: ".card", text: "Expected under the brief" },
    },
    {
      target: ".reality > div:first-child",
      title: "What Priya is about to send",
      body: "Priya asks the approved AI to draft renewal emails and attaches customers.csv. Below is the file itself: three customers, with their emails and phone numbers marked in red.",
      say: "Priya asks the approved AI to draft renewal emails and attaches customers dot C-S-V. Just below is the file itself: three customers, their emails and phone numbers marked in red.",
    },
    {
      target: { selector: "button", text: "Run", exact: true },
      action: "click",
      title: "Priya presses Send",
      body: "Run plays Priya pressing Send in the AI chat. Before the file leaves Priya's laptop, Wrapbox stops it for a check.",
      say: "Okay, Run plays Priya pressing Send in the AI chat. And before the file ever leaves Priya's laptop, Wrapbox stops it for a check.",
      waitFor: { selector: ".pipe-stage", text: "intercepts traffic" },
      hold: 2600,
      pad: 0,
    },
    {
      target: { selector: ".pipe-stage", text: "Content inspection" },
      title: "Wrapbox reads what's inside",
      body: "Wrapbox opens the file and finds personal details about real people: three customer names, three email addresses and three phone numbers.",
      say: "First, Wrapbox opens the file and finds personal details about real people: three customer names, three email addresses, and three phone numbers.",
      pad: 0,
    },
    {
      target: { selector: ".pipe-stage", text: "Core Brain evaluation" },
      title: "The stricter rule wins",
      body: "Wrapbox's rule checker, Core Brain, finds two company rules. One allows approved AI for normal work; the other says customer emails and phones must be swapped out first.",
      say: "Core Brain, Wrapbox's rule checker, finds two company rules, and the stricter one wins. One allows approved AI for normal work, and the other says emails and phones get swapped out first.",
      pad: 0,
    },
    {
      target: { selector: ".pipe-stage", text: "Transform applied" },
      title: "Allowed, but changed on the way",
      body: "The decision is CONSTRAIN: the file still goes, but each email and phone number becomes a token, a harmless stand-in Wrapbox can swap back later.",
      say: "So the decision is allowed, but changed on the way. The file still goes, but each email and phone number becomes a token, a harmless stand-in Wrapbox can swap back later.",
      pad: 0,
    },
    {
      target: { selector: ".chat-bubble", text: "Delivered — protected" },
      title: "What the AI actually received",
      body: "Names stay, so the AI can still draft each renewal message; emails and phone numbers arrive as tokens. The original file, below, never left Priya's laptop.",
      say: "Here's what the AI actually got. Names stay, so it can still draft each renewal, but emails and phone numbers arrive as stand-ins, and the original never left Priya's laptop.",
    },
    {
      target: { selector: ".rail-item", text: "Token Vault" },
      action: "click",
      title: "Real values locked in the vault",
      body: "Wrapbox keeps each real email and phone number in its Token Vault. The AI writes back using the tokens, so work carries on without the real details.",
      say: "Wrapbox keeps each real email and phone number locked in its Token Vault. The AI writes back using the stand-ins, so work carries on without the real details.",
      waitFor: { selector: ".card", text: "Sent to the AI" },
    },
    {
      target: { selector: "button", text: "Vault contents" },
      action: "click",
      title: "Every stand-in, on record",
      body: "Vault contents lists every value Wrapbox has swapped out, newest first. This run's six sit at the top, starting with PHONE_TOKEN_012.",
      say: "Vault contents lists every value Wrapbox has swapped out, newest first. This run's six sit right at the top, starting with phone token zero one two.",
      waitFor: { selector: ".ecard", text: "PHONE_TOKEN_012" },
    },
    {
      target: { selector: ".ecard", text: "PII.EMAIL" },
      title: "Only Veridian can swap it back",
      body: "Each token names the run that created it (evt-00021) and can be swapped back only for Veridian staff, for 30 days. Even here, the address stays masked.",
      say: "Each stand-in names the run that made it, event twenty-one, and the address stays masked even here. Only Veridian staff can swap it back, and only for thirty days.",
    },
  ],
};
export default c;
