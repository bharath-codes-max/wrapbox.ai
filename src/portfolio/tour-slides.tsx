// v2 use cases — each one plays inside the real Wrapbox product. The left frame
// is the actual app (tour.html) running a walkthrough: a cursor, typing and
// clicks through the product's own screens, pausing on a spotlight with a
// plain-language card. The right column follows along step by step.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Check, Volume2, VolumeX } from "lucide-react";
import type { SlideProps } from "./deck";
import { Reveal, Display, Lead, SHOT } from "./ui";
import { photoOf } from "../ui/logos";
import { CASES } from "../tour/cases";
import { BrowserChrome } from "./browser-chrome";
import type { TourCase } from "../tour/types";

const APP_W = 1280, APP_H = 800, SCALE = 0.76;

function Face({ userId, name, size = 40 }: { userId: string; name: string; size?: number }) {
  const src = photoOf(userId);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  return src
    ? <img className="lvface" style={{ width: size, height: size }} src={src} alt="" />
    : <span className="lvface lvface-mono" style={{ width: size, height: size }}>{initials}</span>;
}

/* ---------- intro ---------- */
export function LiveIntro() {
  const roles = [...new Set(CASES.map((c) => c.persona.role))];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 22 }}>
      <div>
        <Reveal i={1}><Display sm>{CASES.length} jobs, played live in the real product.</Display></Reveal>
        <Reveal i={2}><Lead style={{ fontSize: 20, marginTop: 12, maxWidth: 1240 }}>Each slide runs the actual Wrapbox app. A cursor does what the person would do, and at every important moment it pauses, lights up that part of the screen and explains it in plain words. A friendly AI voice talks you through it. Press <b>P</b> to pause, <b>M</b> for sound; click any step to jump to it.</Lead></Reveal>
      </div>
      <div className="lvroles">
        {roles.map((role, k) => (
          <Reveal key={role} i={3 + k * 0.3} className="lvrole">
            <div className="lvrole-h">{role}</div>
            {CASES.filter((c) => c.persona.role === role).map((c) => (
              <div key={c.id} className="lvrole-c">
                <Face userId={c.persona.userId} name={c.persona.name} size={26} />
                <span>{c.title}</span>
                <b>{String(CASES.indexOf(c) + 1).padStart(2, "0")}</b>
              </div>
            ))}
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* ---------- one live case ---------- */
interface TourMsg { type: "wrapbox-tour"; id: string; step: number; total: number; status: string; error?: string; route?: string; voiceBlocked?: boolean }

// The page the app is on, by its name in the product's own navigation.
const PAGE: Record<string, string> = {
  start: "Get started", control: "Control Room", live: "Live Actions", agents: "Agents", tasks: "Tasks",
  intent: "Intent Studio", safety: "Safety Kernel", simulator: "Policy Simulator", reviews: "Review Center",
  standing: "Standing Permissions", breakglass: "Break Glass", coverage: "Coverage Map", trust: "Trust Graph",
  evidence: "Evidence", simlab: "Simulation Lab", integrations: "Integrations", vault: "Token Vault",
  brain: "Core Brain", settings: "Settings", onboarding: "Setup",
};
const pageOf = (route: string) => PAGE[route.split("/")[0]] ?? "Wrapbox";

/** Ambient layer behind a live use case: the case's pastel tint as slowly drifting
 *  glows, a faint blueprint grid, and two hairlines that draw themselves in. */
function LiveBackdrop({ tint }: { tint: number }) {
  const second = (tint % 6) + 1;
  return (
    <div className="lvbg" aria-hidden="true">
      <div className="lvbg-grid" />
      <div className="lvbg-blob a" style={{ background: `radial-gradient(closest-side, var(--ice${tint}), transparent)` }} />
      <div className="lvbg-blob b" style={{ background: `radial-gradient(closest-side, var(--ice${second}), transparent)` }} />
      <svg className="lvbg-lines" viewBox="0 0 1600 900" preserveAspectRatio="none">
        <path d="M -40 760 C 260 640, 420 860, 760 720 S 1260 540, 1660 640" />
        <path d="M -40 170 C 300 250, 520 60, 880 150 S 1340 300, 1660 180" />
      </svg>
    </div>
  );
}

const VOICE_KEY = "wrapbox-deck-voice";
function readVoicePref(): boolean { try { return localStorage.getItem(VOICE_KEY) !== "0"; } catch { return true; } }

export function LiveCaseSlide({ tc, n, active }: { tc: TourCase; n: number } & SlideProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [run, setRun] = useState({ key: 0, from: 0 });
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState<string | undefined>();
  const [route, setRoute] = useState(tc.start);
  const [voice, setVoice] = useState(readVoicePref);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const stepsRef = useRef<HTMLOListElement>(null);
  const total = tc.steps.length;
  const poster = Math.min(tc.poster ?? 1, total - 1);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as TourMsg | null;
      if (!d || d.type !== "wrapbox-tour" || d.id !== tc.id || e.source !== frame.current?.contentWindow) return;
      if (d.route) setRoute(d.route);
      if (typeof d.voiceBlocked === "boolean") setVoiceBlocked(d.voiceBlocked);
      if (SHOT) return; // stills keep the poster step; only the page name is taken from the app
      setStep(d.step); setStatus(d.status); setError(d.error);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [tc.id]);

  const send = useCallback((cmd: string) => frame.current?.contentWindow?.postMessage({ type: "wrapbox-tour-cmd", cmd }, "*"), []);
  const restartAt = useCallback((i: number) => { setStep(i); setStatus("loading"); setError(undefined); setRun((r) => ({ key: r.key + 1, from: Math.min(Math.max(0, i), total - 1) })); }, [total]);
  const toggleVoice = useCallback(() => {
    // A click is the gesture browsers need before playing sound; an on-switch while blocked just retries.
    const on = voiceBlocked ? true : !voice;
    setVoice(on); setVoiceBlocked(false);
    try { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); } catch { /* private mode */ }
    send(on ? "voice-on" : "voice-off");
  }, [voice, voiceBlocked, send]);

  // P pauses / resumes, M toggles the voice — typed here or inside the app frame.
  useEffect(() => {
    const act = (k: string) => { if (k === "p" || k === "P") send("toggle"); if (k === "m" || k === "M") toggleVoice(); };
    const on = (e: KeyboardEvent) => act(e.key);
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; key?: string } | null; if (d?.type === "wrapbox-tour-key" && d.key) act(d.key); };
    window.addEventListener("keydown", on); window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("keydown", on); window.removeEventListener("message", onMsg); };
  }, [send, toggleVoice]);

  // The sound setting is read when a run starts; toggling it later is a message, never a reload.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const src = useMemo(() => SHOT
    ? `tour.html?case=${tc.id}&shot=${poster}&after=1`
    : `tour.html?case=${tc.id}&voice=${voiceRef.current ? 1 : 0}${run.from ? `&from=${run.from}` : ""}`,
  [tc.id, poster, run]);
  const shownStep = SHOT ? poster : step;
  // Long tours: keep the current step visible in the (scrollable) list.
  useEffect(() => {
    stepsRef.current?.querySelector("li.cur")?.scrollIntoView({ block: "nearest", behavior: SHOT ? "auto" : "smooth" });
  }, [shownStep]);
  const done = status === "done" && !SHOT;
  const paused = status === "paused";
  const tint = ((n - 1) % 6) + 1;

  // Gentle parallax: the window and the card drift a few pixels against each other.
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (SHOT) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    e.currentTarget.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const onLeave = (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.setProperty("--px", "0"); e.currentTarget.style.setProperty("--py", "0"); };

  return (
    <div className="lvwrap" onMouseMove={onMove} onMouseLeave={onLeave}>
      <LiveBackdrop tint={tint} />
      <Reveal><h1 className="lvtitle">{tc.title}</h1></Reveal>
      <div className="lvbody">
        <Reveal i={1} className="lvframe" style={{ width: APP_W * SCALE }}>
          <BrowserChrome page={pageOf(route)} />
          <div className="lvview" style={{ width: APP_W * SCALE, height: APP_H * SCALE }}>
            {active && (
              <iframe
                key={run.key}
                ref={frame}
                src={src}
                title={`${tc.title} — live walkthrough`}
                width={APP_W}
                height={APP_H}
                allow="autoplay"
                style={{ transform: `scale(${SCALE})` }}
                tabIndex={-1}
              />
            )}
          </div>
        </Reveal>
        <Reveal i={2} className={`lvside lvtint-${tint}`}>
          <div className="lvwho">
            <Face userId={tc.persona.userId} name={tc.persona.name} size={46} />
            <div><b>{tc.persona.name}</b><span>{tc.persona.role}</span></div>
          </div>
          <div className="lvgoal"><span className="label">Why they're here</span><p>{tc.goal}</p></div>
          <ol className="lvsteps" ref={stepsRef}>
            {tc.steps.map((s, i) => {
              const cur = i === shownStep && !done;
              const past = i < shownStep || done;
              return (
                <li key={i} className={`${cur ? "cur" : ""} ${past ? "done" : ""}`} onClick={() => restartAt(i)} title="Play from this step">
                  <span className="lvn">{past ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                  <span className="lvst"><b>{s.title}</b></span>
                </li>
              );
            })}
          </ol>
          {done && <div className="lvout"><span className="label">What they got</span><p>{tc.outcome}</p></div>}
          {error && <div className="lverr">{error}</div>}
          <div className="lvctl">
            <button onClick={() => restartAt(0)} title="Restart"><RotateCcw size={15} /></button>
            <button onClick={() => restartAt(Math.max(0, shownStep - 1))} title="Previous step"><SkipBack size={15} /></button>
            <button className="main" onClick={() => (done ? restartAt(0) : send("toggle"))} title="Play / pause (P)">
              {done ? <><RotateCcw size={15} /> Replay</> : paused ? <><Play size={15} /> Play</> : <><Pause size={15} /> Pause</>}
            </button>
            <button onClick={() => restartAt(Math.min(total - 1, shownStep + 1))} title="Next step"><SkipForward size={15} /></button>
            <button className={`lvvoice ${voice && voiceBlocked ? "ask" : ""}`} onClick={toggleVoice} title={voice ? "Narration on — AI-generated voice (M)" : "Narration off (M)"}>
              {voice && !voiceBlocked ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{voice && voiceBlocked ? "Tap for voice" : "AI voice"}</span>
            </button>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
