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
import { ArrowDown, ArrowRight } from "lucide-react";
import { INTENT_CONTRACT, SURFACES, activeRules, runAction, type RunResult, type ScenarioAction, type Surface } from "../data/playground";
import type { Decision } from "../data/agents";
import type { Rule } from "../data/contract";
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
                Agents stopped talking <br />and started doing.
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
                        <span className="font-mono text-[0.78cqw] uppercase tracking-[0.12em] text-black/55">2026 · agent</span>
                        <span className="ml-auto rounded-full bg-[#111c35] px-[0.7cqw] py-[0.2cqw] text-[0.75cqw] font-medium text-white">executes</span>
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
                            <span className="shrink-0 whitespace-nowrap text-[0.8cqw] font-medium text-[#111c35]">{c.effect}</span>
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
// The problem slide in the register of the best pre-seed decks: one page,
// one typeface, navy on off-white, and facts that speak for themselves. No
// icons, no colour, no pictures. Left: the claim and why the three layers
// every enterprise already owns cannot answer it. Right: a ledger of public
// incidents, each one checkable.
interface Incident {
  when: string;
  headline: string;
  loss: string;
  source: string;
}
const INCIDENTS: Incident[] = [
  { when: "Jul 2025", headline: "Replit's agent deleted a production database during a code freeze.", loss: "1,200+ executives and 1,190 companies wiped", source: "Jason Lemkin, SaaStr" },
  { when: "Dec 2025", headline: "A Cursor agent deleted tracked files despite an explicit stop instruction.", loss: "Plan Mode enforcement bug, acknowledged publicly", source: "Cursor engineering" },
  { when: "Apr 2026", headline: "A Cursor agent wiped PocketOS's production database in nine seconds.", loss: "Every volume-level backup gone; newest restore was three months old", source: "Zenity incident report" },
  { when: "Feb 2026", headline: "Ten or more documented incidents across six major agent tools.", loss: "Replit, Cursor, Claude Code, Google Antigravity and others", source: "AI Incident Database" },
];

const LAYERS: { name: string; sees: string; not: string }[] = [
  { name: "Identity", sees: "a token", not: "the SQL about to run" },
  { name: "Guardrails", sees: "the reply", not: "the effect it triggers" },
  { name: "Endpoint security", sees: "the file afterwards", not: "the ask before" },
];

function TheProblem() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={3}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <div className="grid flex-1 grid-cols-[0.9fr_1.1fr] items-center gap-[4.5cqw]">
          {/* the claim */}
          <Par depth={3}>
            <Reveal>
              <div className="text-[0.95cqw] font-medium text-fg-3">The problem</div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-[1.2cqw] text-[3.1cqw] font-medium leading-[1.06] tracking-[-0.04em] text-fg">
                Nobody can say what an agent is allowed to do <span className="whitespace-nowrap">before it does it.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.18}>
              <p className="mt-[1.5cqw] max-w-[36ch] text-[1.2cqw] leading-relaxed text-fg-2">
                Every company already runs three layers of security. Each one sees part of the picture. None of them sees the action — the specific command, from this specific agent, right now.
              </p>
            </Reveal>

            <div className="mt-[2.2cqw]">
              {LAYERS.map((l, i) => (
                <Reveal key={l.name} delay={0.3 + i * 0.1}>
                  <div className="-mx-[0.9cqw] rounded-[0.6cqw] px-[0.9cqw] py-[0.75cqw] transition-colors hover:bg-surface-2">
                    <div className="grid grid-cols-[9.5cqw_1fr] items-baseline gap-[1cqw] text-[1.05cqw] leading-snug">
                      <span className="font-medium text-fg">{l.name}</span>
                      <span className="text-fg-2">
                        sees {l.sees}<span className="text-fg-3">, not {l.not}.</span>
                      </span>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </Par>

          {/* the ledger */}
          <Par depth={5}>
            <Reveal delay={0.22}>
              <div className="flex items-baseline justify-between text-[0.85cqw] text-fg-3">
                <span>Public incidents, 2025 – 2026</span>
                <span>Every source is checkable</span>
              </div>
            </Reveal>
            <div className="mt-[0.9cqw]">
              {INCIDENTS.map((n, i) => (
                <Reveal key={n.when + n.headline} delay={0.32 + i * 0.12}>
                  <motion.article
                    whileHover={reduced ? undefined : { x: 4 }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                    className="-mx-[1.1cqw] grid grid-cols-[6.4cqw_1fr] gap-[1cqw] rounded-[0.7cqw] px-[1.1cqw] py-[1.05cqw] transition-colors hover:bg-surface-2"
                  >
                    <span className="pt-[0.2cqw] font-mono text-[0.82cqw] text-fg-3">{n.when}</span>
                    <div>
                      <div className="text-[1.15cqw] font-medium leading-[1.3] tracking-[-0.01em] text-fg">{n.headline}</div>
                      <div className="mt-[0.4cqw] text-[0.88cqw] leading-snug text-fg-2">
                        {n.loss} <span className="text-fg-3">· {n.source}</span>
                      </div>
                    </div>
                  </motion.article>
                </Reveal>
              ))}
            </div>
          </Par>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 04 · the solution ============================ */
// The solution is shown, not described: the product in the landing page's
// framed window — the intent contract on the left exactly as the admin wrote
// it, compiled into rules by the real engine; on the right four real actions,
// one per outcome, decided by that same engine. Nothing on the stage is typed
// in by hand: rule counts, verdicts, rewrites and approvers all come from
// runAction() / activeRules().
const SOLUTION_IDS = ["pg-cli-tests", "pg-cursor-force", "pg-db-update", "pg-cli-dotenv"];
const D_ORDER: Decision[] = ["BLOCK", "REVIEW", "CONSTRAIN", "ALLOW"];
const RANK: Record<Decision, number> = { ALLOW: 1, CONSTRAIN: 2, REVIEW: 3, BLOCK: 4 };
/** The strongest decision a rule can reach — read off the rule, the way the playground does. */
function ruleDecision(r: Rule): Decision {
  const c: Decision[] = [];
  if (r.decision) c.push(r.decision);
  for (const t of r.tiers ?? []) c.push(t.decision);
  for (const e of r.escalations ?? []) c.push(e.decision);
  if (r.forbid?.length) c.push("BLOCK");
  return c.length ? c.sort((a, b) => RANK[b] - RANK[a])[0] : "ALLOW";
}

function TheSolution() {
  const reduced = !!useReducedMotion();
  const rules = useMemo(() => activeRules(), []);
  const groups = useMemo(() => D_ORDER.map((d) => ({ d, n: rules.filter((r) => ruleDecision(r) === d).length })), [rules]);
  const decided = useMemo(
    () =>
      SOLUTION_IDS.map((id) => {
        const surface = SURFACES.find((x) => x.actions.some((a) => a.id === id))!;
        const action = surface.actions.find((a) => a.id === id)!;
        return { surface, action, run: runAction(action) };
      }),
    [],
  );

  return (
    <Stage n={4}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.4cqw] pt-[2.6cqw]">
        <div className="grid grid-cols-[1.15fr_0.85fr] items-end gap-[3cqw]">
          <div>
            <Reveal>
              <div className="text-[0.95cqw] font-medium text-fg-3">The solution</div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-[0.9cqw] text-[2.9cqw] font-medium leading-[1.06] tracking-[-0.04em] text-fg">
                One intent contract. Every agent.<br />Checked milliseconds before it runs.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.18}>
            <p className="max-w-[36ch] text-[1.1cqw] leading-relaxed text-fg-2">
              The admin writes the rules once, in plain English. Wrapbox compiles them and answers every action an agent takes — allow, constrain, review or block — and signs a receipt for each.
            </p>
          </Reveal>
        </div>

        {/* the product, real */}
        <Reveal delay={0.28} className="mt-[1.8cqw] flex-1">
          <Par depth={4} className="h-full">
            <Backdrop className="h-full px-[1.8cqw] pb-[1.8cqw] pt-[1.8cqw]">
              <Window title="app.wrapbox.ai · intent contract → decisions" className="h-full">
                <div className="grid h-[calc(100%-2.1cqw)] grid-cols-[0.82fr_1.18fr]">
                  {/* the contract, as written */}
                  <div className="flex flex-col bg-[#faf9f6] px-[1.5cqw] py-[1.3cqw] text-[#111c35]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.75cqw] uppercase tracking-[0.12em] text-black/45">Intent contract</span>
                      <span className="font-mono text-[0.72cqw] text-black/35">v1 · published</span>
                    </div>
                    <div className="mt-[1cqw] space-y-[0.6cqw]">
                      {INTENT_CONTRACT.map((line) => (
                        <p key={line} className="text-[1.12cqw] font-medium leading-[1.4] tracking-[-0.01em]">{line}</p>
                      ))}
                    </div>
                    <div className="mt-auto pt-[1.2cqw]">
                      <div className="text-[0.82cqw] text-black/50">Compiled into {rules.length} rules</div>
                      <div className="mt-[0.6cqw] grid grid-cols-4 gap-[0.5cqw]">
                        {groups.map((g, i) => (
                          <motion.div
                            key={g.d}
                            initial={{ opacity: 0, y: 8 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={reduced ? { duration: 0.01 } : { duration: 0.4, delay: 0.7 + i * 0.08, ease: EASE }}
                            className="rounded-[0.5cqw] bg-white px-[0.7cqw] py-[0.6cqw]"
                          >
                            <div className="text-[1.5cqw] font-medium leading-none tracking-[-0.03em] tnum">{g.n}</div>
                            <div className="mt-[0.35cqw] font-mono text-[0.62cqw] uppercase tracking-[0.1em] text-black/45">{g.d}</div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* four real actions, one per outcome */}
                  <div className="flex flex-col bg-white px-[1.5cqw] py-[1.3cqw] text-[#111c35]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.75cqw] uppercase tracking-[0.12em] text-black/45">Decisions</span>
                      <span className="font-mono text-[0.72cqw] text-black/35">real engine · &lt;1 ms each</span>
                    </div>
                    <div className="mt-[0.9cqw] flex flex-1 flex-col gap-[0.55cqw]">
                      {decided.map(({ surface, action, run }, i) => (
                        <motion.div
                          key={action.id}
                          initial={{ opacity: 0, x: 12 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={reduced ? { duration: 0.01 } : { duration: 0.45, delay: 0.55 + i * 0.14, ease: EASE }}
                          whileHover={reduced ? undefined : { x: 3 }}
                          className="-mx-[0.8cqw] grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.9cqw] rounded-[0.6cqw] px-[0.8cqw] py-[0.7cqw] transition-colors hover:bg-[#f6f5f1]"
                        >
                          {surface.logo ? <Logo name={surface.logo} size={24} rounded="rounded-[6px]" /> : <span className="size-[1.6cqw] rounded-[6px] bg-black/10" />}
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-[0.6cqw]">
                              <span className="shrink-0 text-[0.92cqw] font-semibold">{run.agent}</span>
                              <span className="truncate font-mono text-[0.82cqw] text-black/55">{statementOf(action)}</span>
                            </div>
                            <div className="mt-[0.25cqw] truncate text-[0.82cqw] text-black/55">
                              {run.rewritten ? <>rewritten → <span className="font-mono">{run.rewritten}</span></> : run.verdict.approvers ? `${run.verdict.title} · ${run.verdict.approvers}${run.verdict.quorum ? ` × ${run.verdict.quorum}` : ""}` : run.verdict.title}
                            </div>
                          </div>
                          <DecisionPill d={run.verdict.decision} />
                        </motion.div>
                      ))}
                      <div className="mt-auto flex items-center gap-[0.5cqw] pt-[0.9cqw] text-[0.8cqw] text-black/50">
                        <span className="size-[0.5cqw] rounded-full bg-allow live-dot" />
                        Every verdict above was produced by the engine when this page loaded — the same engine the product ships.
                      </div>
                    </div>
                  </div>
                </div>
              </Window>
            </Backdrop>
          </Par>
        </Reveal>

        {/* three facts, typographic */}
        <div className="mt-[1.6cqw] grid grid-cols-3 gap-[2cqw]">
          {[
            ["Plain English in", "Two sentences from the admin become sixteen rules. No policy language to learn."],
            ["Every agent, every surface", "Claude Code, Cursor, browsers, MCP tools, SaaS — one contract governs them all."],
            ["A signed receipt, every time", "Each decision is signed and hash-chained, so an auditor gets the whole story."],
          ].map(([t, b], i) => (
            <Reveal key={t} delay={0.9 + i * 0.08}>
              <div className="text-[0.95cqw] font-medium text-fg">{t}</div>
              <div className="mt-[0.3cqw] text-[0.85cqw] leading-relaxed text-fg-2">{b}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 05 · how it works ============================ */
// The architecture as one quiet diagram: the control plane holds the contract,
// and the same contract is enforced at two points — on the employee's device
// (the runtime) and in front of the company's systems (the gateway). Every
// decision, at either point, comes back as a signed receipt. Real vendor marks
// show what each point governs; no icons, no colour, connectors are hairlines.
const RUNTIME_MARKS: { logo: string; name: string }[] = [
  { logo: "claudecode", name: "Claude Code" },
  { logo: "cursor", name: "Cursor" },
  { logo: "githubcopilot", name: "Copilot" },
  { logo: "google", name: "Chrome" },
  { logo: "claude", name: "Claude Desktop" },
];
const GATEWAY_MARKS: { logo: string; name: string }[] = [
  { logo: "stripe", name: "Stripe" },
  { logo: "postgresql", name: "Postgres" },
  { logo: "github_light", name: "GitHub" },
  { logo: "aws", name: "AWS" },
  { logo: "slack", name: "Slack" },
  { logo: "salesforce", name: "Salesforce" },
];

function Rail({ delay, reduced, className }: { delay: number; reduced: boolean; className?: string }) {
  return (
    <motion.span
      aria-hidden
      initial={{ scaleY: 0 }}
      whileInView={{ scaleY: 1 }}
      viewport={{ once: true }}
      transition={reduced ? { duration: 0.01 } : { duration: 0.5, delay, ease: EASE }}
      className={cn("block w-px origin-top bg-line-strong", className)}
    />
  );
}

function Plane({
  eyebrow,
  title,
  where,
  copy,
  marks,
  delay,
  reduced,
  depth,
}: {
  eyebrow: string;
  title: string;
  where: string;
  copy: string;
  marks: { logo: string; name: string }[];
  delay: number;
  reduced: boolean;
  depth: number;
}) {
  return (
    <Reveal delay={delay} className="h-full">
      <Par depth={depth} className="h-full">
        <motion.div whileHover={reduced ? undefined : { y: -4 }} transition={{ type: "spring", stiffness: 260, damping: 22 }} className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 px-[1.7cqw] py-[1.5cqw] transition-colors hover:bg-surface-3">
          <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">{eyebrow}</div>
          <div className="mt-[0.5cqw] flex items-baseline gap-[0.7cqw]">
            <span className="text-[1.7cqw] font-medium tracking-[-0.03em] text-fg">{title}</span>
            <span className="text-[0.95cqw] text-fg-3">{where}</span>
          </div>
          <p className="mt-[0.7cqw] max-w-[44ch] text-[0.95cqw] leading-relaxed text-fg-2">{copy}</p>
          <div className="mt-auto flex flex-wrap gap-[0.5cqw] pt-[1.2cqw]">
            {marks.map((m) => (
              <span key={m.name} className="inline-flex items-center gap-[0.45cqw] rounded-full bg-white px-[0.7cqw] py-[0.3cqw] text-[0.8cqw] text-fg-2">
                <Logo name={m.logo} size={16} rounded="rounded-[4px]" />
                {m.name}
              </span>
            ))}
          </div>
        </motion.div>
      </Par>
    </Reveal>
  );
}

function HowItWorks() {
  const reduced = !!useReducedMotion();
  return (
    <Stage n={5}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[3.8cqw] pt-[2.6cqw]">
        <div className="grid grid-cols-[1.15fr_0.85fr] items-end gap-[3cqw]">
          <div>
            <Reveal>
              <div className="text-[0.95cqw] font-medium text-fg-3">How it works</div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-[0.9cqw] text-[2.9cqw] font-medium leading-[1.06] tracking-[-0.04em] text-fg">
                Two enforcement points.<br />One contract.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.18}>
            <p className="max-w-[36ch] text-[1.1cqw] leading-relaxed text-fg-2">
              The contract lives in one place and is enforced in two: on the employee&rsquo;s machine, where the agent runs, and in front of the systems it reaches for. Either way the answer comes back signed.
            </p>
          </Reveal>
        </div>

        {/* the diagram */}
        <div className="mt-[1.6cqw] flex flex-1 flex-col">
          {/* control plane */}
          <Reveal delay={0.25} className="mx-auto w-[46cqw]">
            <Par depth={2}>
              <div className="rounded-[0.9cqw] bg-fg px-[1.7cqw] py-[1.2cqw] text-white">
                <div className="flex items-baseline justify-between">
                  <span className="text-[1.35cqw] font-medium tracking-[-0.02em]">Control plane</span>
                  <span className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-white/55">console.wrapbox.ai</span>
                </div>
                <p className="mt-[0.35cqw] text-[0.92cqw] leading-relaxed text-white/75">Holds the intent contract, compiles it into rules, pushes them to every enforcement point, and signs every receipt that comes back.</p>
              </div>
            </Par>
          </Reveal>

          {/* rails down to the two planes */}
          <div className="relative h-[2.6cqw] w-full">
            <Rail delay={0.55} reduced={reduced} className="absolute left-1/2 top-0 h-[1.3cqw] -translate-x-1/2" />
            <motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={reduced ? { duration: 0.01 } : { duration: 0.5, delay: 0.75, ease: EASE }} className="absolute left-1/4 right-1/4 top-[1.3cqw] h-px bg-line-strong" />
            <Rail delay={0.95} reduced={reduced} className="absolute left-1/4 top-[1.3cqw] h-[1.3cqw]" />
            <Rail delay={0.95} reduced={reduced} className="absolute left-3/4 top-[1.3cqw] h-[1.3cqw]" />
          </div>

          {/* the two planes */}
          <div className="grid flex-1 grid-cols-2 items-stretch gap-[1.6cqw]">
            <Plane
              eyebrow="Enforcement point 1"
              title="Runtime"
              where="on the device"
              copy="A small daemon, pushed to the fleet by MDM in one click. It sits at the operating-system level — Apple Endpoint Security on macOS, kernel confinement on Linux — so it sees every command, file and network call an agent makes, whichever agent it is."
              marks={RUNTIME_MARKS}
              delay={1.05}
              reduced={reduced}
              depth={4}
            />
            <Plane
              eyebrow="Enforcement point 2"
              title="Gateway"
              where="in front of company systems"
              copy="A proxy the agent's tools are pointed at. It applies the same contract to every call into a database, an API, an MCP tool or a SaaS product — even when the agent runs somewhere Wrapbox is not installed."
              marks={GATEWAY_MARKS}
              delay={1.15}
              reduced={reduced}
              depth={5}
            />
          </div>

          {/* the receipt */}
          <Reveal delay={1.35} className="mt-[1.4cqw]">
            <div className="flex items-center justify-between rounded-[0.7cqw] bg-surface-2 px-[1.5cqw] py-[0.9cqw]">
              <div className="text-[0.95cqw] text-fg-2">
                <span className="font-medium text-fg">Every decision comes back signed.</span> ECDSA P-256, bound to the exact arguments, single use, hash-chained into the evidence log.
              </div>
              <div className="font-mono text-[0.78cqw] text-fg-3">permit wbp_… · receipt WB-… · kid wbx-2026-09</div>
            </div>
          </Reveal>
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
      <TheSolution />
      <HowItWorks />
    </div>
  );
}

export default Pitch;
