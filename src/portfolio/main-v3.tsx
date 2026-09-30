import { createRoot } from "react-dom/client";
import { Deck } from "./deck";
import { SLIDES_V2 } from "./slides/index-v2";
import { PasswordGate } from "../ui/password-gate";

// Deck v3 — the same slides as v2 in the pale-blue / soft-yellow editorial look
// (html[data-variant="v3"] in deck.css): square cards, black hairlines, "● Label" headers.
createRoot(document.getElementById("deck")!).render(
  <PasswordGate id="v3" label="Product Portfolio v3">
    <Deck slides={SLIDES_V2} showNumber={false} />
  </PasswordGate>
);
