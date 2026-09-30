// The demo player — a Netflix-style watch page for one long TourCase.
// A dark cinematic page; the live product runs inside the shared Chrome-style
// browser window; the scrubber + transport sit ON the video in a bottom scrim
// that auto-hides while playing and returns on mouse move or pause (the
// standard video-player behaviour); the story caption sits in a bar BELOW the
// video so it never covers the app; a dark chapters drawer lists the scenes.
// Timecodes come from the narration clips' real lengths (voice.json).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX, ListVideo, Check, X } from "lucide-react";
import type { SlideProps } from "./deck";
import { SHOT } from "./ui";
import { photoOf } from "../ui/logos";
import { BrowserChrome } from "./browser-chrome";
import type { TourCase } from "../tour/types";
import VOICE from "../tour/voice.json";

const APP_W = 1440, APP_H = 810;
const STAGE_H = 540;
const SCALE = STAGE_H / APP_H;
const STAGE_W = Math.round(APP_W * SCALE);

const VOICE_KEY = "wrapbox-deck-voice";
function readVoicePref(): boolean { try { return localStorage.getItem(VOICE_KEY) !== "0"; } catch { return true; } }

interface TourMsg { type: "wrapbox-tour"; id: string; step: number; total: number; status: string; error?: string; route?: string; voiceBlocked?: boolean }

// The story's scenes — one entry per chapter of the 2 a.m. incident.
export const CHAPTERS: { at: number; label: string }[] = [
  { at: 0, label: "2:14 — Checkout is down" },
  { at: 1, label: "Priya opens Wrapbox" },
  { at: 3, label: "The rules" },
  { at: 6, label: "Test, don't guess" },
  { at: 10, label: "A safety update" },
  { at: 17, label: "The fix job" },
  { at: 21, label: "Alex's scoped yes" },
  { at: 26, label: "The wrong database" },
  { at: 31, label: "The trap" },
  { at: 37, label: "Agents helping agents" },
  { at: 41, label: "Inside the tool calls" },
  { at: 46, label: "Alex says no" },
  { at: 48, label: "The kill switch" },
  { at: 58, label: "The refunds" },
  { at: 67, label: "The agent that lied" },
  { at: 73, label: "Supplier agents" },
  { at: 80, label: "Every doorway" },
  { at: 88, label: "The Token Vault" },
  { at: 93, label: "Break glass" },
  { at: 101, label: "Tighten the screws" },
  { at: 106, label: "The map of the night" },
  { at: 108, label: "The honest scorecard" },
  { at: 110, label: "Proof" },
  { at: 114, label: "Wrapbox learns" },
  { at: 117, label: "One brain" },
  { at: 120, label: "Dawn" },
];

// The app's own route names, shown in the browser chrome's address bar.
const PAGE: Record<string, string> = {
  start: "Get started", control: "Control Room", live: "Live Actions", agents: "Agents", tasks: "Tasks",
  intent: "Intent Studio", safety: "Safety Kernel", simulator: "Policy Simulator", reviews: "Review Center",
  standing: "Standing Permissions", breakglass: "Break Glass", coverage: "Coverage Map", trust: "Trust Graph",
  evidence: "Evidence", simlab: "Simulation Lab", integrations: "Integrations", vault: "Token Vault",
  brain: "Core Brain", settings: "Settings", onboarding: "Setup",
};
export const pageOf = (route: string) => PAGE[route.split("/")[0]] ?? "Wrapbox";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function VideoTour({ tc, active }: { tc: TourCase } & SlideProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [run, setRun] = useState({ key: 0, from: 0 });
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("loading");
  const [route, setRoute] = useState(tc.start);
  const [voice, setVoice] = useState(readVoicePref);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [osd, setOsd] = useState(true);
  const osdTimer = useRef<number | undefined>(undefined);
  const total = tc.steps.length;

  // Timecodes from the narration manifest; a silent step is estimated from its
  // text, mirroring the player's own pacing.
  const clipMs = useMemo(() => {
    const clips = (VOICE as { cases: Record<string, { ms: number }[]> }).cases[tc.id] ?? [];
    return tc.steps.map((st, i) => {
      const ms = clips[i]?.ms ?? 0;
      if (ms > 0) return ms;
      const words = `${st.title} ${st.body}`.split(/\s+/).length;
      return Math.min(9500, Math.max(3400, 1100 + words * 240)) + (st.hold ?? 1400);
    });
  }, [tc]);
  const cum = useMemo(() => {
    const out: number[] = [0];
    for (const ms of clipMs) out.push(out[out.length - 1] + ms);
    return out;
  }, [clipMs]);
  const totalSec = cum[cum.length - 1] / 1000;
  const elapsedSec = cum[Math.min(step, total)] / 1000;
  const progressPct = totalSec > 0 ? Math.min(100, (elapsedSec / totalSec) * 100) : 0;

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as TourMsg | null;
      if (!d || d.type !== "wrapbox-tour" || d.id !== tc.id || e.source !== frame.current?.contentWindow) return;
      if (d.route) setRoute(d.route);
      if (typeof d.voiceBlocked === "boolean") setVoiceBlocked(d.voiceBlocked);
      if (SHOT) return;
      setStep(d.step); setStatus(d.status);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [tc.id]);

  const send = useCallback((cmd: string) => frame.current?.contentWindow?.postMessage({ type: "wrapbox-tour-cmd", cmd }, "*"), []);
  const restartAt = useCallback((i: number) => { setStep(i); setStatus("loading"); setRun((r) => ({ key: r.key + 1, from: Math.min(Math.max(0, i), total - 1) })); }, [total]);
  const toggleVoice = useCallback(() => {
    const on = voiceBlocked ? true : !voice;
    setVoice(on); setVoiceBlocked(false);
    try { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); } catch { /* private mode */ }
    send(on ? "voice-on" : "voice-off");
  }, [voice, voiceBlocked, send]);

  const done = status === "done" && !SHOT;
  const paused = status === "paused";
  const playing = !paused && !done && status !== "loading";

  // Controls behave like a video player: always there when paused, loading or
  // finished; while playing they fade out after a moment and any mouse
  // movement over the video brings them back.
  const wake = useCallback(() => {
    setOsd(true);
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(false), 2600);
  }, []);
  useEffect(() => {
    if (!playing) { setOsd(true); window.clearTimeout(osdTimer.current); return; }
    wake();
    // The app iframe swallows mouse events, so a hot-zone over its bottom edge
    // (in the JSX) and any movement on the page itself both re-show the bar.
    const onMove = () => wake();
    window.addEventListener("mousemove", onMove);
    return () => { window.clearTimeout(osdTimer.current); window.removeEventListener("mousemove", onMove); };
  }, [playing, wake]);
  const osdShown = osd || !playing || chaptersOpen;

  // P / space play-pause, M sound, ← → previous / next. Keys inside the iframe
  // arrive as messages, so both surfaces work.
  useEffect(() => {
    const act = (k: string) => {
      if (k === "p" || k === "P" || k === " ") send("toggle");
      if (k === "m" || k === "M") toggleVoice();
      if (k === "ArrowRight") restartAt(Math.min(total - 1, step + 1));
      if (k === "ArrowLeft") restartAt(Math.max(0, step - 1));
    };
    const on = (e: KeyboardEvent) => act(e.key);
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; key?: string } | null; if (d?.type === "wrapbox-tour-key" && d.key) act(d.key); };
    window.addEventListener("keydown", on); window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("keydown", on); window.removeEventListener("message", onMsg); };
  }, [send, toggleVoice, restartAt, step, total]);

  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // A standalone HTML build can set window.__WB_TOUR_BASE__ to an absolute
  // URL so the tour app + audio load from there, letting one file run anywhere.
  const base = (typeof window !== "undefined" && (window as unknown as { __WB_TOUR_BASE__?: string }).__WB_TOUR_BASE__) || "";
  const src = useMemo(() => SHOT
    ? `${base}tour.html?case=${tc.id}&shot=${Math.min(tc.poster ?? 1, total - 1)}&after=1&nocap=1`
    : `${base}tour.html?case=${tc.id}&voice=${voiceRef.current ? 1 : 0}&nocap=1${run.from ? `&from=${run.from}` : ""}`,
  [tc.id, run, total, base]);
  const cur = tc.steps[step];

  const currentChapter = [...CHAPTERS].reverse().find((c) => step >= c.at) ?? CHAPTERS[0];
  const person = tc.persona;
  const face = photoOf(person.userId);
  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");

  return (
    <div className="vt">
      {/* The live product inside the shared Chrome-style browser window */}
      <div className="vt-stage" style={{ width: STAGE_W }} onMouseMove={playing ? wake : undefined}>
        <BrowserChrome
          page={pageOf(route)}
          right={
            <span className="vt-guide">
              {face ? <img src={face} alt="" /> : <span className="vt-face-mono">{initials}</span>}
              <b>{person.name}</b>
            </span>
          }
        />
        <div className="vt-view" style={{ height: STAGE_H }}>
          {active && (
            <iframe
              key={run.key}
              ref={frame}
              src={src}
              title={`${tc.title} — live tour`}
              width={APP_W}
              height={APP_H}
              allow="autoplay"
              style={{ transform: `scale(${SCALE})` }}
              tabIndex={-1}
            />
          )}

          {/* Invisible strip over the video's bottom edge: hovering it brings
              the controls back (the iframe itself swallows mouse events) */}
          <div className="vt-hotzone" onMouseMove={wake} />
          {/* On-video controls: bottom scrim, auto-hides while playing */}
          <div className={`vt-osd ${osdShown ? "" : "vt-osd-hidden"}`}>
            <div className="vt-osd-scrim" aria-hidden="true" />
            <div className="vt-osd-inner">
              <div className="vt-scrub">
                <div className="vt-track" onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - r.left) / r.width;
                  const targetSec = pct * totalSec;
                  let i = 0;
                  while (i < total - 1 && cum[i + 1] / 1000 < targetSec) i += 1;
                  restartAt(i);
                }}>
                  <div className="vt-bar" style={{ width: `${progressPct}%` }} />
                  {CHAPTERS.slice(1).map((c) => (
                    <span key={c.label} className="vt-mark-tick" style={{ left: `${totalSec > 0 ? (cum[Math.min(c.at, total)] / 1000 / totalSec) * 100 : 0}%` }} title={c.label} />
                  ))}
                  <span className="vt-thumb" style={{ left: `${progressPct}%` }} />
                </div>
                <div className="vt-time">{fmt(elapsedSec)} <span className="vt-time-sep">/</span> {fmt(totalSec)}</div>
              </div>
              <div className="vt-transport">
                <div className="vt-transport-l">
                  <button className="vt-t-play" onClick={() => (done ? restartAt(0) : send("toggle"))} title="Play / pause (P, space)">
                    {done ? <RotateCcw size={19} /> : paused || status === "loading" ? <Play size={19} /> : <Pause size={19} />}
                  </button>
                  <button className="vt-t-btn" onClick={() => restartAt(Math.max(0, step - 1))} title="Previous step (←)"><SkipBack size={15} /></button>
                  <button className="vt-t-btn" onClick={() => restartAt(Math.min(total - 1, step + 1))} title="Next step (→)"><SkipForward size={15} /></button>
                  <button className="vt-t-btn" onClick={() => restartAt(0)} title="Restart"><RotateCcw size={14} /></button>
                  <button className={`vt-voice ${voice && voiceBlocked ? "ask" : ""}`} onClick={toggleVoice} title={voice ? "Narration on — AI voice (M)" : "Narration off (M)"}>
                    {voice && !voiceBlocked ? <Volume2 size={15} /> : <VolumeX size={15} />}
                    {voice && voiceBlocked && <span>Tap for voice</span>}
                  </button>
                </div>
                <div className="vt-transport-r">
                  <span className="vt-osd-title">{tc.title}</span>
                  <button className="vt-chip vt-chap" onClick={() => setChaptersOpen((v) => !v)} title="Scenes">
                    <ListVideo size={13} /> {currentChapter.label}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scenes drawer — dark, like an episodes panel */}
        {chaptersOpen && (
          <div className="vt-chapters" onClick={() => setChaptersOpen(false)}>
            <div className="vt-chapters-inner" onClick={(e) => e.stopPropagation()}>
              <div className="vt-chapters-head">
                <span>Scenes</span>
                <button onClick={() => setChaptersOpen(false)} aria-label="Close"><X size={14} /></button>
              </div>
              <ol className="vt-chapters-list">
                {CHAPTERS.map((c, i) => {
                  const isCur = c.label === currentChapter.label;
                  const past = step >= (CHAPTERS[i + 1]?.at ?? total);
                  return (
                    <li key={c.label} className={`${isCur ? "cur" : ""} ${past ? "past" : ""}`} onClick={() => { restartAt(c.at); setChaptersOpen(false); }}>
                      <span className="vt-chapters-no">{past ? <Check size={11} strokeWidth={3} /> : (i + 1).toString().padStart(2, "0")}</span>
                      <span className="vt-chapters-lb">{c.label}</span>
                      <span className="vt-chapters-t">{fmt(cum[Math.min(c.at, total)] / 1000)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Story caption UNDER the video — never covers the app */}
      <div className="vt-capbar" style={{ width: STAGE_W }}>
        <div className="vt-capbar-meta">
          <span className="cap-step">Step {Math.min(step + 1, total)} / {total}</span>
          <span className="cap-chap">{currentChapter.label}</span>
        </div>
        <div className="vt-capbar-text">
          <h2 className="cap-title">{done ? "That was Wrapbox" : cur?.title}</h2>
          <p className="cap-body">{done ? tc.outcome : cur?.body}</p>
        </div>
      </div>
    </div>
  );
}
