// Walkthrough entry (tour.html): the real Wrapbox app + the walkthrough layer.
//   tour.html?case=<id>            play the case at presentation pace
//   tour.html?case=<id>&from=N     fast-forward to step N, then play
//   tour.html?case=<id>&check=1    run every step instantly, print JSON results
//   tour.html?case=<id>&shot=N     freeze on step N's spotlight (add &after=1 to show its result)
//   &speed=0.5                     play twice as fast (authoring)
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../App";
import "../styles/app.css";
import "./tour.css";
import { CASES, caseById } from "./cases";
import type { TourCase } from "./types";
import { Runner, runSetup, type Mode } from "./runner";
import { TourOverlay } from "./overlay";
import { overlay } from "./overlay-store";

const q = new URLSearchParams(location.search);
const mode: Mode = q.has("check") ? "check" : q.has("shot") ? "shot" : "play";
const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.has(k) ? v : d; };

// Cases being written live in cases/drafts and load on demand, so a draft with a
// mistake only breaks itself — never the finished cases or the deck.
const drafts = import.meta.glob<{ default: TourCase }>("./cases/drafts/*.ts");
async function loadCase(id: string): Promise<TourCase | null> {
  const done = caseById(id);
  if (done) return done;
  const key = `./cases/drafts/${id}.ts`;
  return drafts[key] ? (await drafts[key]()).default ?? null : null;
}

void (async () => {
const tc = await loadCase(q.get("case") ?? "");
let setupError: string | undefined;
if (tc) {
  try {
    if (tc.workspace === "fresh") runSetup(["fresh"]);
    runSetup(tc.setup);
  } catch (e) { setupError = (e as Error).message; }
  history.replaceState(null, "", `${location.pathname}${location.search}#${tc.start}`);
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
createRoot(document.getElementById("tour")!).render(tc ? <TourOverlay /> : <CaseIndex />);

function CaseIndex() {
  return (
    <div className="tour-layer" style={{ pointerEvents: "auto" }}>
      <div className="tour-dim" />
      <div className="tour-card" style={{ left: "50%", top: 60, transform: "translateX(-50%)", width: 560, maxHeight: "80vh", overflow: "auto" }}>
        <div className="tour-card-step">Live walkthroughs</div>
        <div className="tour-card-title">{CASES.length} journeys through the real product</div>
        <ol className="tour-card-body" style={{ paddingLeft: 20 }}>
          {CASES.map((c) => <li key={c.id} style={{ margin: "6px 0" }}><a href={`?case=${c.id}`}>{c.title}</a> <span style={{ color: "#6c6a64" }}>— {c.persona.name}, {c.persona.role}</span></li>)}
        </ol>
      </div>
    </div>
  );
}

if (tc) {
  const runner = new Runner(tc, { mode, speed: mode === "play" ? num("speed", 1) : 0, from: num("from", 0), shot: num("shot", 0), shotAfter: q.has("after"), voice: mode === "play" && q.get("voice") !== "0" });
  (window as unknown as { __tour: Runner }).__tour = runner;

  // The deck drives play / pause.
  window.addEventListener("message", (e) => {
    const d = e.data as { type?: string; cmd?: string } | null;
    if (!d || d.type !== "wrapbox-tour-cmd") return;
    if (d.cmd === "pause") runner.pause(); else if (d.cmd === "play") runner.play(); else if (d.cmd === "toggle") runner.toggle();
    else if (d.cmd === "voice-on") runner.setVoice(true); else if (d.cmd === "voice-off") runner.setVoice(false);
  });
  // Embedded: deck shortcuts keep working even when focus is inside the app.
  if (window.parent !== window) {
    window.addEventListener("keydown", (e) => {
      if (!e.isTrusted) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End", " ", "f", "F", "t", "T", "p", "P"].includes(e.key)) {
        e.preventDefault();
        window.parent.postMessage({ type: "wrapbox-tour-key", key: e.key }, "*");
      }
    }, true);
  }

  const errors: string[] = [];
  if (setupError) errors.push(`setup: ${setupError}`);
  window.addEventListener("error", (e) => errors.push(String(e.message)));
  const origError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ").slice(0, 300)); origError(...a); };

  setTimeout(async () => {
    const results = await runner.run();
    if (mode === "check") {
      const out = { case: tc.id, steps: tc.steps.length, ok: results.every((r) => !r.error) && errors.length === 0, results, errors };
      const pre = document.createElement("pre");
      pre.id = "tour-result";
      pre.textContent = JSON.stringify(out);
      pre.style.display = "none";
      document.body.appendChild(pre);
    }
    if (setupError) overlay.set({ error: `setup: ${setupError}` });
    document.documentElement.dataset.tourReady = "1";
  }, mode === "play" ? 700 : 250);
}
})();
