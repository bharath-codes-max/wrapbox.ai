// The pre-seed pitch — a web page, not a deck file, where every section is a
// true 16:9 stage (the proportions of a standard slide) that fills the viewport
// and snaps into place. It is built on the landing page's own look — the same
// light ground, type, prism backdrop and framed windows — and, where a decision
// is shown, on the product's REAL policy engine: nothing here mocks a verdict.
//
// Sections are added one at a time and reviewed one at a time. TOTAL is the
// agreed count so the counter reads as the whole deck from the first section.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { SURFACES, runAction, type RunResult, type ScenarioAction, type Surface } from "../data/playground";
import { DecisionPill, Logo, cn } from "../components/ui";
import { WrapboxLockup } from "../components/logo";

const TOTAL = 14;
const EASE = [0.2, 0.7, 0.2, 1] as const; // the landing page's ease

/* ============================ the stage ============================ */
// A 16:9 box that always fits the viewport, with container-query units so type
// and spacing scale with the stage itself — the same proportions on a laptop,
// a 4K screen, or a projector.
const STAGE: CSSProperties = {
  width: "min(calc(100vw - 3rem), calc((100vh - 5rem) * 16 / 9))",
  aspectRatio: "16 / 9",
  containerType: "inline-size",
};

function Stage({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
  return (
    <section id={`s${n}`} className="flex h-screen w-full snap-start snap-always items-center justify-center">
      <div style={STAGE} className={cn("relative overflow-hidden rounded-[1.1cqw] border border-line bg-bg text-fg", className)}>
        {children}
        <div className="pointer-events-none absolute bottom-[2.1cqw] right-[2.6cqw] font-mono text-[0.9cqw] tabular-nums text-fg-3">
          {String(n).padStart(2, "0")} / {TOTAL}
        </div>
      </div>
    </section>
  );
}

/** The landing page's ribbed-glass prism, the backdrop every demo sits on. */
function Backdrop({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("hero-prism relative overflow-hidden rounded-[1.1cqw]", className)}>{children}</div>;
}

/** A framed window, the way the landing page frames the app. */
function Window({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[0.9cqw] bg-white ring-1 ring-black/10", className)}>
      <div className="flex h-[2.1cqw] items-center gap-[0.7cqw] border-b border-black/[0.06] bg-[#f3f2ee] px-[0.9cqw]">
        <span className="flex gap-[0.35cqw]">
          <span className="size-[0.6cqw] rounded-full bg-[#ff5f57]" />
          <span className="size-[0.6cqw] rounded-full bg-[#febc2e]" />
          <span className="size-[0.6cqw] rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto grid h-[1.3cqw] place-items-center rounded-[0.35cqw] bg-white/80 px-[0.8cqw] font-mono text-[0.7cqw] text-black/45">{title}</span>
        <span className="w-[2.4cqw]" />
      </div>
      {children}
    </div>
  );
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = !!useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={reduced ? { duration: 0.01 } : { duration: 0.8, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================ 01 · cover ============================ */
// The window on the right is the product doing its job, live: each row is a
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

function useDecisionStream(reduced: boolean, keep = 3) {
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
      setShown((prev) => [{ key: i.current, surface, action, run, ms }, ...prev].slice(0, keep));
    };
    push();
    const t = setInterval(push, reduced ? 3200 : 2100);
    return () => clearInterval(t);
  }, [pool, reduced, keep]);
  return shown;
}

function DecisionWindow({ reduced }: { reduced: boolean }) {
  const shown = useDecisionStream(reduced);
  return (
    <Window title="app.wrapbox.ai · live decisions">
      <div className="flex h-[13.6cqw] flex-col justify-end overflow-hidden bg-white">
        <AnimatePresence initial={false}>
          {[...shown].reverse().map((s, idx, arr) => {
            const newest = idx === arr.length - 1;
            return (
              <motion.div
                key={s.key}
                layout
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: newest ? 1 : 0.55, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={reduced ? { duration: 0.01 } : { duration: 0.45, ease: EASE }}
                className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.9cqw] border-t border-line px-[1.1cqw] py-[0.85cqw] text-[#111c35]", newest && "bg-[#f6f5f1]")}
              >
                {s.surface.logo ? <Logo name={s.surface.logo} size={24} rounded="rounded-[6px]" /> : <span className="size-[1.6cqw] rounded-[6px] bg-black/10" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-[0.6cqw]">
                    <span className="shrink-0 whitespace-nowrap text-[0.95cqw] font-semibold">{s.run.agent}</span>
                    <span className="truncate font-mono text-[0.85cqw] text-black/55">{statementOf(s.action)}</span>
                  </div>
                  <div className="mt-[0.3cqw] truncate text-[0.85cqw] text-black/55">{s.run.rewritten ? `rewritten → ${s.run.rewritten}` : s.run.verdict.title}</div>
                </div>
                <div className="flex items-center gap-[0.6cqw]">
                  <DecisionPill d={s.run.verdict.decision} />
                  <span className="w-[4.6cqw] text-right font-mono text-[0.75cqw] text-black/40">{s.ms < 1 ? "<1" : s.ms.toFixed(0)} ms</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-[0.5cqw] border-t border-line bg-[#f6f5f1] px-[1.1cqw] py-[0.6cqw] text-[0.8cqw] text-black/55">
        <span className="size-[0.5cqw] rounded-full bg-allow live-dot" />
        Decided by the real Wrapbox engine as you watch — not a mockup.
      </div>
    </Window>
  );
}

function Cover() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={1}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.4cqw]">
        <header className="flex items-center justify-between">
          <WrapboxLockup size={22} />
          <span className="inline-flex h-[1.9cqw] items-center rounded-full border border-line bg-surface px-[1cqw] text-[0.85cqw] text-fg-2">Pre-seed · 2026</span>
        </header>

        <div className="grid flex-1 grid-cols-[1.05fr_1fr] items-center gap-[3.6cqw]">
          <div>
            <Reveal>
              <div className="text-[0.95cqw] font-medium text-fg-3">Runtime authorization for AI agents</div>
            </Reveal>
            <Reveal delay={0.1}>
              <h1 className="mt-[1.2cqw] text-[5cqw] font-medium leading-[1.02] tracking-[-0.045em] text-fg">
                Wrapbox puts every AI agent <span className="text-fg-3">on a permit.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.25}>
              <p className="mt-[1.6cqw] max-w-[34ch] text-[1.35cqw] leading-relaxed text-fg-2">
                Every risky action an agent takes — checked, signed and proven, milliseconds before it runs.
              </p>
            </Reveal>
          </div>

          <Reveal delay={0.35}>
            <Backdrop className="px-[2cqw] pb-[2cqw] pt-[2.4cqw]">
              <DecisionWindow reduced={reduced} />
            </Backdrop>
          </Reveal>
        </div>

        <footer className="flex items-end justify-between text-[0.9cqw] text-fg-3">
          <div>
            <span className="text-fg-2">Wrapbox Inc.</span> · Bharath Kumar Salla · wrapbox.io
          </div>
          <motion.a href="#s2" animate={reduced ? {} : { y: [0, 4, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} className="mr-[6cqw] inline-flex items-center gap-[0.45cqw] hover:text-fg">
            <ArrowDown className="size-[1cqw]" /> scroll
          </motion.a>
        </footer>
      </div>
    </Stage>
  );
}

/* ============================ the page ============================ */
export function Pitch() {
  // The deck is light by design, the way the landing page is; pin the light
  // tokens so shared atoms resolve to them, and restore the app's setting on exit.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "light";
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
    <div className="h-screen snap-y snap-mandatory overflow-y-auto bg-bg scroll-thin" style={{ fontFamily: "var(--font-sans)" }}>
      <Cover />
    </div>
  );
}

export default Pitch;
