import { createRoot } from "react-dom/client";
import { Deck } from "./deck";
import { SLIDES_V2 } from "./slides/index-v2";
import { PasswordGate } from "../ui/password-gate";

// Deck v2 — use cases played live in the real product.
createRoot(document.getElementById("deck")!).render(
  <PasswordGate id="v2" label="Product Portfolio v2">
    <Deck slides={SLIDES_V2} showNumber={false} />
  </PasswordGate>
);
