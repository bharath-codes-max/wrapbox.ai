import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PasswordGate } from "./ui/password-gate";
import "./styles/app.css";
// Desktop design system, both themes — the live prototype only (the decks, demo and video never load it).
import "./styles/desktop.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PasswordGate id="main" label="Wrapbox">
      <App />
    </PasswordGate>
  </React.StrictMode>
);
