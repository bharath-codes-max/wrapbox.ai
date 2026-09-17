// The pre-seed pitch — a web page, not a deck file, where every section is a
// true 16:9 stage (the proportions of a standard slide) that fills the viewport
// and snaps into place. It is built on the landing page's own look — the same
// light ground, type, prism backdrop and framed windows — and, where a decision
// is shown, on the product's REAL policy engine: nothing here mocks a verdict.
//
// Sections are added one at a time and reviewed one at a time. TOTAL is the
// agreed count so the counter reads as the whole deck from the first section.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, MessageSquare, Zap, KeyRound, Sparkles, ShieldCheck, X, Bot, Database } from "lucide-react";
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

// Every stage carries mouse parallax: --mx/--my run -1..1 across the stage and
// anything with .par drifts by its own --depth. Depth is in container units, so
// the effect is identical at any screen size. Reduced motion pins it (index.css).
function Stage({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = !!useReducedMotion();
  const onMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const onLeave = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--mx", "0");
    e.currentTarget.style.setProperty("--my", "0");
  };
  return (
    <section id={`s${n}`} className="flex h-screen w-full snap-start snap-always items-center justify-center">
      <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} style={STAGE} className={cn("relative overflow-hidden bg-bg text-fg", className)}>
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
    <div className={cn("overflow-hidden rounded-[0.9cqw] bg-white", className)}>
      <div className="flex h-[2.1cqw] items-center gap-[0.7cqw] bg-[#f3f2ee] px-[0.9cqw]">
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

/** Drifts with the cursor. `depth` is how far, in container units. */
function Par({ depth = 6, children, className, style }: { depth?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("par", className)} style={{ "--depth": depth, ...style } as CSSProperties}>
      {children}
    </div>
  );
}

/** A card that comes alive under the cursor — a lift and a brightened edge, never a shadow. */
function HoverCard({ children, className, depth = 0 }: { children: ReactNode; className?: string; depth?: number }) {
  const reduced = !!useReducedMotion();
  const card = (
    <motion.div
      whileHover={reduced ? undefined : { y: -4, scale: 1.012 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={cn("group h-full rounded-[0.8cqw] bg-surface-2 transition-colors hover:bg-surface-3", className)}
    >
      {children}
    </motion.div>
  );
  return depth ? <Par depth={depth} className="h-full">{card}</Par> : card;
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
                className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.9cqw] px-[1.1cqw] py-[0.85cqw] text-[#111c35]", newest && "bg-[#f6f5f1]")}
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
      <div className="flex items-center gap-[0.5cqw] bg-[#f0efe9] px-[1.1cqw] py-[0.6cqw] text-[0.8cqw] text-black/55">
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
          <span className="inline-flex h-[1.9cqw] items-center rounded-full bg-surface-2 px-[1cqw] text-[0.85cqw] text-fg-2">Pre-seed · 2026</span>
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

/* ============================ 02 · the shift ============================ */
// The argument: the interface changed from advice to action. Same request, two
// years apart — in 2023 the model tells you the command, in 2026 the agent runs
// it. Every figure here is sourced; an investor can check each one.
const SHIFT_STATS: { value: string; label: string; source: string }[] = [
  { value: "46%", label: "of the code developers ship is now written by AI", source: "AI code generation statistics, 2026" },
  { value: "86%", label: "of organisations already run coding agents against production code", source: "Agentic coding in production, Q1 2026" },
  { value: "97M", label: "monthly MCP downloads — the plumbing that hands agents the tools", source: "MCP project, Mar 2026 · 100K at launch" },
];

const AGENT_CALLS: { call: string; arg: string; effect: string }[] = [
  { call: "Bash", arg: 'psql -c "DELETE FROM sessions WHERE last_seen < now() - 90"', effect: "ran against production" },
  { call: "mcp__stripe__create_refund", arg: 'charge=ch_3Q7f… amount=50000', effect: "moved $500.00" },
  { call: "Write", arg: ".github/workflows/deploy.yml", effect: "changed how you ship" },
];

function TheShift() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={2}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <div className="grid flex-1 grid-cols-[0.92fr_1.08fr] items-center gap-[3.4cqw]">
          {/* the claim */}
          <div>
            <Reveal>
              <div className="text-[0.95cqw] font-medium text-fg-3">The shift</div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-[1.1cqw] text-[3.1cqw] font-medium leading-[1.06] tracking-[-0.04em] text-fg">
                Agents stopped talking <br />and started <span className="relative inline-block">
                  doing.
                  <motion.span
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={reduced ? { duration: 0.01 } : { duration: 0.7, delay: 0.7, ease: EASE }}
                    className="prism-swatch absolute -bottom-[0.1cqw] left-0 h-[0.28cqw] w-full origin-left rounded-full"
                  />
                </span>
              </h2>
            </Reveal>
            <Reveal delay={0.18}>
              <p className="mt-[1.5cqw] max-w-[38ch] text-[1.2cqw] leading-relaxed text-fg-2">
                Two years ago a model suggested the command and a human ran it. Today the agent runs it itself — with write access to the repo, the database and the money.
              </p>
            </Reveal>

            <div className="mt-[2.2cqw] grid gap-[0.9cqw]">
              {SHIFT_STATS.map((st, i) => (
                <Reveal key={st.value} delay={0.3 + i * 0.1}>
                  <HoverCard depth={3 + i} className="flex items-center gap-[1.2cqw] px-[1.3cqw] py-[1cqw]">
                    <span className="w-[5.2cqw] shrink-0 text-[2.1cqw] font-medium leading-none tracking-[-0.04em] text-fg tnum">{st.value}</span>
                    <span className="min-w-0">
                      <span className="block text-[0.98cqw] leading-snug text-fg-2">{st.label}</span>
                      <span className="mt-[0.25cqw] block text-[0.78cqw] text-fg-3">{st.source}</span>
                    </span>
                  </HoverCard>
                </Reveal>
              ))}
            </div>
          </div>

          {/* the proof: one request, two years apart */}
          <Reveal delay={0.25}>
            <Par depth={5}>
              <Backdrop className="px-[1.9cqw] pb-[1.9cqw] pt-[2.2cqw]">
                <Window title="the same request, two years apart">
                  <div className="bg-white">
                    {/* 2023 */}
                    <div className="px-[1.4cqw] pb-[1.2cqw] pt-[1.2cqw]">
                      <div className="flex items-center gap-[0.6cqw]">
                        <MessageSquare className="size-[0.95cqw] text-black/35" />
                        <span className="font-mono text-[0.78cqw] uppercase tracking-[0.12em] text-black/40">2023 · assistant</span>
                        <span className="ml-auto rounded-full bg-black/[0.06] px-[0.7cqw] py-[0.2cqw] text-[0.75cqw] text-black/50">suggests</span>
                      </div>
                      <div className="mt-[0.8cqw] rounded-[0.6cqw] bg-[#f6f5f1] px-[1cqw] py-[0.85cqw]">
                        <div className="text-[0.92cqw] text-black/60">Sure — here&rsquo;s the command you&rsquo;d run:</div>
                        <div className="mt-[0.4cqw] truncate font-mono text-[0.88cqw] text-black/80">psql -c &quot;DELETE FROM sessions WHERE last_seen &lt; now() - 90&quot;</div>
                      </div>
                      <div className="mt-[0.7cqw] text-[0.85cqw] text-black/45">A human read it, thought about it, and typed it.</div>
                    </div>

                    <div className="relative h-[1.9cqw] bg-[#f0efe9]">
                      <motion.span
                        initial={{ opacity: 0, y: -6 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={reduced ? { duration: 0.01 } : { duration: 0.5, delay: 0.9 }}
                        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[0.5cqw] whitespace-nowrap text-[0.78cqw] font-medium text-black/45"
                      >
                        two years <ArrowRight className="size-[0.85cqw]" /> the human step disappeared
                      </motion.span>
                    </div>

                    {/* 2026 */}
                    <div className="px-[1.4cqw] pb-[1.3cqw] pt-[1.2cqw]">
                      <div className="flex items-center gap-[0.6cqw]">
                        <Zap className="size-[0.95cqw] text-[#1848ff]" />
                        <span className="font-mono text-[0.78cqw] uppercase tracking-[0.12em] text-black/55">2026 · agent</span>
                        <span className="ml-auto rounded-full bg-[#1848ff]/10 px-[0.7cqw] py-[0.2cqw] text-[0.75cqw] font-medium text-[#1848ff]">executes</span>
                      </div>
                      <div className="mt-[0.8cqw] grid gap-[0.5cqw]">
                        {AGENT_CALLS.map((c, i) => (
                          <motion.div
                            key={c.call}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={reduced ? { duration: 0.01 } : { duration: 0.45, delay: 1.1 + i * 0.16, ease: EASE }}
                            className="flex items-baseline gap-[0.7cqw] rounded-[0.5cqw] bg-[#f6f5f1] px-[1cqw] py-[0.65cqw]"
                          >
                            <span className="shrink-0 font-mono text-[0.88cqw] font-semibold text-[#111c35]">{c.call}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[0.85cqw] text-black/55">{c.arg}</span>
                            <span className="shrink-0 whitespace-nowrap text-[0.8cqw] font-medium text-[#d6224a]">{c.effect}</span>
                          </motion.div>
                        ))}
                      </div>
                      <div className="mt-[0.9cqw] text-[0.85cqw] text-black/45">No human read any of them. Nobody was asked.</div>
                    </div>
                  </div>
                </Window>
              </Backdrop>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 03 · the problem ============================ */
// The problem, told as ONE picture: the agent's action arrows straight through
// every existing security layer to the database. Each layer sits on the arrow
// with the exact thing it sees — and doesn't. Underneath, a compact timeline
// of real incidents makes the picture undeniable.
interface Incident {
  when: string;
  vendor: string;
  headline: string;
  impact: string;
  source: string;
}
const INCIDENTS: Incident[] = [
  { when: "Jul 2025", vendor: "Replit", headline: "Agent deleted a production database mid–code freeze.", impact: "1,200+ execs, 1,190 companies wiped", source: "Jason Lemkin, SaaStr" },
  { when: "Dec 2025", vendor: "Cursor", headline: "Plan Mode enforcement bug — agent deleted tracked files despite an explicit stop.", impact: "Publicly acknowledged", source: "Cursor engineering" },
  { when: "Apr 2026", vendor: "Cursor + Claude", headline: "Production database wiped in 9 seconds.", impact: "Every volume-level backup gone; 3-mo-old restore", source: "Zenity, PocketOS" },
  { when: "Feb 2026", vendor: "Industry", headline: "10+ documented cases across 6 major agent tools.", impact: "Antigravity IDE · Claude Code · Cursor · Replit · +", source: "Incident Database" },
];

// The layers stacked on the agent → resource arrow. Each carries the ONE thing
// it sees — and, in dimmer type, the thing that would actually stop the action.
const LAYERS: { icon: typeof KeyRound; name: string; sees: string; misses: string; tint: string }[] = [
  { icon: KeyRound, name: "Identity", sees: "an OAuth token", misses: "the SQL it is about to run", tint: "from-[#e0e6f5]" },
  { icon: Sparkles, name: "Guardrails", sees: "the text of the reply", misses: "the effect it triggers", tint: "from-[#efe6f6]" },
  { icon: ShieldCheck, name: "EDR / DLP", sees: "the file after it was written", misses: "the ask before", tint: "from-[#f6e6ea]" },
];

function TheProblem() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={3}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.4cqw] pt-[2.4cqw]">
        {/* header */}
        <div className="flex items-end justify-between">
          <div>
            <Reveal>
              <div className="text-[0.9cqw] font-medium text-fg-3">The problem</div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-[0.6cqw] text-[2.6cqw] font-medium leading-[1.05] tracking-[-0.038em] text-fg">
                Nobody can say what an agent is allowed to do{" "}
                <span className="relative inline-block">
                  before
                  <motion.span
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={reduced ? { duration: 0.01 } : { duration: 0.7, delay: 0.7, ease: EASE }}
                    className="prism-swatch absolute -bottom-[0.06cqw] left-0 h-[0.24cqw] w-full origin-left rounded-full"
                  />
                </span>{" "}
                it does it.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.18}>
            <p className="max-w-[24ch] text-right text-[0.95cqw] leading-relaxed text-fg-2">
              Every enterprise already has three layers. None of them can answer{" "}
              <span className="text-fg">that</span> question — in milliseconds — for an agent.
            </p>
          </Reveal>
        </div>

        {/* THE PICTURE — the agent's action arrow, punching through every layer, to the DB */}
        <Reveal delay={0.22}>
          <div className="relative mt-[2.2cqw] rounded-[1cqw] bg-surface-2 px-[2cqw] py-[2cqw]">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-[1.2cqw]">
              {/* the agent */}
              <div className="par flex flex-col items-center gap-[0.55cqw]" style={{ ["--depth" as string]: 5 } as CSSProperties}>
                <div className="grid size-[4.2cqw] place-items-center rounded-[0.8cqw] bg-white">
                  <Bot className="size-[2.2cqw] text-fg" />
                </div>
                <div className="text-[0.78cqw] font-semibold uppercase tracking-[0.12em] text-fg-2">Agent</div>
                <div className="w-[7cqw] text-center text-[0.75cqw] leading-tight text-fg-3">Bash · MCP · git · SQL</div>
              </div>

              {/* the wall of layers on top of the shaft */}
              <div className="relative min-h-[6cqw]">
                {/* the shaft */}
                <motion.span
                  aria-hidden
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={reduced ? { duration: 0.01 } : { duration: 1.1, delay: 0.35, ease: EASE }}
                  className="absolute left-0 right-[1.4cqw] top-1/2 h-[0.3cqw] origin-left -translate-y-1/2 rounded-full bg-block/85"
                />
                {/* arrow head */}
                <motion.span
                  aria-hidden
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={reduced ? { duration: 0.01 } : { duration: 0.35, delay: 1.35 }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-block"
                >
                  <ArrowRight className="size-[1.6cqw]" strokeWidth={2.4} />
                </motion.span>

                {/* the three layer cards sitting on the arrow */}
                <div className="relative grid grid-cols-3 gap-[1cqw]">
                  {LAYERS.map((l, i) => {
                    const Icon = l.icon;
                    return (
                      <motion.div
                        key={l.name}
                        initial={{ opacity: 0, y: 18 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={reduced ? { duration: 0.01 } : { duration: 0.55, delay: 0.55 + i * 0.14, ease: EASE }}
                        whileHover={reduced ? undefined : { y: -4 }}
                        className={cn("par relative overflow-hidden rounded-[0.75cqw] bg-gradient-to-b to-white px-[1cqw] pb-[1.05cqw] pt-[1.05cqw]", l.tint)}
                        style={{ ["--depth" as string]: 4 + i } as CSSProperties}
                      >
                        <div className="flex items-center gap-[0.55cqw]">
                          <span className="grid size-[1.75cqw] place-items-center rounded-[0.45cqw] bg-white/80 text-fg-2">
                            <Icon className="size-[1cqw]" />
                          </span>
                          <span className="text-[1cqw] font-semibold tracking-[-0.01em] text-fg">{l.name}</span>
                          <span className="ml-auto inline-flex items-center gap-[0.25cqw] rounded-full bg-block-soft px-[0.55cqw] py-[0.18cqw] text-[0.65cqw] font-semibold uppercase tracking-[0.14em] text-block">
                            <X className="size-[0.65cqw]" strokeWidth={2.8} /> misses
                          </span>
                        </div>
                        <div className="mt-[0.7cqw] grid grid-cols-[auto_1fr] gap-x-[0.55cqw] gap-y-[0.15cqw] text-[0.78cqw]">
                          <span className="font-mono uppercase tracking-[0.1em] text-fg-3">sees</span>
                          <span className="text-fg-2">{l.sees}</span>
                          <span className="font-mono uppercase tracking-[0.1em] text-fg-3">needs</span>
                          <span className="font-medium text-fg">{l.misses}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* the target: the database, hit */}
              <div className="par flex flex-col items-center gap-[0.55cqw]" style={{ ["--depth" as string]: 5 } as CSSProperties}>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0.6 }}
                  whileInView={{ scale: [0.9, 1.08, 1], opacity: 1 }}
                  viewport={{ once: true }}
                  transition={reduced ? { duration: 0.01 } : { duration: 0.7, delay: 1.45, times: [0, 0.4, 1] }}
                  className="grid size-[4.2cqw] place-items-center rounded-[0.8cqw] bg-block-soft"
                >
                  <Database className="size-[2.2cqw] text-block" />
                </motion.div>
                <div className="text-[0.78cqw] font-semibold uppercase tracking-[0.12em] text-block">Wiped</div>
                <div className="w-[7cqw] text-center text-[0.75cqw] leading-tight text-fg-3">database, files, funds</div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* THE PROOF — a horizontal news wall / timeline */}
        <div className="mt-[1.6cqw] flex-1">
          <div className="mb-[0.6cqw] flex items-baseline justify-between">
            <div className="text-[0.8cqw] font-medium uppercase tracking-[0.14em] text-fg-3">This is not hypothetical</div>
            <div className="text-[0.78cqw] text-fg-3">Real, public incidents · every source checkable</div>
          </div>
          <div className="grid grid-cols-4 gap-[0.9cqw]">
            {INCIDENTS.map((n, i) => (
              <motion.article
                key={n.headline}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={reduced ? { duration: 0.01 } : { duration: 0.5, delay: 0.9 + i * 0.1, ease: EASE }}
                whileHover={reduced ? undefined : { y: -3 }}
                className="par relative flex h-full flex-col rounded-[0.7cqw] bg-white px-[1cqw] py-[0.85cqw]"
                style={{ ["--depth" as string]: 4 + i } as CSSProperties}
              >
                <span aria-hidden className="absolute inset-x-[1cqw] top-0 h-[0.14cqw] rounded-full bg-block/80" />
                <div className="flex items-baseline justify-between text-[0.7cqw]">
                  <span className="font-mono uppercase tracking-[0.12em] text-block">{n.when}</span>
                  <span className="font-semibold text-fg-2">{n.vendor}</span>
                </div>
                <blockquote className="mt-[0.4cqw] text-[0.92cqw] font-medium leading-[1.28] text-fg">{n.headline}</blockquote>
                <div className="mt-auto pt-[0.55cqw] text-[0.72cqw] leading-tight text-fg-2">{n.impact}</div>
                <div className="mt-[0.15cqw] text-[0.66cqw] text-fg-3">— {n.source}</div>
              </motion.article>
            ))}
          </div>
        </div>
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
      <TheShift />
      <TheProblem />
    </div>
  );
}

export default Pitch;
