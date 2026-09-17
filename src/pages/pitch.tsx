// The pre-seed pitch — a web page, not a deck file, where every section is a
// true 16:9 stage (the proportions of a standard slide) that fills the viewport
// and snaps into place. Built on the product's own design system and, where a
// decision is shown, on the product's REAL policy engine: nothing on these
// stages is a mockup of a verdict.
//
// Sections are added one at a time and reviewed one at a time. TOTAL is the
// agreed count so the counter reads as the whole deck from the first section.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { SURFACES, runAction, type RunResult, type ScenarioAction, type Surface } from "../data/playground";
import { DecisionPill, Logo, cn } from "../components/ui";
import { WrapboxWordmark } from "../components/logo";

const TOTAL = 14;
const EASE = [0.22, 0.61, 0.36, 1] as const;

/* ============================ the stage ============================ */
// A 16:9 box that always fits the viewport, with container-query units so type
// and spacing scale with the stage itself — the same proportions on a laptop,
// a 4K screen, or a projector.
const STAGE: CSSProperties = {
  width: "min(calc(100vw - 3rem), calc((100vh - 5.5rem) * 16 / 9))",
  aspectRatio: "16 / 9",
  containerType: "inline-size",
};

function Stage({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
  return (
    <section id={`s${n}`} className="flex h-screen w-full snap-start snap-always items-center justify-center">
      <div style={STAGE} className={cn("relative overflow-hidden rounded-[1.25cqw] bg-[#070b16] text-white shadow-[0_60px_140px_-40px_rgba(0,0,0,0.8)] ring-1 ring-white/10", className)}>
        {children}
        <div className="pointer-events-none absolute bottom-[2.2cqw] right-[2.6cqw] font-mono text-[0.95cqw] tabular-nums text-white/35">
          {String(n).padStart(2, "0")} / {TOTAL}
        </div>
      </div>
    </section>
  );
}

/** The brand's one signature moment, as a slow aurora behind the cover. */
function Aurora({ reduced }: { reduced: boolean }) {
  const drift = reduced ? {} : { x: [0, 40, -20, 0], y: [0, -30, 20, 0] };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div animate={drift} transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }} className="absolute -left-[10%] top-[-20%] h-[90%] w-[60%] rounded-full opacity-[0.55] blur-[80px]" style={{ background: "radial-gradient(closest-side, #ff6a3d 0%, rgba(255,106,61,0) 70%)" }} />
      <motion.div animate={reduced ? {} : { x: [0, -50, 30, 0], y: [0, 30, -20, 0] }} transition={{ duration: 34, repeat: Infinity, ease: "easeInOut" }} className="absolute right-[-15%] top-[-10%] h-[95%] w-[65%] rounded-full opacity-[0.5] blur-[90px]" style={{ background: "radial-gradient(closest-side, #9a82f7 0%, rgba(154,130,247,0) 70%)" }} />
      <motion.div animate={reduced ? {} : { x: [0, 30, -30, 0] }} transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-[-30%] left-[25%] h-[80%] w-[55%] rounded-full opacity-[0.35] blur-[100px]" style={{ background: "radial-gradient(closest-side, #ff9fcf 0%, rgba(255,159,207,0) 70%)" }} />
      {/* a fine grid, the way the product's own dark surfaces read */}
      <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)", backgroundSize: "4cqw 4cqw" }} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,#070b16_90%)]" />
    </div>
  );
}

/* ============================ 01 · cover ============================ */
// The stream on the right is the product doing its job, live: each card is a
// real action from the playground, decided by runAction() the moment it is
// shown. The latency printed is measured, not typed.
const STREAM_IDS = ["pg-cursor-force", "pg-cli-dotenv", "pg-cli-hotfix-main", "pg-cli-tests", "pg-browser-upload-pii", "pg-db-update", "pg-stripe-50000", "pg-desktop-gcloud"];

interface Shown {
  key: number;
  surface: Surface;
  action: ScenarioAction;
  run: RunResult;
  ms: number;
}

const statementOf = (a: ScenarioAction) => a.act.command ?? a.act.sql ?? a.act.path ?? a.act.destination ?? a.label;

function useDecisionStream(reduced: boolean) {
  const pool = useMemo(
    () =>
      STREAM_IDS.map((id) => {
        const surface = SURFACES.find((s) => s.actions.some((a) => a.id === id))!;
        const action = surface.actions.find((a) => a.id === id)!;
        return { surface, action };
      }),
    [],
  );
  const [shown, setShown] = useState<Shown[]>([]);
  const i = useRef(0);
  useEffect(() => {
    const push = () => {
      const { surface, action } = pool[i.current % pool.length];
      const t0 = performance.now();
      const run = runAction(action);
      const ms = performance.now() - t0;
      i.current += 1;
      setShown((prev) => [{ key: i.current, surface, action, run, ms }, ...prev].slice(0, 3));
    };
    push();
    const t = setInterval(push, reduced ? 3200 : 2100);
    return () => clearInterval(t);
  }, [pool, reduced]);
  return shown;
}

function DecisionStream({ reduced }: { reduced: boolean }) {
  const shown = useDecisionStream(reduced);
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-[0.9cqw] overflow-hidden">
      <AnimatePresence initial={false}>
        {[...shown].reverse().map((s, idx, arr) => {
          const age = arr.length - 1 - idx; // 0 = newest
          return (
            <motion.div
              key={s.key}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: age === 0 ? 1 : Math.max(0.28, 0.8 - age * 0.22), y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, transition: { duration: 0.25 } }}
              transition={reduced ? { duration: 0.01 } : { duration: 0.5, ease: EASE }}
              className="rounded-[1cqw] border border-white/10 bg-white/[0.06] p-[1.1cqw] backdrop-blur-md"
            >
              <div className="flex items-center gap-[0.7cqw]">
                {s.surface.logo ? <Logo name={s.surface.logo} size={22} rounded="rounded-[6px]" /> : <span className="size-[1.6cqw] rounded-[6px] bg-white/15" />}
                <span className="text-[1.05cqw] font-semibold text-white/90">{s.run.agent}</span>
                <span className="ml-auto font-mono text-[0.85cqw] text-white/40">
                  {s.run.verdict.rule} · {s.ms < 1 ? "<1" : s.ms.toFixed(0)} ms
                </span>
              </div>
              <div className="mt-[0.6cqw] truncate font-mono text-[1cqw] text-white/75">{statementOf(s.action)}</div>
              <div className="mt-[0.7cqw] flex items-center gap-[0.7cqw]">
                <DecisionPill d={s.run.verdict.decision} />
                <span className="truncate text-[0.95cqw] text-white/55">{s.run.rewritten ? `rewritten → ${s.run.rewritten}` : s.run.verdict.title}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      </div>
      <div className="mt-[1cqw] flex shrink-0 items-center gap-[0.6cqw] text-[0.9cqw] text-white/45">
        <span className="size-[0.55cqw] rounded-full bg-[#3fd49b] live-dot" />
        Decided by the real Wrapbox engine, as you watch. Nothing here is a mockup.
      </div>
    </div>
  );
}

function Words({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const reduced = !!useReducedMotion();
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={reduced ? { duration: 0.01 } : { duration: 0.7, delay: delay + i * 0.07, ease: EASE }}
          className="inline-block mr-[0.28em]"
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

function Cover() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={1}>
      <Aurora reduced={reduced} />
      {/* the prism hairline — the one brand mark that recurs across the product */}
      <div className="prism-swatch absolute inset-x-0 top-0 h-[0.35cqw]" />

      <div className="relative flex h-full flex-col p-[3.2cqw]">
        <header className="flex items-center justify-between">
          <WrapboxWordmark tone="dark" size={22} />
          <span className="rounded-full border border-white/15 bg-white/[0.05] px-[1cqw] py-[0.35cqw] font-mono text-[0.85cqw] uppercase tracking-[0.14em] text-white/70">Pre-seed · 2026</span>
        </header>

        <div className="grid flex-1 grid-cols-[1.15fr_0.85fr] items-center gap-[4cqw]">
          <div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="font-mono text-[0.95cqw] uppercase tracking-[0.18em] text-[#9db6ff]">
              Runtime authorization for AI agents
            </motion.div>
            <h1 className="mt-[1.4cqw] text-[5.4cqw] font-medium leading-[1.02] tracking-[-0.035em]" style={{ fontFamily: "var(--font-brand)" }}>
              <Words text="Wrapbox puts every AI agent" delay={0.2} />
              <br />
              <Words text="on a permit." delay={0.65} className="text-white/45" />
            </h1>
            <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 1.2, ease: EASE }} className="mt-[1.8cqw] max-w-[36ch] text-[1.45cqw] leading-relaxed text-white/70">
              Every risky action an agent takes — checked, signed and proven, milliseconds before it runs.
            </motion.p>
          </div>

          <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.9, ease: EASE }} className="h-[30cqw] self-center">
            <DecisionStream reduced={reduced} />
          </motion.div>
        </div>

        <footer className="flex items-end justify-between text-[0.95cqw] text-white/45">
          <div>
            <span className="text-white/80">Wrapbox Inc.</span> · Bharath Kumar Salla · wrapbox.io
          </div>
          <motion.a href="#s2" animate={reduced ? {} : { y: [0, 5, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} className="mr-[6cqw] inline-flex items-center gap-[0.5cqw] text-white/45 hover:text-white">
            <ArrowDown className="size-[1.1cqw]" /> scroll
          </motion.a>
        </footer>
      </div>
    </Stage>
  );
}

/* ============================ the page ============================ */
export function Pitch() {
  // The deck is dark by design; pin the dark tokens so shared atoms (pills,
  // chips) resolve to their dark palette, and restore the app's setting on exit.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (prev === undefined) delete root.dataset.theme;
      else root.dataset.theme = prev;
    };
  }, []);

  // ← → / PgUp / PgDn / space step through stages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = ["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key) ? 1 : ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const cur = Math.round(window.scrollY / window.innerHeight);
      const next = Math.min(TOTAL - 1, Math.max(0, cur + dir));
      document.getElementById(`s${next + 1}`)?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-screen snap-y snap-mandatory overflow-y-auto bg-[#03050c] scroll-thin" style={{ fontFamily: "var(--font-sans)" }}>
      <Cover />
    </div>
  );
}

export default Pitch;
