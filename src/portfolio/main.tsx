import { createRoot } from "react-dom/client";
import { Deck } from "./deck";

// No StrictMode here: its double-invoked effects interfere with AnimatePresence's
// exit bookkeeping for the slide transitions (the product app keeps StrictMode).
createRoot(document.getElementById("deck")!).render(<Deck />);
