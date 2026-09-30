// Deck shell — a 1600×900 stage scaled to the viewport, one slide at a time,
// keyboard / touch / hash navigation, light and dark themes, fullscreen, and a
// process rail (Understand → Research → Synthesize → Ideate → Prototype → Test)
// as the only chrome. Slides receive `active` and their `step`.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { SLIDES, type Phase } from "./slides";
import "./deck.css";

export interface SlideProps { active: boolean; step: number }
export interface SlideDef {
  id: string;
  phase: Phase;
  title: string;
  steps?: number;
  Component: (p: SlideProps) => JSX.Element;
}

const STAGE_W = 1600, STAGE_H = 900, CHROME_H = 64;
const THEME_KEY = "wrapbox-deck-theme";

function readHash(count: number): number {
  const m = location.hash.match(/#\/?(\d+)/);
  const n = m ? parseInt(m[1], 10) - 1 : 0;
  return Math.min(Math.max(0, isNaN(n) ? 0 : n), count - 1);
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

function useStageScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, (window.innerHeight - CHROME_H) / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

export function Deck({ slides = SLIDES, showNumber = true, chrome = true }: { slides?: SlideDef[]; showNumber?: boolean; chrome?: boolean }) {
  const SLIDES_ = slides;
  const [idx, setIdx] = useState(() => readHash(SLIDES_.length));
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [theme, toggleTheme] = useTheme();
  const [fs, setFs] = useState(false);
  const scale = useStageScale();
  const slide = SLIDES_[idx];
  const steps = slide.steps ?? 1;
  const shot = document.documentElement.dataset.shot === "1";

  useEffect(() => {
    // A sandboxed preview (e.g. an artifact iframe on a different origin than its
    // own document URL) throws SecurityError on history.replaceState — never let
    // that crash the deck; the hash is a nicety, not a requirement to render.
    try { history.replaceState(null, "", `#/${idx + 1}`); } catch { /* sandboxed preview — hash nav still works via location.hash below */ }
    document.body.dataset.phase = slide.phase;
  }, [idx, slide.phase]);
  useEffect(() => {
    const on = () => { const n = readHash(SLIDES_.length); setDir(n > idx ? 1 : -1); setIdx(n); setStep(0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [idx]);

  const go = useCallback((n: number) => {
    const t = Math.min(Math.max(0, n), SLIDES_.length - 1);
    if (t === idx) return;
    setDir(t > idx ? 1 : -1); setIdx(t); setStep(0);
  }, [idx]);
  const next = useCallback(() => { if (step < steps - 1) setStep(step + 1); else go(idx + 1); }, [step, steps, idx, go]);
  const prev = useCallback(() => { if (step > 0) setStep(step - 1); else go(idx - 1); }, [step, idx, go]);

  useEffect(() => {
    const handle = (key: string): boolean => {
      switch (key) {
        case "ArrowRight": case " ": case "PageDown": case "Enter": next(); return true;
        case "ArrowLeft": case "PageUp": case "Backspace": prev(); return true;
        case "Home": go(0); return true;
        case "End": go(SLIDES_.length - 1); return true;
        case "f": case "F": toggleFullscreen(); return true;
        case "t": case "T": toggleTheme(); return true;
      }
      return false;
    };
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (handle(e.key)) e.preventDefault();
    };
    // A live walkthrough runs the product in an iframe; its keystrokes are forwarded here.
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; key?: string } | null;
      if (d && d.type === "wrapbox-tour-key" && d.key) handle(d.key);
    };
    window.addEventListener("keydown", on);
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("keydown", on); window.removeEventListener("message", onMsg); };
  }, [next, prev, go, toggleTheme]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
    touch.current = null;
  };

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const Cur = slide.Component;
  return (
    <MotionConfig transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} reducedMotion={shot ? "always" : "user"}>
      <div className="viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="stage-box" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
          <div className="stage-scale" style={{ transform: `scale(${scale})` }}>
            <motion.section
              key={slide.id}
              className="stage"
              initial={shot ? false : { opacity: 0, x: 56 * dir }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              aria-roledescription="slide"
              aria-label={`${idx + 1} of ${SLIDES_.length}: ${slide.title}`}
            >
              {showNumber && <span className="stage-num" aria-hidden="true">{String(idx + 1).padStart(2, "0")} / {SLIDES_.length}</span>}
              <div className="stage-inner">
                <Cur active step={step} />
              </div>
            </motion.section>
          </div>
        </div>
      </div>

      {chrome && <footer className="chrome" aria-label="Deck controls">
        <button className="nav" onClick={prev} disabled={idx === 0 && step === 0} aria-label="Previous"><ChevronLeft size={18} /></button>
        <span className="count">{idx + 1} / {SLIDES_.length}</span>
        <div className="dashes" role="tablist" aria-label="Slides">
          {SLIDES_.map((s, i) => (
            <button
              key={s.id}
              className={`dash ${i < idx ? "done" : ""} ${i === idx ? "cur" : ""}`}
              title={`${i + 1} · ${s.title}`}
              onClick={() => go(i)}
              role="tab"
              aria-selected={i === idx}
              aria-label={s.title}
            />
          ))}
        </div>
        <button className="nav" onClick={next} disabled={idx === SLIDES_.length - 1 && step >= steps - 1} aria-label="Next"><ChevronRight size={18} /></button>
        <button className="ico" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"} title="Theme (T)">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="ico" onClick={toggleFullscreen} aria-label={fs ? "Exit fullscreen" : "Fullscreen"} title="Fullscreen (F)">{fs ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </footer>}
      {!chrome && (
        <div className="deck-mini-ctl">
          <button onClick={toggleTheme} title="Theme (T)" aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
          <button onClick={toggleFullscreen} title="Fullscreen (F)" aria-label={fs ? "Exit fullscreen" : "Fullscreen"}>{fs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        </div>
      )}
    </MotionConfig>
  );
}
