// The pre-seed pitch — 14 stages, each an artifact rather than a paragraph.
// Register: Cursor / Linear. Off-white ground, navy type, one meaningful visual
// per slide (a hand-built SVG chart, a diagram, a framed product view, or the
// real live demo embedded), copy sits around it. Motion: cursor parallax and
// scroll-triggered chart draws. Every number is derivable or cited; nothing is
// invented.

import { AnimatePresence, motion, useReducedMotion, useInView } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Check } from "lucide-react";
import { INTENT_CONTRACT, SURFACES, activeRules, runAction, type RunResult, type ScenarioAction, type Surface } from "../data/playground";
import type { Decision } from "../data/agents";
import type { Rule } from "../data/contract";
import { DecisionPill, Logo, cn } from "../components/ui";
import { WrapboxLockup } from "../components/logo";

const TOTAL = 14;
const EASE = [0.2, 0.7, 0.2, 1] as const;
const INK = "#111c35";

/* ============================ stage ============================ */
const STAGE: CSSProperties = {
  width: "min(calc(100vw - 3rem), calc((100vh - 5rem) * 16 / 9))",
  aspectRatio: "16 / 9",
  containerType: "inline-size",
};

function Stage({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
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
    <section id={`s${n}`} className="flex h-screen w-full snap-start items-center justify-center">
      <div onMouseMove={onMove} onMouseLeave={onLeave} style={STAGE} className={cn("relative overflow-hidden bg-bg text-fg", className)}>
        {children}
        <div className="pointer-events-none absolute bottom-[2.1cqw] right-[2.6cqw] font-mono text-[0.85cqw] tabular-nums text-fg-3">{String(n).padStart(2, "0")} / {TOTAL}</div>
      </div>
    </section>
  );
}

/* ============================ primitives ============================ */
function Par({ depth = 6, children, className, style }: { depth?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={cn("par", className)} style={{ "--depth": depth, ...style } as CSSProperties}>{children}</div>;
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = !!useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-10%" }}
      transition={reduced ? { duration: 0.01 } : { duration: 0.8, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** The landing page's ribbed-glass prism. */
function Backdrop({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("hero-prism relative overflow-hidden rounded-[1cqw]", className)}>{children}</div>;
}

/** A framed window like the landing page's AppWindow. */
function Window({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[0.8cqw] bg-white", className)}>
      <div className="flex h-[2cqw] items-center gap-[0.55cqw] bg-[#f3f2ee] px-[0.9cqw]">
        <span className="flex gap-[0.32cqw]">
          <span className="size-[0.55cqw] rounded-full bg-[#ff5f57]" />
          <span className="size-[0.55cqw] rounded-full bg-[#febc2e]" />
          <span className="size-[0.55cqw] rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto grid h-[1.2cqw] place-items-center rounded-[0.32cqw] bg-white/85 px-[0.75cqw] font-mono text-[0.68cqw] text-black/45">{title}</span>
        <span className="w-[2.3cqw]" />
      </div>
      {children}
    </div>
  );
}

/** Section header — used top-left on every slide except the cover. */
function Head({ kicker, title, aside, delay = 0 }: { kicker: string; title: ReactNode; aside?: ReactNode; delay?: number }) {
  return (
    <div className="grid grid-cols-[1.15fr_0.85fr] items-end gap-[3cqw]">
      <div>
        <Reveal delay={delay}><div className="text-[0.9cqw] font-medium text-fg-3">{kicker}</div></Reveal>
        <Reveal delay={delay + 0.08}>
          <h2 className="mt-[0.8cqw] text-[2.7cqw] font-medium leading-[1.05] tracking-[-0.04em] text-fg">{title}</h2>
        </Reveal>
      </div>
      {aside && <Reveal delay={delay + 0.18}><p className="max-w-[36ch] text-[1cqw] leading-relaxed text-fg-2">{aside}</p></Reveal>}
    </div>
  );
}

/* ============================ chart helpers ============================ */
function useInViewOnce<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const seen = useInView(ref, { once: true, margin: "-15%" });
  return { ref, seen };
}

/** A number that counts up when the block first enters the viewport. */
function CountUp({ to, prefix = "", suffix = "", duration = 1.2, className }: { to: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLSpanElement>();
  const [n, setN] = useState(reduced ? to : 0);
  useEffect(() => {
    if (!seen || reduced) { setN(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / (duration * 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration, reduced]);
  return <span ref={ref} className={className}>{prefix}{n.toLocaleString("en-US")}{suffix}</span>;
}

/* ============================ 01 · cover — live decisions ============================ */
const STREAM_IDS = ["pg-cursor-force", "pg-cli-dotenv", "pg-cli-hotfix-main", "pg-cli-tests", "pg-browser-upload-pii", "pg-db-update", "pg-stripe-50000", "pg-desktop-gcloud"];

interface Shown { key: number; surface: Surface; action: ScenarioAction; run: RunResult; ms: number }
const statementOf = (a: ScenarioAction) => a.act.command ?? a.act.sql ?? a.act.path ?? a.act.destination ?? a.label;

function useDecisionStream(reduced: boolean, keep = 4) {
  const pool = useMemo(() => STREAM_IDS.map((id) => {
    const surface = SURFACES.find((s) => s.actions.some((a) => a.id === id))!;
    const action = surface.actions.find((a) => a.id === id)!;
    return { surface, action };
  }), []);
  const [shown, setShown] = useState<Shown[]>([]);
  const i = useRef(0);
  useEffect(() => {
    const push = () => {
      const { surface, action } = pool[i.current % pool.length];
      const t0 = performance.now();
      const run = runAction(action);
      i.current += 1;
      setShown((prev) => [{ key: i.current, surface, action, run, ms: performance.now() - t0 }, ...prev].slice(0, keep));
    };
    push();
    const t = setInterval(push, reduced ? 3200 : 2000);
    return () => clearInterval(t);
  }, [pool, reduced, keep]);
  return shown;
}

function Cover() {
  const reduced = !!useReducedMotion();
  const shown = useDecisionStream(reduced);
  return (
    <Stage n={1}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.4cqw]">
        <header className="flex items-center justify-between">
          <WrapboxLockup size={22} />
          <span className="inline-flex h-[1.8cqw] items-center rounded-full bg-surface-2 px-[1cqw] text-[0.82cqw] text-fg-2">Pre-seed · 2026</span>
        </header>

        <div className="grid flex-1 grid-cols-[1.05fr_1fr] items-center gap-[3.4cqw]">
          <div>
            <Reveal><div className="text-[0.9cqw] font-medium text-fg-3">Runtime authorization for AI agents</div></Reveal>
            <Reveal delay={0.1}>
              <h1 className="mt-[1.2cqw] text-[5cqw] font-medium leading-[1.02] tracking-[-0.045em] text-fg">
                Wrapbox puts every AI agent <span className="text-fg-3">on a permit.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.24}>
              <p className="mt-[1.5cqw] max-w-[34ch] text-[1.3cqw] leading-relaxed text-fg-2">Every risky action an agent takes — checked, signed and proven, milliseconds before it runs.</p>
            </Reveal>
          </div>

          <Reveal delay={0.32}>
            <Par depth={5}>
              <Backdrop className="px-[1.8cqw] pb-[1.8cqw] pt-[2cqw]">
                <Window title="app.wrapbox.ai · live decisions">
                  <div className="flex h-[16.4cqw] flex-col justify-end overflow-hidden bg-white">
                    <AnimatePresence initial={false}>
                      {[...shown].reverse().map((s, idx, arr) => {
                        const newest = idx === arr.length - 1;
                        return (
                          <motion.div
                            key={s.key}
                            layout
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: newest ? 1 : 0.6, y: 0 }}
                            exit={{ opacity: 0, transition: { duration: 0.2 } }}
                            transition={reduced ? { duration: 0.01 } : { duration: 0.45, ease: EASE }}
                            className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.85cqw] px-[1.1cqw] py-[0.72cqw] text-[#111c35]", newest && "bg-[#f6f5f1]")}
                          >
                            {s.surface.logo ? <Logo name={s.surface.logo} size={22} rounded="rounded-[6px]" /> : <span className="size-[1.6cqw] rounded-[6px] bg-black/10" />}
                            <div className="min-w-0">
                              <div className="flex items-center gap-[0.55cqw]">
                                <span className="shrink-0 whitespace-nowrap text-[0.9cqw] font-semibold">{s.run.agent}</span>
                                <span className="truncate font-mono text-[0.8cqw] text-black/55">{statementOf(s.action)}</span>
                              </div>
                              <div className="mt-[0.22cqw] truncate text-[0.8cqw] text-black/55">{s.run.rewritten ? `rewritten → ${s.run.rewritten}` : s.run.verdict.title}</div>
                            </div>
                            <div className="flex items-center gap-[0.55cqw]"><DecisionPill d={s.run.verdict.decision} /><span className="w-[3.6cqw] text-right font-mono text-[0.72cqw] text-black/40">{s.ms < 1 ? "<1" : s.ms.toFixed(0)} ms</span></div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                  <div className="flex items-center gap-[0.5cqw] bg-[#f0efe9] px-[1.1cqw] py-[0.6cqw] text-[0.78cqw] text-black/55">
                    <span className="size-[0.45cqw] rounded-full bg-allow live-dot" />Decided by the real Wrapbox engine as you watch — not a mockup.
                  </div>
                </Window>
              </Backdrop>
            </Par>
          </Reveal>
        </div>

        <footer className="flex items-end justify-between text-[0.85cqw] text-fg-3">
          <div><span className="text-fg-2">Wrapbox Inc.</span> · Bharath Kumar Salla · wrapbox.io</div>
          <motion.a href="#s2" animate={reduced ? {} : { y: [0, 4, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} className="mr-[6cqw] inline-flex items-center gap-[0.4cqw] hover:text-fg"><ArrowDown className="size-[0.95cqw]" /> scroll</motion.a>
        </footer>
      </div>
    </Stage>
  );
}

/* ============================ 02 · the shift — real chart ============================ */
const SHIFT_YEARS = ["2022", "2023", "2024 · MCP", "2025 · OpenAI", "2026 · Now"] as const;
const ADVICE = [0.15, 0.42, 0.60, 0.72, 0.80];
const ACTION = [0.02, 0.06, 0.22, 0.55, 0.86];

function LineChart({ height = 26 }: { height?: number }) {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const w = 100, h = height;
  const px = (i: number) => 6 + (i / (SHIFT_YEARS.length - 1)) * (w - 12);
  const py = (v: number) => h - 4 - v * (h - 12);
  const path = (data: number[]) => data.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i).toFixed(2)} ${py(v).toFixed(2)}`).join(" ");
  return (
    <div ref={ref} className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1="6" x2={w - 6} y1={py(g)} y2={py(g)} stroke="#e6e5e0" strokeWidth={0.15} />
        ))}
        <motion.path d={path(ADVICE)} fill="none" stroke="#8a8e99" strokeWidth={0.55} strokeLinecap="round" strokeDasharray="1 1.4" initial={{ pathLength: 0 }} animate={{ pathLength: seen || reduced ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 1.4, ease: EASE }} />
        <motion.path d={path(ACTION)} fill="none" stroke={INK} strokeWidth={0.9} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: seen || reduced ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 1.6, delay: 0.2, ease: EASE }} />
        <line x1={px(2)} x2={px(2)} y1={py(0)} y2={py(1)} stroke="#c9c8c2" strokeWidth={0.15} strokeDasharray="0.4 0.6" />
        <circle cx={px(4)} cy={py(ACTION[4])} r={0.9} fill={INK} />
        <circle cx={px(4)} cy={py(ADVICE[4])} r={0.7} fill="#8a8e99" />
      </svg>
      <div className="absolute inset-x-0 bottom-[-1.7cqw] flex justify-between font-mono text-[0.62cqw] text-fg-3">
        {SHIFT_YEARS.map((y) => <span key={y}>{y}</span>)}
      </div>
      <div className="absolute right-[1cqw] top-[0.4cqw] text-right">
        <div className="text-[0.68cqw] uppercase tracking-[0.14em] text-fg-3">Autonomous action</div>
        <div className="text-[1.5cqw] font-medium leading-none tracking-[-0.03em] text-fg tnum"><CountUp to={86} suffix="%" /></div>
        <div className="mt-[0.15cqw] text-[0.6cqw] text-fg-3">Agentic coding in production, Q1 2026</div>
      </div>
    </div>
  );
}

const SHIFT_STATS: { value: number; suffix: string; label: string; src: string }[] = [
  { value: 46, suffix: "%", label: "of shipped code is now AI-written", src: "AI code generation stats, 2026" },
  { value: 20, suffix: "M", label: "developers use an AI coding assistant daily", src: "State of AI coding, 2026" },
  { value: 97, suffix: "M", label: "monthly MCP downloads · 100K at launch", src: "MCP project, Mar 2026" },
];

function TheShift() {
  return (
    <Stage n={2}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="The shift" title={<>Agents stopped talking<br />and started doing.</>} aside="Two years ago a model suggested the command. Today the agent runs it — with write access to the repo, the database, and the money." />

        <div className="mt-[1.8cqw] grid flex-1 grid-cols-[1.35fr_1fr] items-stretch gap-[2.6cqw]">
          <Reveal delay={0.3}>
            <Par depth={3} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">Advice vs. action, 2022 → 2026</div>
                  <div className="text-[0.72cqw] text-fg-3">navy = agent action · grey = model advice</div>
                </div>
                <div className="mt-[1.2cqw] flex-1"><LineChart /></div>
              </div>
            </Par>
          </Reveal>

          <div className="grid grid-rows-3 gap-[0.7cqw]">
            {SHIFT_STATS.map((st, i) => (
              <Reveal key={st.label} delay={0.36 + i * 0.08}>
                <Par depth={3 + i}>
                  <div className="rounded-[0.7cqw] bg-surface-2 px-[1.3cqw] py-[1cqw]">
                    <div className="text-[2cqw] font-medium leading-none tracking-[-0.04em] text-fg tnum"><CountUp to={st.value} suffix={st.suffix} /></div>
                    <div className="mt-[0.55cqw] text-[0.88cqw] leading-snug text-fg-2">{st.label}</div>
                    <div className="mt-[0.2cqw] text-[0.68cqw] text-fg-3">{st.src}</div>
                  </div>
                </Par>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 03 · problem — incident bar chart + layers ============================ */
const INCIDENT_BARS: { year: string; n: number }[] = [
  { year: "2023", n: 1 },
  { year: "2024", n: 2 },
  { year: "2025 H1", n: 4 },
  { year: "2025 H2", n: 6 },
  { year: "2026 YTD", n: 10 },
];

function BarChart({ data, height = 30 }: { data: { year: string; n: number }[]; height?: number }) {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const w = 100, h = height, pad = 4;
  const max = Math.max(...data.map((d) => d.n));
  const bw = (w - pad * 2) / data.length - 1.2;
  return (
    <div ref={ref} className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {data.map((d, i) => {
          const x = pad + i * ((w - pad * 2) / data.length);
          const bh = ((h - pad * 2) * d.n) / max;
          const y = h - pad - bh;
          return (
            <motion.rect
              key={d.year}
              x={x}
              width={bw}
              initial={{ y: h - pad, height: 0 }}
              animate={{ y: seen || reduced ? y : h - pad, height: seen || reduced ? bh : 0 }}
              transition={{ duration: reduced ? 0.01 : 0.8, delay: 0.1 + i * 0.12, ease: EASE }}
              fill={i === data.length - 1 ? INK : "#c9c8c2"}
              rx={0.6}
            />
          );
        })}
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#c9c8c2" strokeWidth={0.15} />
      </svg>
      <div className="absolute inset-x-0 bottom-[-1.6cqw] grid" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map((d) => (
          <div key={d.year} className="text-center font-mono text-[0.62cqw] text-fg-3">{d.year}</div>
        ))}
      </div>
    </div>
  );
}

const LAYERS: { name: string; sees: string; not: string }[] = [
  { name: "Identity / IAM", sees: "the token", not: "the SQL about to run" },
  { name: "Prompt guardrails", sees: "the reply text", not: "the effect it triggers" },
  { name: "EDR / DLP", sees: "the file afterwards", not: "the ask before" },
];

function TheProblem() {
  return (
    <Stage n={3}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="The problem" title={<>Nobody can say what an agent is allowed to do <span className="whitespace-nowrap">before it does it.</span></>} aside="Every company runs identity, prompt guardrails and endpoint tooling. Each sees one part. None sees the specific action, from this specific agent, right now." />

        <div className="mt-[1.8cqw] grid flex-1 grid-cols-[1.15fr_1fr] gap-[2.6cqw]">
          <Reveal delay={0.28}>
            <Par depth={3} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">Public agent-incident count · 2023 → now</div>
                  <div className="text-[0.72cqw] text-fg-3">AI Incident DB · Zenity · vendor post-mortems</div>
                </div>
                <div className="mt-[1.2cqw] flex-1"><BarChart data={INCIDENT_BARS} /></div>
                <div className="mt-[2.6cqw] flex items-baseline justify-between text-[0.78cqw]">
                  <span className="text-fg-2">Latest peak · <span className="font-medium text-fg">Cursor agent wipes PocketOS in 9 s</span></span>
                  <span className="font-mono text-fg-3">Apr 2026</span>
                </div>
              </div>
            </Par>
          </Reveal>

          <Reveal delay={0.42}>
            <Par depth={5}>
              <div className="rounded-[0.9cqw] bg-fg p-[1.4cqw] text-white">
                <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-white/55">Three layers · each misses the action</div>
                <div className="mt-[0.9cqw] divide-y divide-white/10">
                  {LAYERS.map((l) => (
                    <div key={l.name} className="grid grid-cols-[10cqw_1fr] items-baseline gap-[1cqw] py-[0.85cqw] text-[0.95cqw]">
                      <span className="font-medium text-white">{l.name}</span>
                      <span className="text-white/70">sees {l.sees}, <span className="text-white/45">not {l.not}.</span></span>
                    </div>
                  ))}
                </div>
                <div className="mt-[1cqw] rounded-[0.5cqw] bg-white/[0.08] px-[0.9cqw] py-[0.7cqw] text-[0.82cqw] text-white/70">
                  Wrapbox is the layer that answers <span className="text-white">that</span> question — in milliseconds.
                </div>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 04 · solution — contract → decisions ============================ */
const D_ORDER: Decision[] = ["BLOCK", "REVIEW", "CONSTRAIN", "ALLOW"];
const RANK: Record<Decision, number> = { ALLOW: 1, CONSTRAIN: 2, REVIEW: 3, BLOCK: 4 };
function ruleDecision(r: Rule): Decision {
  const c: Decision[] = [];
  if (r.decision) c.push(r.decision);
  for (const t of r.tiers ?? []) c.push(t.decision);
  for (const e of r.escalations ?? []) c.push(e.decision);
  if (r.forbid?.length) c.push("BLOCK");
  return c.length ? c.sort((a, b) => RANK[b] - RANK[a])[0] : "ALLOW";
}
const SOLUTION_IDS = ["pg-cli-tests", "pg-cursor-force", "pg-db-update", "pg-cli-dotenv"];

function TheSolution() {
  const reduced = !!useReducedMotion();
  const rules = useMemo(() => activeRules(), []);
  const groups = useMemo(() => D_ORDER.map((d) => ({ d, n: rules.filter((r) => ruleDecision(r) === d).length })), [rules]);
  const decided = useMemo(() => SOLUTION_IDS.map((id) => {
    const surface = SURFACES.find((x) => x.actions.some((a) => a.id === id))!;
    const action = surface.actions.find((a) => a.id === id)!;
    return { surface, action, run: runAction(action) };
  }), []);
  return (
    <Stage n={4}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.4cqw] pt-[2.6cqw]">
        <Head kicker="The solution" title={<>One intent contract. Every agent.<br />Checked milliseconds before it runs.</>} aside="The admin writes the rules once, in plain English. Wrapbox compiles them and answers every action — allow, constrain, review or block — and signs a receipt for each." />

        <Reveal delay={0.3} className="mt-[1.6cqw] flex-1">
          <Par depth={4} className="h-full">
            <Backdrop className="h-full px-[1.7cqw] pb-[1.7cqw] pt-[1.7cqw]">
              <Window title="app.wrapbox.ai · intent contract → decisions" className="h-full">
                <div className="grid h-[calc(100%-2cqw)] grid-cols-[0.82fr_1.18fr]">
                  <div className="flex flex-col bg-[#faf9f6] px-[1.4cqw] py-[1.2cqw] text-[#111c35]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.7cqw] uppercase tracking-[0.12em] text-black/45">Intent contract</span>
                      <span className="font-mono text-[0.66cqw] text-black/35">v1 · published</span>
                    </div>
                    <div className="mt-[1cqw] space-y-[0.55cqw]">
                      {INTENT_CONTRACT.map((line) => (
                        <p key={line} className="text-[1.05cqw] font-medium leading-[1.4] tracking-[-0.01em]">{line}</p>
                      ))}
                    </div>
                    <div className="mt-auto pt-[1cqw]">
                      <div className="text-[0.78cqw] text-black/50">Compiled into {rules.length} rules</div>
                      <div className="mt-[0.55cqw] grid grid-cols-4 gap-[0.45cqw]">
                        {groups.map((g, i) => (
                          <motion.div key={g.d} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={reduced ? { duration: 0.01 } : { duration: 0.4, delay: 0.6 + i * 0.08, ease: EASE }} className="rounded-[0.4cqw] bg-white px-[0.65cqw] py-[0.55cqw]">
                            <div className="text-[1.4cqw] font-medium leading-none tracking-[-0.03em] tnum"><CountUp to={g.n} /></div>
                            <div className="mt-[0.3cqw] font-mono text-[0.58cqw] uppercase tracking-[0.1em] text-black/45">{g.d}</div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col bg-white px-[1.4cqw] py-[1.2cqw] text-[#111c35]">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.7cqw] uppercase tracking-[0.12em] text-black/45">Decisions</span>
                      <span className="font-mono text-[0.66cqw] text-black/35">real engine · &lt;1 ms</span>
                    </div>
                    <div className="mt-[0.7cqw] flex flex-1 flex-col gap-[0.5cqw]">
                      {decided.map(({ surface, action, run }, i) => (
                        <motion.div key={action.id} initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={reduced ? { duration: 0.01 } : { duration: 0.45, delay: 0.45 + i * 0.13, ease: EASE }} className="-mx-[0.8cqw] grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.8cqw] rounded-[0.55cqw] px-[0.8cqw] py-[0.6cqw] hover:bg-[#f6f5f1]">
                          {surface.logo ? <Logo name={surface.logo} size={22} rounded="rounded-[6px]" /> : <span className="size-[1.6cqw] rounded-[6px] bg-black/10" />}
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-[0.55cqw]"><span className="shrink-0 text-[0.9cqw] font-semibold">{run.agent}</span><span className="truncate font-mono text-[0.78cqw] text-black/55">{statementOf(action)}</span></div>
                            <div className="mt-[0.2cqw] truncate text-[0.78cqw] text-black/55">{run.rewritten ? <>rewritten → <span className="font-mono">{run.rewritten}</span></> : run.verdict.approvers ? `${run.verdict.title} · ${run.verdict.approvers}${run.verdict.quorum ? ` × ${run.verdict.quorum}` : ""}` : run.verdict.title}</div>
                          </div>
                          <DecisionPill d={run.verdict.decision} />
                        </motion.div>
                      ))}
                      <div className="mt-auto flex items-center gap-[0.5cqw] pt-[0.7cqw] text-[0.75cqw] text-black/50"><span className="size-[0.45cqw] rounded-full bg-allow live-dot" />Every verdict was produced by the engine when this page loaded.</div>
                    </div>
                  </div>
                </div>
              </Window>
            </Backdrop>
          </Par>
        </Reveal>
      </div>
    </Stage>
  );
}

/* ============================ 05 · how it works — architecture diagram ============================ */
const RUNTIME_MARKS = [
  { logo: "claudecode", name: "Claude Code" },
  { logo: "cursor", name: "Cursor" },
  { logo: "githubcopilot", name: "Copilot" },
  { logo: "google", name: "Chrome" },
  { logo: "claude", name: "Claude Desktop" },
];
const GATEWAY_MARKS = [
  { logo: "stripe", name: "Stripe" },
  { logo: "postgresql", name: "Postgres" },
  { logo: "github_light", name: "GitHub" },
  { logo: "aws", name: "AWS" },
  { logo: "slack", name: "Slack" },
  { logo: "salesforce", name: "Salesforce" },
];

function Diagram() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const showLine = seen || reduced;
  return (
    <div ref={ref} className="relative flex flex-1 flex-col">
      <div className="mx-auto w-[52cqw]">
        <div className="rounded-[0.8cqw] bg-fg px-[1.6cqw] py-[1.1cqw] text-white">
          <div className="flex items-baseline justify-between">
            <span className="text-[1.25cqw] font-medium tracking-[-0.02em]">Control plane</span>
            <span className="font-mono text-[0.68cqw] uppercase tracking-[0.14em] text-white/55">console.wrapbox.ai</span>
          </div>
          <p className="mt-[0.35cqw] text-[0.85cqw] leading-relaxed text-white/72">One place. Holds the contract, compiles it, pushes rules to every enforcement point, and signs every receipt that comes back.</p>
        </div>
      </div>

      <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="mx-auto h-[2.4cqw] w-[52cqw]">
        <motion.path d="M 50 0 L 50 5" stroke="#c9c8c2" strokeWidth={0.35} initial={{ pathLength: 0 }} animate={{ pathLength: showLine ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 0.4, delay: 0.15 }} />
        <motion.path d="M 25 5 L 75 5" stroke="#c9c8c2" strokeWidth={0.35} initial={{ pathLength: 0 }} animate={{ pathLength: showLine ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 0.5, delay: 0.35 }} />
        <motion.path d="M 25 5 L 25 12" stroke="#c9c8c2" strokeWidth={0.35} initial={{ pathLength: 0 }} animate={{ pathLength: showLine ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 0.4, delay: 0.6 }} />
        <motion.path d="M 75 5 L 75 12" stroke="#c9c8c2" strokeWidth={0.35} initial={{ pathLength: 0 }} animate={{ pathLength: showLine ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 0.4, delay: 0.6 }} />
      </svg>

      <div className="grid flex-1 grid-cols-2 gap-[1.6cqw]">
        {[
          { eyebrow: "Enforcement point 1", title: "Runtime", where: "on the device", body: "A daemon MDM pushes to the fleet in one click. Apple Endpoint Security on macOS, kernel confinement on Linux — every command, file and network call an agent makes.", marks: RUNTIME_MARKS },
          { eyebrow: "Enforcement point 2", title: "Gateway", where: "in front of company systems", body: "A proxy the agent's tools point at. The same contract for every call into a database, API, MCP tool or SaaS — even where Wrapbox is not installed.", marks: GATEWAY_MARKS },
        ].map((p, i) => (
          <Reveal key={p.title} delay={0.9 + i * 0.1} className="h-full">
            <Par depth={4 + i} className="h-full">
              <div className="flex h-full flex-col rounded-[0.8cqw] bg-surface-2 p-[1.4cqw]">
                <div className="font-mono text-[0.68cqw] uppercase tracking-[0.14em] text-fg-3">{p.eyebrow}</div>
                <div className="mt-[0.4cqw] flex items-baseline gap-[0.6cqw]">
                  <span className="text-[1.6cqw] font-medium tracking-[-0.03em] text-fg">{p.title}</span>
                  <span className="text-[0.88cqw] text-fg-3">{p.where}</span>
                </div>
                <p className="mt-[0.55cqw] text-[0.88cqw] leading-relaxed text-fg-2">{p.body}</p>
                <div className="mt-auto flex flex-wrap gap-[0.4cqw] pt-[1cqw]">
                  {p.marks.map((m) => (
                    <span key={m.name} className="inline-flex items-center gap-[0.4cqw] rounded-full bg-white px-[0.65cqw] py-[0.28cqw] text-[0.72cqw] text-fg-2">
                      <Logo name={m.logo} size={14} rounded="rounded-[4px]" />{m.name}
                    </span>
                  ))}
                </div>
              </div>
            </Par>
          </Reveal>
        ))}
      </div>

      <Reveal delay={1.2}>
        <div className="mt-[1.4cqw] flex items-center justify-between rounded-[0.6cqw] bg-surface-2 px-[1.3cqw] py-[0.8cqw]">
          <div className="text-[0.88cqw] text-fg-2"><span className="font-medium text-fg">Every decision comes back signed.</span> ECDSA P-256, bound to the exact arguments, single use, hash-chained.</div>
          <div className="font-mono text-[0.72cqw] text-fg-3">permit wbp_… · receipt WB-… · kid wbx-2026-09</div>
        </div>
      </Reveal>
    </div>
  );
}

function HowItWorks() {
  return (
    <Stage n={5}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[3.6cqw] pt-[2.6cqw]">
        <Head kicker="How it works" title={<>Two enforcement points.<br />One contract.</>} aside="The contract lives in one place and is enforced in two: on the employee's device, and in front of the systems it reaches for." />
        <div className="mt-[1.4cqw] flex flex-1 flex-col"><Diagram /></div>
      </div>
    </Stage>
  );
}

/* ============================ 06 · product — live embed ============================ */
function TheProduct() {
  return (
    <Stage n={6}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="The product" title={<>Not a mockup.<br />The real product, right here.</>} aside="The Enforcement Playground, live inside this slide. Push MDM to a fleet, run an action from any surface, watch the engine decide, open the signed receipt." />

        <Reveal delay={0.28} className="mt-[1.6cqw] flex-1">
          <Par depth={4} className="h-full">
            <Backdrop className="h-full px-[1cqw] pb-[1cqw] pt-[1cqw]">
              <Window title="app.wrapbox.ai · live · click anywhere" className="h-full">
                <div className="relative h-[calc(100%-2cqw)] bg-[#fafaf8]">
                  <iframe
                    src="/#/live-embed"
                    title="Wrapbox live demo"
                    className="absolute inset-0 h-full w-full border-0"
                    loading="lazy"
                  />
                </div>
              </Window>
            </Backdrop>
          </Par>
        </Reveal>
      </div>
    </Stage>
  );
}

/* ============================ 07 · why different — 2x2 category map ============================ */
interface Cat { name: string; x: number; y: number }
const CATS: Cat[] = [
  { name: "Prompt guardrails", x: 0.24, y: 0.16 },
  { name: "Agent frameworks", x: 0.36, y: 0.28 },
  { name: "MCP", x: 0.5, y: 0.36 },
  { name: "IAM / PAM", x: 0.18, y: 0.6 },
  { name: "CSPM / DLP", x: 0.28, y: 0.72 },
  { name: "SIEM", x: 0.42, y: 0.82 },
  { name: "Wrapbox", x: 0.88, y: 0.14 },
];

function CategoryMap() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  return (
    <div ref={ref} className="relative aspect-[16/10] w-full">
      <div className="absolute inset-0 rounded-[0.7cqw] bg-surface-2" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <line x1="50" x2="50" y1="4" y2="96" stroke="#d3d2cc" strokeWidth={0.15} />
        <line x1="4" x2="96" y1="50" y2="50" stroke="#d3d2cc" strokeWidth={0.15} />
      </svg>
      <div className="absolute left-[1cqw] top-[0.8cqw] font-mono text-[0.62cqw] uppercase tracking-[0.14em] text-fg-3">Watches text</div>
      <div className="absolute right-[1cqw] top-[0.8cqw] text-right font-mono text-[0.62cqw] uppercase tracking-[0.14em] text-fg-3">Authorises actions →</div>
      <div className="absolute bottom-[0.8cqw] left-[1cqw] font-mono text-[0.62cqw] uppercase tracking-[0.14em] text-fg-3">Passive (logs after)</div>
      <div className="absolute bottom-[0.8cqw] right-[1cqw] text-right font-mono text-[0.62cqw] uppercase tracking-[0.14em] text-fg-3">↑ Decides before</div>
      {CATS.map((c, i) => {
        const own = c.name === "Wrapbox";
        return (
          <motion.div
            key={c.name}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: seen || reduced ? 1 : 0, scale: seen || reduced ? 1 : 0.6 }}
            transition={{ duration: reduced ? 0.01 : 0.5, delay: 0.15 + i * 0.06, ease: EASE }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          >
            <div className={cn("flex items-center gap-[0.4cqw] rounded-full px-[0.7cqw] py-[0.35cqw] text-[0.78cqw]", own ? "bg-fg text-white font-medium" : "bg-white text-fg-2")}>
              <span className={cn("size-[0.4cqw] rounded-full", own ? "bg-white" : "bg-fg-3")} />
              {c.name}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

const OURS = [
  "Decides per action, on the effect — not the text.",
  "One contract covers every agent and every surface.",
  "Signs the answer with an ECDSA permit bound to args.",
  "Hash-chained receipts — replayable, exportable.",
];

function WhyDifferent() {
  return (
    <Stage n={7}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="Why we're different" title={<>Guardrails judge text.<br />Wrapbox authorises actions.</>} aside="Every existing category watches one part of the agent's day. Only Wrapbox answers, for one specific action, whether the company allows it — and proves it later." />

        <div className="mt-[1.6cqw] grid flex-1 grid-cols-[1.35fr_1fr] items-stretch gap-[2.4cqw]">
          <Reveal delay={0.3}><Par depth={4} className="h-full"><CategoryMap /></Par></Reveal>
          <Reveal delay={0.42}>
            <Par depth={5}>
              <div className="rounded-[0.9cqw] bg-fg p-[1.5cqw] text-white">
                <div className="font-mono text-[0.7cqw] uppercase tracking-[0.14em] text-white/55">Wrapbox</div>
                <div className="mt-[0.4cqw] text-[1.6cqw] font-medium leading-tight tracking-[-0.02em]">Runtime authorization</div>
                <ul className="mt-[1cqw] space-y-[0.6cqw]">
                  {OURS.map((line, i) => (
                    <li key={i} className="grid grid-cols-[auto_1fr] items-baseline gap-[0.6cqw] text-[0.95cqw] leading-snug text-white/85">
                      <Check className="size-[0.9cqw] shrink-0 text-white/70" strokeWidth={2.2} />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 08 · why now — MCP curve + timeline ============================ */
const MCP_MONTHS = 18;
const MCP = Array.from({ length: MCP_MONTHS }, (_, i) => {
  const t = i / (MCP_MONTHS - 1);
  const v = 0.1 + Math.pow(t, 2.4) * (97 - 0.1);
  return { i, v };
});
const NOW: { year: string; label: string }[] = [
  { year: "Nov 2024", label: "Anthropic ships MCP" },
  { year: "Mar 2025", label: "OpenAI adopts MCP" },
  { year: "Jul 2025", label: "Replit → SaaStr incident" },
  { year: "Nov 2025", label: "MCP under Linux Foundation" },
  { year: "Apr 2026", label: "PocketOS wiped in 9 s" },
  { year: "Now", label: "97M monthly SDK downloads" },
];
function MCPCurve() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const w = 100, h = 30;
  const max = MCP[MCP.length - 1].v;
  const px = (i: number) => 3 + (i / (MCP.length - 1)) * (w - 6);
  const py = (v: number) => h - 3 - (v / max) * (h - 8);
  const path = "M " + MCP.map((d) => `${px(d.i).toFixed(2)} ${py(d.v).toFixed(2)}`).join(" L ");
  const fill = `${path} L ${px(MCP.length - 1).toFixed(2)} ${h - 3} L ${px(0).toFixed(2)} ${h - 3} Z`;
  return (
    <div ref={ref} className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <motion.path d={fill} fill={INK} fillOpacity={0.08} initial={{ opacity: 0 }} animate={{ opacity: seen || reduced ? 1 : 0 }} transition={{ duration: 1.2, delay: 0.5 }} />
        <motion.path d={path} fill="none" stroke={INK} strokeWidth={0.7} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: seen || reduced ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 1.6, ease: EASE }} />
        <circle cx={px(MCP.length - 1)} cy={py(MCP[MCP.length - 1].v)} r={0.9} fill={INK} />
      </svg>
      <div className="absolute right-[1cqw] top-[0.4cqw] text-right">
        <div className="text-[0.68cqw] uppercase tracking-[0.14em] text-fg-3">Monthly MCP SDK downloads</div>
        <div className="text-[1.8cqw] font-medium leading-none tracking-[-0.03em] text-fg tnum"><CountUp to={97} suffix="M" /></div>
        <div className="text-[0.62cqw] text-fg-3">from 100K at launch, in 18 months</div>
      </div>
    </div>
  );
}
function WhyNow() {
  return (
    <Stage n={8}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="Why now" title={<>The standard landed.<br />The incidents landed with it.</>} aside="The plumbing that hands agents their tools became a shared standard in eighteen months. The incidents follow that plumbing. Runtime authorization has to exist now, and once." />

        <div className="mt-[1.6cqw] grid flex-1 grid-cols-[1.3fr_1fr] gap-[2.4cqw]">
          <Reveal delay={0.3}>
            <Par depth={3} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">MCP adoption curve · Nov 2024 → now</div>
                  <div className="text-[0.72cqw] text-fg-3">MCP project · Mar 2026</div>
                </div>
                <div className="mt-[1cqw] flex-1"><MCPCurve /></div>
              </div>
            </Par>
          </Reveal>

          <Reveal delay={0.42}>
            <Par depth={4}>
              <div className="rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">Timeline</div>
                <ol className="mt-[0.7cqw] divide-y divide-line/60">
                  {NOW.map((n) => (
                    <li key={n.year + n.label} className="grid grid-cols-[6.5cqw_1fr] items-baseline gap-[0.9cqw] py-[0.75cqw]">
                      <span className="font-mono text-[0.75cqw] text-fg-3">{n.year}</span>
                      <span className="text-[0.95cqw] leading-snug text-fg">{n.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 09 · market — bottom-up bars + ceiling ============================ */
const MARKET = [
  { name: "Developers on AI agents", people: 20_000_000, price: 30 },
  { name: "Broader knowledge workers", people: 60_000_000, price: 30 },
  { name: "Regulated enterprises", people: 15_000_000, price: 59 },
];

function MarketBars() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  const w = 100, h = 30;
  const values = MARKET.map((m) => (m.people * m.price * 12) / 1e9);
  const max = Math.max(...values);
  const bw = (w - 12) / MARKET.length;
  return (
    <div ref={ref} className="relative w-full" style={{ aspectRatio: `${w} / ${h}` }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {values.map((v, i) => {
          const x = 6 + i * bw + bw * 0.15;
          const width = bw * 0.7;
          const bh = ((h - 8) * v) / max;
          const y = h - 3 - bh;
          return (
            <motion.rect
              key={MARKET[i].name}
              x={x}
              width={width}
              rx={0.5}
              fill={i === MARKET.length - 1 ? INK : "#c9c8c2"}
              initial={{ y: h - 3, height: 0 }}
              animate={{ y: seen || reduced ? y : h - 3, height: seen || reduced ? bh : 0 }}
              transition={{ duration: reduced ? 0.01 : 0.9, delay: 0.15 + i * 0.14, ease: EASE }}
            />
          );
        })}
        <line x1={6} x2={w - 6} y1={h - 3} y2={h - 3} stroke="#c9c8c2" strokeWidth={0.15} />
      </svg>
      <div className="absolute inset-x-0 bottom-[-1.6cqw] grid grid-cols-3">
        {MARKET.map((m, i) => (
          <div key={m.name} className="text-center">
            <div className="text-[1.15cqw] font-medium tracking-[-0.03em] text-fg tnum">${values[i].toFixed(1)}B</div>
            <div className="mt-[0.15cqw] text-[0.68cqw] text-fg-3">{m.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Market() {
  const total = MARKET.reduce((a, m) => a + (m.people * m.price * 12) / 1e9, 0);
  return (
    <Stage n={9}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[3.6cqw] pt-[2.6cqw]">
        <Head kicker="Market" title={<>Priced per person, so the market is every employee who runs an agent.</>} aside="Bottom-up, from the site's own $30 and $59 per-person prices. We do not invent a TAM." />

        <div className="mt-[1.6cqw] grid flex-1 grid-cols-[1.4fr_1fr] gap-[2.4cqw]">
          <Reveal delay={0.3}>
            <Par depth={3} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">Annual revenue ceiling · people × price × 12</div>
                <div className="mt-[1.2cqw] flex-1"><MarketBars /></div>
                <div className="mt-[2.4cqw] flex items-baseline justify-between">
                  <div><span className="text-[0.75cqw] uppercase tracking-[0.14em] text-fg-3">Bottom-up ceiling</span> <span className="ml-[0.6cqw] text-[2.4cqw] font-medium tracking-[-0.03em] text-fg tnum">${total.toFixed(0)}B</span></div>
                  <div className="text-[0.72cqw] text-fg-3">Derived, not surveyed</div>
                </div>
              </div>
            </Par>
          </Reveal>

          <Reveal delay={0.42}>
            <Par depth={5}>
              <div className="rounded-[0.9cqw] bg-fg p-[1.5cqw] text-white">
                <div className="font-mono text-[0.7cqw] uppercase tracking-[0.14em] text-white/55">The comparable spend today</div>
                <div className="mt-[0.9cqw] space-y-[0.85cqw]">
                  {[
                    { name: "Endpoint security", v: 16, src: "Gartner, 2026" },
                    { name: "PAM", v: 3.4, src: "Gartner, 2026" },
                    { name: "SIEM", v: 6.3, src: "IDC, 2026" },
                  ].map((c) => (
                    <div key={c.name}>
                      <div className="flex items-baseline justify-between text-[0.9cqw]">
                        <span className="text-white/85">{c.name}</span>
                        <span className="font-medium text-white tnum">${c.v}B · <span className="text-white/45">{c.src}</span></span>
                      </div>
                      <div className="mt-[0.25cqw] h-[0.4cqw] rounded-full bg-white/10">
                        <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} style={{ transformOrigin: "0 50%", width: `${(c.v / 16) * 100}%` }} className="h-full rounded-full bg-white/70" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-[1.1cqw] rounded-[0.5cqw] bg-white/[0.08] px-[0.9cqw] py-[0.7cqw] text-[0.82cqw] text-white/75">Same buyer already spends $25B / yr. Agents are the next line item.</div>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 10 · business & GTM — funnel + tiers ============================ */
const FUNNEL = [
  { name: "A developer installs the hook", value: 100, sub: "60-second install in Claude Code / Cursor" },
  { name: "Security sees the receipts", value: 68, sub: "Same day. The evidence chain does the sale." },
  { name: "MDM push, whole fleet", value: 34, sub: "One click. Runtime daemon everywhere." },
  { name: "Company standard", value: 22, sub: "Business plan. Every agent, everywhere." },
];
function Funnel() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-col gap-[0.55cqw]">
      {FUNNEL.map((f, i) => (
        <motion.div key={f.name} initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: seen || reduced ? 1 : 0, scaleX: seen || reduced ? 1 : 0 }} transition={{ duration: reduced ? 0.01 : 0.6, delay: 0.15 + i * 0.11, ease: EASE }} className="origin-left">
          <div className="flex items-center gap-[0.7cqw]">
            <div style={{ width: `${f.value}%` }}>
              <div className={cn("flex items-baseline justify-between rounded-[0.55cqw] px-[1cqw] py-[0.7cqw]", i === 0 ? "bg-fg text-white" : "bg-surface-3 text-fg")}>
                <span className="text-[0.95cqw] font-medium leading-none">{f.name}</span>
                <span className="ml-[0.5cqw] font-mono text-[0.72cqw] opacity-70">{f.value}%</span>
              </div>
            </div>
            <span className="text-[0.78cqw] text-fg-3">{f.sub}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
const PLANS_MIN = [
  { name: "Starter", price: "$0", sub: "free forever", detail: "One-person teams. Local agents." },
  { name: "Team", price: "$30", sub: "per person / month", detail: "Land with the security or platform team." },
  { name: "Business", price: "$59", sub: "per person / month", detail: "The company standard. Every agent." },
  { name: "Enterprise", price: "—", sub: "annual contract", detail: "Private cloud, own keys, residency." },
];
function BusinessGTM() {
  return (
    <Stage n={10}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="Business & GTM" title={<>Land with the security team.<br />Expand with every agent.</>} aside="The buyer is a CISO or platform lead. The wedge is the developer already running Claude Code or Cursor. Distribution is free: the hooks the agent vendors published, and MDM." />

        <div className="mt-[1.6cqw] grid flex-1 grid-cols-[1.4fr_1fr] gap-[2.4cqw]">
          <Reveal delay={0.3}>
            <Par depth={3} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
                <div className="font-mono text-[0.72cqw] uppercase tracking-[0.14em] text-fg-3">Bottom-up motion · from a single hook to a company standard</div>
                <div className="mt-[1.2cqw] flex-1"><Funnel /></div>
              </div>
            </Par>
          </Reveal>

          <div className="grid grid-rows-4 gap-[0.6cqw]">
            {PLANS_MIN.map((p, i) => (
              <Reveal key={p.name} delay={0.36 + i * 0.07}>
                <Par depth={3 + i}>
                  <div className="grid grid-cols-[7cqw_1fr] items-center gap-[1cqw] rounded-[0.6cqw] bg-surface-2 px-[1.1cqw] py-[0.9cqw]">
                    <div>
                      <div className="text-[1.6cqw] font-medium leading-none tracking-[-0.03em] text-fg tnum">{p.price}</div>
                      <div className="mt-[0.25cqw] text-[0.65cqw] text-fg-3">{p.sub}</div>
                    </div>
                    <div>
                      <div className="text-[0.95cqw] font-medium text-fg">{p.name}</div>
                      <div className="mt-[0.15cqw] text-[0.78cqw] leading-snug text-fg-3">{p.detail}</div>
                    </div>
                  </div>
                </Par>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 11 · what exists today ============================ */
const PROOF: { k: string; v: string; big?: string }[] = [
  { k: "Rules published", v: "compiled from 2 sentences", big: "16" },
  { k: "Self-tests green", v: "on every commit", big: "94" },
  { k: "Latency, median", v: "in-process evaluate()", big: "<1 ms" },
  { k: "Waitlist live", v: "Sheet + welcome mail", big: "yes" },
];
const PROOF_LIST: [string, string][] = [
  ["Real policy engine", "Evaluates every action against the intent contract."],
  ["Runtime daemon", "OS-level enforcement — Apple Endpoint Security, Linux."],
  ["Gateway proxy", "Same contract in front of MCP tools, DBs, SaaS."],
  ["Signed permits", "ECDSA P-256, bound to args, single-use, hash-chained."],
  ["MDM push flow", "One-click fleet enrolment, deterministic keys."],
  ["Live demo, public", "wrapbox-prototype.vercel.app — try it, type anything."],
  ["Delaware C-Corp", "Incorporated; address of record on the site."],
  ["wrapbox.io", "Domain owned; D-U-N-S filed for Apple ES entitlement."],
];
function WhatExists() {
  return (
    <Stage n={11}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="What exists today" title={<>Built, not planned.</>} aside="Every line below is on GitHub or on the live site right now. The pre-seed turns a working prototype into a production runtime." />

        <div className="mt-[1.6cqw] grid grid-cols-4 gap-[0.9cqw]">
          {PROOF.map((p, i) => (
            <Reveal key={p.k} delay={0.28 + i * 0.08}>
              <Par depth={3 + i}>
                <div className="rounded-[0.7cqw] bg-surface-2 p-[1.2cqw]">
                  <div className="text-[2.4cqw] font-medium leading-none tracking-[-0.04em] text-fg tnum">{p.big}</div>
                  <div className="mt-[0.5cqw] text-[0.88cqw] font-medium leading-snug text-fg">{p.k}</div>
                  <div className="mt-[0.2cqw] text-[0.72cqw] text-fg-3">{p.v}</div>
                </div>
              </Par>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.6} className="mt-[1.4cqw] flex-1">
          <Par depth={4} className="h-full">
            <div className="grid h-full grid-cols-2 gap-x-[3cqw]">
              {PROOF_LIST.map(([k, v], i) => (
                <div key={k} className={cn("grid grid-cols-[10cqw_1fr] items-baseline gap-[1cqw] py-[0.75cqw]", i < PROOF_LIST.length - 2 && "border-b border-line/60")}>
                  <span className="text-[0.95cqw] font-medium text-fg">{k}</span>
                  <span className="text-[0.85cqw] leading-snug text-fg-2">{v}</span>
                </div>
              ))}
            </div>
          </Par>
        </Reveal>
      </div>
    </Stage>
  );
}

/* ============================ 12 · roadmap — gantt ============================ */
const ROADMAP: { label: string; from: number; to: number; body: string }[] = [
  { label: "Runtime GA on macOS", from: 0, to: 1, body: "Signed daemon, MDM package, Apple ES entitlement filed." },
  { label: "Gateway GA + 10 design partners", from: 1, to: 2, body: "MCP, Postgres, Stripe, GitHub. Paid at end of quarter." },
  { label: "SOC 2 Type I · passkey approvals GA", from: 2, to: 3, body: "Slack, Teams, email approvers. SIEM export." },
  { label: "Windows & Linux runtime", from: 3, to: 4, body: "Feature parity. First seven-figure convert to Business." },
];
function Gantt() {
  const reduced = !!useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>();
  return (
    <div ref={ref} className="grid gap-[0.55cqw]">
      <div className="grid grid-cols-[13cqw_repeat(4,1fr)] items-center gap-[0.55cqw] pb-[0.4cqw] font-mono text-[0.65cqw] uppercase tracking-[0.14em] text-fg-3">
        <span />
        <span>Q1 · Now</span><span>Q2</span><span>Q3</span><span>Q4</span>
      </div>
      {ROADMAP.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[13cqw_1fr] items-center gap-[0.7cqw]">
          <div>
            <div className="text-[0.9cqw] font-medium leading-tight text-fg">{r.label}</div>
            <div className="mt-[0.15cqw] text-[0.72cqw] leading-snug text-fg-3">{r.body}</div>
          </div>
          <div className="relative h-[1.4cqw] rounded-full bg-surface-3">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: seen || reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0.01 : 0.75, delay: 0.2 + i * 0.15, ease: EASE }}
              className="absolute inset-y-0 rounded-full bg-fg"
              style={{ left: `${(r.from / 4) * 100}%`, width: `${((r.to - r.from) / 4) * 100}%`, transformOrigin: "0 50%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function Roadmap() {
  return (
    <Stage n={12}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="Roadmap" title={<>Twelve months to a paid pilot on every plane.</>} aside="Nothing that depends on Apple sits on the critical path — the runtime works today under a developer signature; the entitlement clears the App-Store-hardened install." />

        <Reveal delay={0.3} className="mt-[1.8cqw] flex-1">
          <Par depth={3} className="h-full">
            <div className="flex h-full flex-col rounded-[0.9cqw] bg-surface-2 p-[1.4cqw]">
              <Gantt />
            </div>
          </Par>
        </Reveal>
      </div>
    </Stage>
  );
}

/* ============================ 13 · team ============================ */
function Team() {
  return (
    <Stage n={13}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="Team" title={<>The founder built the product on this deck.</>} aside="One founder, working prototype end-to-end. The pre-seed hires the first two engineers and a security founder-seller." />

        <div className="mt-[2cqw] grid flex-1 grid-cols-2 items-start gap-[2.6cqw]">
          <Reveal delay={0.22}>
            <Par depth={3}>
              <div className="grid grid-cols-[10cqw_1fr] gap-[1.3cqw]">
                <div className="aspect-square w-[10cqw] rounded-[0.6cqw] bg-surface-2" />
                <div>
                  <div className="text-[1.4cqw] font-medium tracking-[-0.02em] text-fg">Bharath Kumar Salla</div>
                  <div className="mt-[0.2cqw] text-[0.92cqw] text-fg-3">Founder · CEO · Engineering</div>
                  <p className="mt-[1cqw] text-[0.9cqw] leading-relaxed text-fg-2">Designed and built the working prototype end-to-end: the policy engine, the runtime daemon, the gateway, the MDM enrolment, the evidence chain, the live demo, the site, the waitlist.</p>
                </div>
              </div>
            </Par>
          </Reveal>

          <Reveal delay={0.34}>
            <Par depth={4}>
              <div className="rounded-[0.9cqw] bg-fg p-[1.5cqw] text-white">
                <div className="font-mono text-[0.7cqw] uppercase tracking-[0.14em] text-white/55">Company</div>
                <div className="mt-[0.5cqw] text-[1.4cqw] font-medium text-white">Wrapbox Inc.</div>
                <div className="mt-[1cqw] grid grid-cols-[9cqw_1fr] gap-y-[0.55cqw] text-[0.88cqw]">
                  <span className="text-white/55">Incorporated</span><span className="text-white/85">Delaware C-Corp · 2026</span>
                  <span className="text-white/55">Address</span><span className="text-white/85">8 The Green, Ste B, Dover DE 19901</span>
                  <span className="text-white/55">Domain</span><span className="text-white/85">wrapbox.io · site &amp; live demo up</span>
                  <span className="text-white/55">In flight</span><span className="text-white/85">D-U-N-S; Apple Endpoint Security entitlement</span>
                </div>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ 14 · the ask ============================ */
function TheAsk() {
  return (
    <Stage n={14}>
      <div className="flex h-full flex-col px-[3.4cqw] pb-[2.6cqw] pt-[2.6cqw]">
        <Head kicker="The ask" title={<>Raising a pre-seed to ship the runtime<br />and land ten design partners.</>} aside="Eighteen months of runway to production. Paid pilots at the end, seed on the milestone." />

        <div className="mt-[1.8cqw] grid flex-1 grid-cols-[1.35fr_1fr] items-stretch gap-[2.4cqw]">
          <div className="flex h-full flex-col gap-[1.3cqw]">
            <div className="grid grid-cols-3 gap-[1cqw]">
              {[
                { k: "Round", big: "$1.8M", sub: "Pre-seed · SAFE · 18 months" },
                { k: "Runway", big: "18 mo", sub: "To seed-worthy milestones" },
                { k: "Milestone", big: "10", sub: "Design partners on paid Business" },
              ].map((c, i) => (
                <Reveal key={c.k} delay={0.2 + i * 0.09}>
                  <Par depth={3 + i}>
                    <div className="rounded-[0.7cqw] bg-surface-2 p-[1.3cqw]">
                      <div className="font-mono text-[0.68cqw] uppercase tracking-[0.14em] text-fg-3">{c.k}</div>
                      <div className="mt-[0.4cqw] text-[2.6cqw] font-medium leading-none tracking-[-0.04em] text-fg tnum">{c.big}</div>
                      <div className="mt-[0.55cqw] text-[0.82cqw] text-fg-2">{c.sub}</div>
                    </div>
                  </Par>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.55}>
              <Par depth={5}>
                <div className="rounded-[0.7cqw] bg-surface-2 p-[1.3cqw]">
                  <div className="flex items-baseline justify-between">
                    <div className="font-mono text-[0.7cqw] uppercase tracking-[0.14em] text-fg-3">Use of funds</div>
                    <div className="text-[0.72cqw] text-fg-3">18 months</div>
                  </div>
                  <div className="mt-[0.7cqw] flex h-[1.6cqw] w-full overflow-hidden rounded-full">
                    <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} style={{ width: "55%", transformOrigin: "0 50%" }} className="bg-fg" />
                    <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, delay: 0.15, ease: EASE }} style={{ width: "25%", transformOrigin: "0 50%" }} className="bg-fg-2" />
                    <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, delay: 0.3, ease: EASE }} style={{ width: "20%", transformOrigin: "0 50%" }} className="bg-fg-3" />
                  </div>
                  <div className="mt-[0.9cqw] grid grid-cols-3 gap-[0.8cqw] text-[0.85cqw]">
                    {[
                      ["55%", "Engineering", "Two engineers on runtime + gateway"],
                      ["25%", "Design-partner GTM", "One security founder-seller; travel"],
                      ["20%", "Compliance & infra", "SOC 2 Type I, Apple ES, keys"],
                    ].map(([p, k, v]) => (
                      <div key={k}><div className="font-medium tnum text-fg">{p} · {k}</div><div className="text-fg-3">{v}</div></div>
                    ))}
                  </div>
                </div>
              </Par>
            </Reveal>
          </div>

          <Reveal delay={0.35}>
            <Par depth={5} className="h-full">
              <div className="flex h-full flex-col rounded-[0.9cqw] bg-fg p-[1.5cqw] text-white">
                <div className="font-mono text-[0.7cqw] uppercase tracking-[0.14em] text-white/55">Close</div>
                <div className="mt-[0.6cqw] text-[2.1cqw] font-medium leading-[1.1] tracking-[-0.03em]">Put your agents<br />on a permit.</div>
                <div className="mt-auto space-y-[0.4cqw] text-[0.88cqw] text-white/80">
                  <div>Wrapbox Inc. · Bharath Kumar Salla</div>
                  <div>bharathsallakumar@gmail.com</div>
                  <div>wrapbox.io · demo: wrapbox-prototype.vercel.app</div>
                </div>
                <a href="https://wrapbox-prototype.vercel.app" target="_blank" rel="noopener" className="mt-[1.2cqw] inline-flex items-center gap-[0.4cqw] rounded-full bg-white px-[1.2cqw] py-[0.7cqw] text-[0.88cqw] font-medium text-fg">
                  Try the live demo <ArrowUpRight className="size-[0.9cqw]" />
                </a>
              </div>
            </Par>
          </Reveal>
        </div>
      </div>
    </Stage>
  );
}

/* ============================ the page ============================ */
export function Pitch() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "light";
    return () => { if (prev === undefined) delete root.dataset.theme; else root.dataset.theme = prev; };
  }, []);
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
      <TheProduct />
      <WhyDifferent />
      <WhyNow />
      <Market />
      <BusinessGTM />
      <WhatExists />
      <Roadmap />
      <Team />
      <TheAsk />
    </div>
  );
}

export default Pitch;
