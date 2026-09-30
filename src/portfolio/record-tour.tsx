// The YouTube recording frame: exactly 1920×1080 and filled edge to edge — the
// live product fills the frame (no browser window, no margins, no player
// controls: YouTube brings its own), with the story caption as a full-width
// strip along the bottom and a thin progress line. docs/_record.mjs screen-captures this page and lays the
// narration clips onto the soundtrack at the moments the runner reports.
import { useEffect, useRef, useState } from "react";
import { CHAPTERS } from "./video-tour";
import { WrapboxLogo } from "../ui/logo";
import type { TourCase } from "../tour/types";

// 1080 = 956 app + 124 caption, both full 1920 wide. The app lays out at
// 1600×797 and is scaled ×1.2 (captured at 2× pixel density, so it stays sharp).
const VIEW_W = 1920, VIEW_H = 956;
const SCALE = 1.2;
const APP_W = VIEW_W / SCALE, APP_H = Math.round(VIEW_H / SCALE);

interface TourMsg { type: "wrapbox-tour"; id: string; step: number; status: string; route?: string; narrated?: number; at?: number }
type Rec = (ev: Record<string, unknown>) => void;

export function RecordTour({ tc }: { tc: TourCase }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [go, setGo] = useState(false);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("loading");
  const total = tc.steps.length;

  // The recorder calls window.__wbGo() once capture is running, so the very
  // first narrated line is inside the recording.
  useEffect(() => { (window as unknown as { __wbGo: () => void }).__wbGo = () => setGo(true); }, []);

  useEffect(() => {
    const rec = (window as unknown as { __wbRec?: Rec }).__wbRec;
    const on = (e: MessageEvent) => {
      const d = e.data as TourMsg | null;
      if (!d || d.type !== "wrapbox-tour" || d.id !== tc.id || e.source !== frame.current?.contentWindow) return;
      if (typeof d.narrated === "number") { setStarted(true); rec?.({ narrated: d.narrated, at: d.at }); }
      setStep(d.step); setStatus(d.status);
      if (d.status === "done") rec?.({ done: Date.now() });
      if (d.status === "error") rec?.({ error: d.step });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [tc.id]);

  const done = status === "done";
  const cur = tc.steps[step];
  const chapter = [...CHAPTERS].reverse().find((c) => step >= c.at) ?? CHAPTERS[0];
  const pct = done ? 100 : (step / Math.max(1, total - 1)) * 100;

  return (
    <div className="rv">
      <div className="rv-view" style={{ width: VIEW_W, height: VIEW_H }}>
        {go && (
          <iframe
            ref={frame}
            src={`tour.html?case=${tc.id}&voice=0&nocap=1`}
            title={tc.title}
            width={APP_W}
            height={APP_H}
            style={{ transform: `scale(${SCALE})` }}
            tabIndex={-1}
          />
        )}
        {/* Opening title card, full frame, until the story starts */}
        <div className={`rv-title ${started ? "rv-title-out" : ""}`}>
          <WrapboxLogo size={84} tone="dark" />
          <h1>2 a.m. — the night checkout broke</h1>
          <p>A live walkthrough of Wrapbox, running in the real product</p>
        </div>
      </div>

      <div className="rv-cap">
        <div className="rv-prog"><i style={{ width: `${pct}%` }} /></div>
        <div className="rv-cap-meta">
          <span className="rv-step">{String(Math.min(step + 1, total)).padStart(2, "0")} / {total}</span>
          <span className="rv-chap">{chapter.label}</span>
        </div>
        <div className="rv-cap-text">
          <h2>{done ? "That was Wrapbox" : started ? cur?.title : "Wrapbox"}</h2>
          <p>{done ? tc.outcome : started ? cur?.body : "Runtime authorization for AI agents — every action checked before it runs."}</p>
        </div>
        <div className="rv-brand"><WrapboxLogo size={26} tone="dark" /><span>wrapbox</span></div>
      </div>
    </div>
  );
}
