import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, Check, Fingerprint, Loader2, Mail, Minus, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { agentById, type Decision } from "../data/agents";
import { PEOPLE } from "../data/people";
import { WrapboxLockup, WrapboxTile } from "../components/logo";
import { Avatar, CopyButton, D_DOT, cn } from "../components/ui";
import { logoUrl } from "../lib/logos";
import { go } from "../lib/router";
import { Terminal } from "./auth";

import shotOverview from "../assets/shots/overview.jpg";
import shotContract from "../assets/shots/contract.jpg";
import shotApprovals from "../assets/shots/approvals.jpg";
import shotEvidence from "../assets/shots/evidence.jpg";

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-5 sm:px-8", className)}>{children}</div>;
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 32, scale: 0.97, filter: "blur(6px)" }} whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, delay, ease: [0.2, 0.7, 0.2, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

function Pill({ d, className }: { d: Decision; className?: string }) {
  const tone: Record<Decision, string> = {
    ALLOW: "text-allow bg-allow-soft",
    CONSTRAIN: "text-constrain bg-constrain-soft",
    REVIEW: "text-review bg-review-soft",
    BLOCK: "text-block bg-block-soft",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-px font-mono text-[10.5px] font-semibold tracking-wide", tone[d], className)}>
      <span className={cn("size-1.5 rounded-full", D_DOT[d])} />
      {d}
    </span>
  );
}

/** A macOS-style window framing a real screenshot of the app. */
function AppWindow({ src, url = "app.wrapbox.ai", className }: { src: string; url?: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl bg-white ring-1 ring-black/10 shadow-[0_40px_90px_-30px_rgba(30,10,40,0.55)]", className)}>
      <div className="flex items-center gap-3 h-8 px-3 bg-[#f3f2ee] border-b border-black/[0.06]">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto rounded-md bg-white/80 px-3 h-5 grid place-items-center font-mono text-[10.5px] text-black/45">{url}</span>
        <span className="w-10" />
      </div>
      <img src={src} alt="" className="block w-full" draggable={false} />
    </div>
  );
}

/** The ribbed-glass gradient backdrop every demo sits on. */
function Backdrop({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("hero-prism relative overflow-hidden rounded-2xl", className)}>{children}</div>;
}

function SectionHead({ eyebrow, title, body, cta, onCta }: { eyebrow: string; title: string; body: string; cta?: string; onCta?: () => void }) {
  return (
    <Reveal className="max-w-[640px]">
      <div className="text-[13px] font-medium text-fg-3">{eyebrow}</div>
      <h2 className="mt-3 text-[34px] sm:text-[40px] font-medium leading-[1.08] tracking-[-0.035em] text-fg">{title}</h2>
      <p className="mt-4 text-[16.5px] leading-relaxed text-fg-2">{body}</p>
      {cta && (
        <button onClick={onCta} className="mt-5 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-fg hover:gap-2.5 transition-[gap]">
          {cta} <ArrowRight className="size-4" />
        </button>
      )}
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300 border-b", solid ? "bg-bg/80 backdrop-blur-xl border-line" : "bg-transparent border-transparent")}>
      <Container className="flex h-16 items-center gap-8">
        <a href="#/landing" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))} aria-label="Wrapbox home">
          <WrapboxLockup size={19} />
        </a>
        <nav className="flex items-center gap-6 text-[14px] text-fg-2">
          {[
            ["Product", "product"],
            ["How it works", "decide"],
            ["Integrations", "install"],
            ["Pricing", "pricing"],
            ["FAQ", "faq"],
          ].map(([l, id]) => (
            <button key={id} onClick={() => scrollTo(id)} className="hover:text-fg transition-colors">
              {l}
            </button>
          ))}
        </nav>
        <button onClick={() => scrollTo("waitlist")} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-[#111113] px-4 text-[13.5px] font-medium text-white transition-[filter] hover:brightness-125">
          Join the waitlist
        </button>
      </Container>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function PasskeyCard({ compact }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "signing" | "done">("idle");
  const approve = () => {
    setState("signing");
    setTimeout(() => setState("done"), 1100);
  };
  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 5200);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div className={cn("rounded-xl bg-white text-[#111c35] ring-1 ring-black/10 shadow-[0_24px_60px_-24px_rgba(20,8,40,0.6)]", compact ? "w-[300px] p-3.5" : "w-full p-5")}>
      <div className="flex items-center gap-2 text-[11.5px] text-black/50">
        <img src={logoUrl("slack")} alt="" className="size-3.5" />
        Slack · direct message
      </div>
      <div className="mt-2.5 flex gap-2.5">
        <WrapboxTile size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Claude Code needs your approval</div>
          <div className="mt-1 rounded-md bg-[#f6f5f1] px-2 py-1.5 font-mono text-[11px] leading-snug text-black/70 break-all">kubectl delete deployment payments-api -n prod</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-black/50">
            <Pill d="REVIEW" /> prod.k8s.delete · for Arjun Nair
          </div>
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {state === "done" ? (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg bg-allow-soft px-3 py-2 text-[11.5px] text-allow">
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="size-3.5" /> Signed by Dev Kapoor with a passkey
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] opacity-80">permit wbx_pmt_7f3a…c21 · ES256 · single use · 60 s</div>
          </motion.div>
        ) : (
          <motion.div key="btns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-2">
            <button onClick={approve} disabled={state === "signing"} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0a8a5c] px-3 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-80">
              <Fingerprint className={cn("size-3.5", state === "signing" && "animate-pulse")} />
              {state === "signing" ? "Verifying passkey…" : "Approve with passkey"}
            </button>
            <button className="h-8 rounded-lg border border-black/10 px-3 text-[12px] font-medium text-black/70">Reject</button>
            <span className="ml-auto flex -space-x-1.5">
              <Avatar p={PEOPLE.dev} size={22} />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const head = useRef<HTMLDivElement>(null);
  const demo = useRef<HTMLDivElement>(null);
  // Headline zooms out and fades as you scroll away from it.
  const { scrollYProgress: headP } = useScroll({ target: head, offset: ["start start", "end start"] });
  const headScale = useTransform(headP, [0, 1], reduce ? [1, 1] : [1, 0.9]);
  const headOpacity = useTransform(headP, [0, 0.85], reduce ? [1, 1] : [1, 0]);
  const headY = useTransform(headP, [0, 1], reduce ? [0, 0] : [0, -60]);
  // The demo starts tilted back and slightly small, then flattens and zooms to full size.
  const { scrollYProgress: inP } = useScroll({ target: demo, offset: ["start end", "start 0.25"] });
  const tilt = useTransform(inP, [0, 1], reduce ? [0, 0] : [24, 0]);
  const zoom = useTransform(inP, [0, 1], reduce ? [1, 1] : [0.84, 1]);
  const { scrollYProgress: outP } = useScroll({ target: demo, offset: ["start start", "end start"] });
  const yShot = useTransform(outP, [0, 1], reduce ? [0, 0] : [0, -80]);
  const yTerm = useTransform(outP, [0, 1], reduce ? [0, 0] : [0, -220]);
  const ySlack = useTransform(outP, [0, 1], reduce ? [0, 0] : [0, -150]);
  const zoomOut = useTransform(outP, [0, 1], reduce ? [1, 1] : [1, 0.94]);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rxMouse = useSpring(useTransform(my, [-1, 1], [3, -3]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-4, 4]), { stiffness: 120, damping: 18 });
  const tx = useSpring(useTransform(mx, [-1, 1], [-14, 14]), { stiffness: 120, damping: 18 });
  const rx = useTransform([tilt, rxMouse] as const, ([a, b]: number[]) => a + b);

  return (
    <section className="pt-14 sm:pt-20">
      <Container>
        <motion.div ref={head} style={{ scale: headScale, opacity: headOpacity, y: headY }} className="max-w-[860px] origin-top-left">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}>
            <button onClick={() => scrollTo("decide")} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 h-7 text-[12.5px] text-fg-2 hover:border-line-strong">
              <span className="size-1.5 rounded-full bg-allow live-dot" /> New · human approvals signed with passkeys <ArrowRight className="size-3" />
            </button>
            <h1 className="mt-6 text-[44px] sm:text-[64px] font-medium leading-[1.02] tracking-[-0.045em] text-fg">
              Wrapbox puts every AI agent <span className="text-fg-3">on a permit.</span>
            </h1>
            <p className="mt-5 max-w-[620px] text-[17px] sm:text-[18px] leading-relaxed text-fg-2">
              The runtime authorization layer for AI agents. Every risky action — from Claude Code to your Stripe MCP — is checked against one intent contract, milliseconds before it runs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={() => scrollTo("waitlist")} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#111113] px-5 text-[14.5px] font-medium text-white transition-[filter] hover:brightness-125">
                Join the waitlist <ArrowRight className="size-4" />
              </button>
              <button onClick={() => scrollTo("decide")} className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-[14.5px] font-medium text-fg hover:border-line-strong">
                See how it works
              </button>
            </div>
          </motion.div>
        </motion.div>
      </Container>

      <Container className="mt-14">
        <motion.div ref={demo} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.15, ease: [0.2, 0.7, 0.2, 1] }} style={{ perspective: 1800 }}>
          <motion.div style={{ scale: zoomOut }} className="origin-top">
            <Backdrop className="px-4 pt-12 pb-0 sm:px-12 sm:pt-16">
              <div
                className="relative"
                style={{ perspective: 1600 }}
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
                  my.set(((e.clientY - r.top) / r.height) * 2 - 1);
                }}
                onMouseLeave={() => {
                  mx.set(0);
                  my.set(0);
                }}
              >
                <motion.div style={{ y: yShot, rotateX: rx, rotateY: ry, scale: zoom }} className="mx-auto max-w-[1000px] origin-bottom">
                  <AppWindow src={shotOverview} className="rounded-b-none" />
                </motion.div>
                <motion.div style={{ y: yTerm, x: tx }} className="absolute -left-2 bottom-8 hidden lg:block w-[500px]">
                  <Terminal height={210} />
                </motion.div>
                <motion.div style={{ y: ySlack }} className="absolute -right-2 top-24 hidden md:block">
                  <PasskeyCard compact />
                </motion.div>
              </div>
            </Backdrop>
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Statement: words light up as you scroll                             */
/* ------------------------------------------------------------------ */

const STATEMENT = "AI agents now push code, move money and read customer data. Wrapbox decides what each one may do — and proves it — before the action runs.";

function Word({ w, p, range }: { w: string; p: MotionValue<number>; range: [number, number] }) {
  const reduce = useReducedMotion();
  const opacity = useTransform(p, range, reduce ? [1, 1] : [0.14, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block mr-[0.26em]">
      {w}
    </motion.span>
  );
}

function Statement() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = STATEMENT.split(" ");
  return (
    <section ref={ref} className="py-20 sm:py-32">
      <Container>
        <p className="max-w-[980px] text-[30px] sm:text-[46px] font-medium leading-[1.14] tracking-[-0.035em] text-fg">
          {words.map((w, i) => (
            <Word key={i} w={w} p={scrollYProgress} range={[i / words.length, (i + 1.5) / words.length]} />
          ))}
        </p>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Agent logos marquee                                                 */
/* ------------------------------------------------------------------ */

const AGENT_ROW: [string, string][] = [
  ["claudecode", "Claude Code"],
  ["cursor", "Cursor"],
  ["codex", "Codex"],
  ["githubcopilot", "GitHub Copilot"],
  ["geminicli", "Gemini CLI"],
  ["windsurf", "Windsurf"],
  ["junie", "Junie"],
  ["langgraph", "LangGraph"],
  ["openai", "OpenAI Agents"],
  ["vertexai", "Vertex AI"],
  ["salesforce", "Agentforce"],
  ["copilotstudio", "Copilot Studio"],
  ["browseruse", "Browser Use"],
  ["playwright", "Playwright"],
];
const TOOL_ROW: [string, string][] = [
  ["stripe", "Stripe"],
  ["razorpay", "Razorpay"],
  ["postgresql", "Postgres"],
  ["zapier", "Zapier"],
  ["servicenow", "ServiceNow"],
  ["slack", "Slack"],
  ["teams", "Microsoft Teams"],
  ["okta", "Okta"],
  ["aws", "AWS"],
  ["kubernetes", "Kubernetes"],
  ["datadog", "Datadog"],
  ["splunk", "Splunk"],
  ["pagerduty", "PagerDuty"],
  ["jetbrains", "JetBrains"],
];

function LogoRow({ items, reverse }: { items: [string, string][]; reverse?: boolean }) {
  const row = [...items, ...items];
  return (
    <div className="flex w-max items-center gap-3 pr-3 marquee" style={reverse ? { animationDirection: "reverse", animationDuration: "52s" } : undefined}>
      {row.map(([logo, name], i) => (
        <span key={i} className="group flex h-16 items-center gap-3 rounded-2xl border border-line bg-surface pl-3 pr-5 shadow-[0_1px_2px_rgba(17,28,53,0.04)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card">
          <span className="grid size-10 place-items-center rounded-xl bg-white ring-1 ring-black/[0.06]">
            <img src={logoUrl(logo)} alt="" className="size-6 object-contain" draggable={false} />
          </span>
          <span className="whitespace-nowrap text-[16.5px] font-medium tracking-[-0.01em] text-fg">{name}</span>
        </span>
      ))}
    </div>
  );
}

function Marquee() {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <Reveal className="text-center">
          <div className="text-[13px] font-medium text-fg-3">Integrations</div>
          <h2 className="mx-auto mt-2 max-w-[640px] text-[26px] sm:text-[32px] font-medium leading-[1.12] tracking-[-0.03em] text-fg">Works with the agents and tools your teams already run</h2>
          <p className="mt-3 text-[15px] text-fg-2">25 integrations across 8 agent platforms — one contract governs them all.</p>
        </Reveal>
      </Container>
      <div className="marquee-wrap relative mt-10 space-y-3 overflow-hidden py-1 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
        <LogoRow items={AGENT_ROW} />
        <LogoRow items={TOOL_ROW} reverse />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Feature demos                                                       */
/* ------------------------------------------------------------------ */

const YAML_LINES: [string, string][] = [
  ["k", "- id: "],
  ["v", "payments.refund\n"],
  ["k", "  title: "],
  ["s", '"Refund tiers"\n'],
  ["k", "  when:\n"],
  ["k", "    effect: "],
  ["v", "[payments.refund]\n"],
  ["k", "  tiers:\n"],
  ["p", "    - { lte: 500,  decision: "],
  ["a", "ALLOW"],
  ["p", " }\n"],
  ["p", "    - { lte: 5000, decision: "],
  ["r", "REVIEW"],
  ["p", ", approvers: payments-manager }\n"],
  ["p", "    - { decision: "],
  ["b", "BLOCK"],
  ["p", " }\n"],
];
const YAML_TONE: Record<string, string> = { k: "text-[#9db6ff]", v: "text-white", s: "text-[#ffc9a8]", p: "text-white/70", a: "text-[#5ef0b5] font-semibold", r: "text-[#ffc977] font-semibold", b: "text-[#ff9aae] font-semibold" };

function YamlTyper() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-100px" });
  const total = YAML_LINES.reduce((n, [, t]) => n + t.length, 0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setN((x) => (x >= total + 80 ? 0 : x + 1)), 28);
    return () => clearInterval(t);
  }, [inView, total]);
  let left = n;
  return (
    <div ref={ref} className="overflow-hidden rounded-xl bg-[#0c0a16]/85 ring-1 ring-white/15 backdrop-blur-xl shadow-[0_30px_70px_-30px_rgba(10,4,30,0.8)]">
      <div className="flex items-center gap-2 h-9 px-3.5 border-b border-white/10 font-mono text-[11px] text-white/55 whitespace-nowrap">
        <span className="size-2 shrink-0 rounded-full bg-[#5ef0b5]" /> contract.yaml · v15 draft
        <span className="ml-auto text-white/35">replayed · 0 surprises</span>
      </div>
      <pre className="min-h-[196px] px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap">
        {YAML_LINES.map(([tone, text], i) => {
          if (left <= 0) return null;
          const part = text.slice(0, left);
          left -= text.length;
          return (
            <span key={i} className={YAML_TONE[tone]}>
              {part}
            </span>
          );
        })}
        <span className="inline-block h-3.5 w-[7px] translate-y-0.5 bg-white/70 animate-pulse" />
      </pre>
    </div>
  );
}

const CHAIN = [
  { k: "Human", v: "Arjun Nair asked: “deploy the payments hotfix”" },
  { k: "Agent", v: "Claude Code · agent id cc-arjun-mbp · hook-enforced" },
  { k: "Rule", v: "prod.k8s.delete · contract v14 · REVIEW" },
  { k: "Permit", v: "wbx_pmt_7f3a…c21 · ES256 · args sha256:a27f…5db4" },
  { k: "Outcome", v: "deployment recreated · 2 pods · 41 s · verified" },
];

function EvidenceChain() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-100px" });
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setStep((s) => (s + 1) % (CHAIN.length + 2)), 900);
    return () => clearInterval(t);
  }, [inView]);
  return (
    <div ref={ref} className="rounded-xl bg-white/95 ring-1 ring-black/10 p-4 shadow-[0_30px_70px_-30px_rgba(20,8,40,0.6)] text-[#111c35]">
      <div className="flex items-center justify-between text-[12px] font-semibold">
        Evidence · decision dec_01J9…Q4
        <span className="font-mono text-[10.5px] font-medium text-black/45">hash-chained</span>
      </div>
      <ol className="mt-3 space-y-1.5">
        {CHAIN.map((c, i) => (
          <li key={c.k} className={cn("flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors duration-500", i < step ? "bg-[#f3f1fb]" : "bg-transparent")}>
            <span className={cn("mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full text-[10px] font-bold transition-colors duration-500", i < step ? "bg-[#6b45e0] text-white" : "bg-black/[0.07] text-black/40")}>{i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-black/45">{c.k}</span>
              <span className="block font-mono text-[11.5px] leading-snug text-black/75">{c.v}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FeatureRow({ id, head, children }: { id?: string; head: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        {head}
        <Reveal className="mt-10" delay={0.08}>
          {children}
        </Reveal>
      </Container>
    </section>
  );
}

function ParallaxShot({ src, children, align = "right" }: { src: string; children?: ReactNode; align?: "left" | "right" }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const yShot = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [60, -60]);
  const yFloat = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [130, -130]);
  const frame = useTransform(scrollYProgress, [0, 0.38, 0.62, 1], reduce ? [1, 1, 1, 1] : [0.88, 1, 1, 0.94]);
  const shotZoom = useTransform(scrollYProgress, [0, 0.5, 1], reduce ? [1, 1, 1] : [1.1, 1, 1.03]);
  return (
    <motion.div ref={ref} style={{ scale: frame }}>
      <Backdrop className="px-4 pt-10 sm:px-14 sm:pt-14">
        <div className="relative">
          <motion.div style={{ y: yShot, scale: shotZoom }} className="mx-auto max-w-[940px] origin-bottom">
            <AppWindow src={src} className="rounded-b-none" />
          </motion.div>
          {children && (
            <motion.div style={{ y: yFloat }} className={cn("absolute bottom-10 hidden md:block w-[440px]", align === "right" ? "-right-3" : "-left-3")}>
              {children}
            </motion.div>
          )}
        </div>
      </Backdrop>
    </motion.div>
  );
}

const INSTALL = [
  { id: "claude-code", label: "Claude Code", logo: "claudecode", file: ".claude/settings.json" },
  { id: "cursor", label: "Cursor", logo: "cursor", file: ".cursor/hooks.json" },
  { id: "stripe-mcp", label: "Stripe MCP", logo: "stripe", file: "mcp.json" },
  { id: "langgraph", label: "LangGraph", logo: "langgraph", file: "agent.py" },
];

function InstallTabs() {
  const [i, setI] = useState(0);
  const a = agentById(INSTALL[i].id);
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex lg:flex-col gap-1.5 overflow-x-auto">
        {INSTALL.map((t, k) => (
          <button
            key={t.id}
            onClick={() => setI(k)}
            className={cn("flex shrink-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors", k === i ? "border-fg/25 bg-surface shadow-card" : "border-transparent hover:bg-surface-2")}
          >
            <span className="grid size-8 place-items-center rounded-lg bg-white ring-1 ring-black/[0.07]">
              <img src={logoUrl(t.logo)} alt="" className="size-5 object-contain" />
            </span>
            <span>
              <span className="block text-[14px] font-medium text-fg">{t.label}</span>
              <span className="block font-mono text-[11.5px] text-fg-3">{t.file}</span>
            </span>
          </button>
        ))}
      </div>
      <Backdrop className="p-4 sm:p-8">
        <div className="overflow-hidden rounded-xl bg-[#0c0a16]/88 ring-1 ring-white/15 backdrop-blur-xl">
          <div className="flex items-center gap-2 h-10 px-4 border-b border-white/10">
            <span className="font-mono text-[11.5px] text-white/60">{INSTALL[i].file}</span>
            <CopyButton text={a.snippet} className="ml-auto !h-7 !bg-white/10 !text-white !border-white/15" />
          </div>
          <AnimatePresence mode="wait">
            <motion.pre key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="max-h-[340px] overflow-auto scroll-thin px-4 py-4 font-mono text-[12px] leading-[1.65] text-white/85">
              {a.snippet}
            </motion.pre>
          </AnimatePresence>
        </div>
      </Backdrop>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers, use cases                                                  */
/* ------------------------------------------------------------------ */

function CountUp({ to, suffix = "", decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return (
    <span ref={ref} className="tnum">
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

function Numbers() {
  const items: [ReactNode, string][] = [
    [<CountUp key="a" to={3} suffix=" ms" />, "median decision, p99 11 ms"],
    [<CountUp key="b" to={25} />, "integrations across 8 agent platforms"],
    [<CountUp key="c" to={4} />, "outcomes: allow, constrain, review, block"],
    [<CountUp key="d" to={100} suffix="%" />, "of permits signed and single-use"],
  ];
  return (
    <section className="py-16 sm:py-20 border-y border-line bg-surface">
      <Container className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([k, v], i) => (
          <Reveal key={v} delay={i * 0.06}>
            <div className="text-[44px] font-medium tracking-[-0.04em] text-fg">{k}</div>
            <div className="mt-1 text-[14px] text-fg-2">{v}</div>
          </Reveal>
        ))}
      </Container>
    </section>
  );
}

const USES: { team: string; logo: string; ask: string; rule: string; d: Decision; note: string }[] = [
  { team: "Engineering", logo: "claudecode", ask: "git push --force origin feat/ledger", rule: "git.force", d: "CONSTRAIN", note: "rewritten to --force-with-lease" },
  { team: "Support & payments", logo: "stripe", ask: "create_refund · $2,400", rule: "payments.refund", d: "REVIEW", note: "payments manager signs with a passkey" },
  { team: "Claims & finance", logo: "langgraph", ask: "pay_claim · ₹3,00,000", rule: "claims.payout", d: "REVIEW", note: "two claims managers must sign" },
  { team: "Data & analytics", logo: "postgresql", ask: "SELECT email, phone FROM customers", rule: "pii.read", d: "CONSTRAIN", note: "PII masked, LIMIT 500" },
  { team: "Sales & CRM", logo: "salesforce", ask: "Apply Discount · 40%", rule: "crm.discount", d: "REVIEW", note: "VP Sales approves above 25%" },
  { team: "Security", logo: "claudecode", ask: "Read .env.production", rule: "secrets.read", d: "BLOCK", note: "secrets are never read autonomously" },
];

function UseCases() {
  return (
    <section className="py-16 sm:py-24">
      <Container>
        <SectionHead eyebrow="For every team" title="One contract. Every team that runs agents." body="The same deterministic rules cover a developer's coding agent, a support agent issuing refunds and a claims agent paying out — each answered in milliseconds, with the reason." />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {USES.map((u, i) => (
            <Reveal key={u.team} delay={i * 0.05}>
              <div className="wb-card h-full rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-white ring-1 ring-black/[0.07]">
                    <img src={logoUrl(u.logo)} alt="" className="size-5 object-contain" />
                  </span>
                  <span className="text-[14.5px] font-medium text-fg">{u.team}</span>
                </div>
                <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-2 break-words">{u.ask}</div>
                <div className="mt-3 flex items-center gap-2">
                  <Pill d={u.d} />
                  <span className="font-mono text-[11.5px] text-fg-3">{u.rule}</span>
                </div>
                <div className="mt-1.5 text-[13px] text-fg-2">{u.note}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

interface Plan {
  name: string;
  monthly: number | null;
  annual: number | null;
  unit: string;
  blurb: string;
  cta: string;
  popular?: boolean;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    monthly: 0,
    annual: 0,
    unit: "free forever",
    blurb: "For a founder or a small team trying agents safely.",
    cta: "Start free",
    features: ["Up to 3 people and 5 agents", "25k decisions a month", "Intent contract with policy packs", "Observe and enforce modes", "7-day evidence trail", "Community support"],
  },
  {
    name: "Team",
    monthly: 30,
    annual: 24,
    unit: "per person / month",
    blurb: "For teams putting coding and business agents into daily work.",
    cta: "Start 14-day trial",
    popular: true,
    features: ["Everything in Starter", "Unlimited agents per person", "1M decisions a month, pooled", "Passkey approvals in Slack and Teams", "Google and Microsoft sign-in", "90-day evidence · CSV export", "Email support"],
  },
  {
    name: "Business",
    monthly: 59,
    annual: 47,
    unit: "per person / month",
    blurb: "For companies rolling agents out across departments.",
    cta: "Start 14-day trial",
    features: ["Everything in Team", "Okta and Entra SSO with SCIM", "MDM rollout · Jamf and Intune", "Endpoint runtime and MCP gateway", "SIEM export · Splunk and Datadog", "1-year evidence · 10M decisions", "99.9% uptime SLA"],
  },
  {
    name: "Enterprise",
    monthly: null,
    annual: null,
    unit: "annual contract",
    blurb: "For regulated companies with their own security and data rules.",
    cta: "Talk to us",
    features: ["Everything in Business", "Private cloud or on-prem", "Your own signing keys (HSM / KMS)", "Data residency · US, EU, India", "Unlimited evidence retention", "Dedicated engineer · 99.99% SLA"],
  },
];

function Pricing() {
  const [annual, setAnnual] = useState(true);
  return (
    <section id="pricing" className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Pricing" title="Priced per person. Agents are unlimited." body="You pay for the people whose agents Wrapbox governs — not for every agent they run. Start free, upgrade when you enforce across the company." />
          <Reveal>
            <div className="inline-flex rounded-full border border-line bg-surface p-1" role="radiogroup" aria-label="Billing period">
              {[
                ["Monthly", false],
                ["Yearly · save 20%", true],
              ].map(([l, v]) => (
                <button key={String(v)} role="radio" aria-checked={annual === v} onClick={() => setAnnual(v as boolean)} className={cn("relative h-8 rounded-full px-4 text-[13px] font-medium transition-colors", annual === v ? "text-white" : "text-fg-2 hover:text-fg")}>
                  {annual === v && <motion.span layoutId="bill" className="absolute inset-0 rounded-full bg-[#111113]" transition={{ type: "spring", duration: 0.35, bounce: 0.15 }} />}
                  <span className="relative">{l as string}</span>
                </button>
              ))}
            </div>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p, i) => {
            const price = annual ? p.annual : p.monthly;
            return (
              <Reveal key={p.name} delay={i * 0.06} className="h-full">
                <div className={cn("wb-card relative flex h-full flex-col rounded-2xl border p-6", p.popular ? "border-transparent bg-[#111113] text-white shadow-[0_30px_70px_-30px_rgba(17,17,19,0.7)]" : "border-line bg-surface")}>
                  {p.popular && <span className="absolute -top-3 left-6 rounded-full prism-swatch px-2.5 py-1 text-[11px] font-semibold text-white shadow">Most popular</span>}
                  <div className="text-[15px] font-medium">{p.name}</div>
                  <div className="mt-4 flex items-baseline gap-1.5">
                    {price === null ? (
                      <span className="text-[40px] font-medium tracking-[-0.04em]">Custom</span>
                    ) : (
                      <>
                        <span className="text-[40px] font-medium tracking-[-0.04em] tnum">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span key={price} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} className="inline-block">
                              ${price}
                            </motion.span>
                          </AnimatePresence>
                        </span>
                      </>
                    )}
                  </div>
                  <div className={cn("text-[12.5px]", p.popular ? "text-white/60" : "text-fg-3")}>
                    {p.unit}
                    {price ? (annual ? " · billed yearly" : " · billed monthly") : ""}
                  </div>
                  <p className={cn("mt-4 text-[13.5px] leading-relaxed", p.popular ? "text-white/80" : "text-fg-2")}>{p.blurb}</p>
                  <ul className={cn("mt-6 space-y-2.5 border-t pt-5 text-[13px]", p.popular ? "border-white/15 text-white/85" : "border-line text-fg-2")}>
                    {p.features.map((f, k) => (
                      <li key={f} className="flex gap-2">
                        <Check className={cn("mt-0.5 size-3.5 shrink-0", p.popular ? "text-[#5ef0b5]" : "text-allow")} strokeWidth={2.5} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal>
          <p className="mt-6 text-[13px] text-fg-3">
            Extra decisions are $5 per million. Every plan includes the full policy engine, ALLOW / CONSTRAIN / REVIEW / BLOCK, and signed single-use permits. Prices in USD, before tax.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Waitlist                                                            */
/* ------------------------------------------------------------------ */

// Everything here is answered by /api/waitlist, which writes to a real sheet and
// sends the confirmation mail. The position and the count are whatever the sheet
// returns — never a number this page made up — so "you're on the list" can only
// appear when the row actually landed.
const WL_ROLES: { id: string; label: string }[] = [
  { id: "security", label: "Security" },
  { id: "platform", label: "Platform / DevOps" },
  { id: "engineering-leadership", label: "Engineering leadership" },
  { id: "other", label: "Something else" },
];

interface WlDone {
  position: number;
  duplicate: boolean;
  email: string;
}

function Waitlist() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("security");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<WlDone | null>(null);
  const [count, setCount] = useState<number | null>(null);

  // The live number on the list. Absent (not zero, not invented) when the sheet
  // cannot be read, and the counter simply does not render.
  useEffect(() => {
    let live = true;
    fetch("/api/waitlist")
      .then((r) => r.json())
      .then((d) => live && typeof d?.count === "number" && setCount(d.count))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setError(null);
    setState("sending");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role, company }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        setError(typeof d?.error === "string" ? d.error : "Something went wrong. Try again in a moment.");
        setState("idle");
        return;
      }
      if (typeof d.count === "number") setCount(d.count);
      setDone({ position: d.position, duplicate: !!d.duplicate, email });
    } catch {
      setError("We couldn't reach the waitlist. Check your connection and try again.");
    }
    setState("idle");
  };

  return (
    <section id="waitlist" className="scroll-mt-20 py-16 sm:py-24">
      <Container className="grid items-start gap-10 lg:grid-cols-[1fr_1.15fr]">
        <SectionHead
          eyebrow="Early access"
          title="Get Wrapbox before your agents get ambitious."
          body="We're opening access in small batches, security and platform teams first. Join the list and we'll send a workspace link with a ten-minute setup for your first agent."
        />

        <Reveal delay={0.06}>
          <Backdrop className="p-1.5">
            <div className="rounded-[14px] bg-surface p-6 sm:p-8">
              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  /* The confirmation is a receipt, the way every other Wrapbox answer is. */
                  <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}>
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-allow">
                      <ShieldCheck className="size-4" />
                      {done.duplicate ? "You were already on the list." : "You're on the list."}
                    </div>

                    <div className="mt-4 rounded-xl border border-line bg-bg p-5">
                      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3">Waitlist position</div>
                      <div className="mt-0.5 text-[40px] font-medium leading-none tracking-[-0.04em] text-fg tnum">#{done.position}</div>
                      <div className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[12.5px] text-fg-2">
                        <Mail className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                        <span>
                          {done.duplicate ? "Your original confirmation went to " : "Confirmation sent to "}
                          <span className="font-mono text-[11.5px] text-fg">{done.email}</span>
                          {done.duplicate ? "." : " — check spam if it's not there in a minute."}
                        </span>
                      </div>
                    </div>

                    <p className="mt-4 text-[13.5px] leading-relaxed text-fg-2">
                      We open access in batches and email from the same address, so replying gets you a person rather than a queue. Tell us which agents you run and we'll prioritise those integrations.
                    </p>
                    <button onClick={() => scrollTo("decide")} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-fg transition-[gap] hover:gap-2.5">
                      Try the policy engine while you wait <ArrowRight className="size-4" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.form key="form" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <label htmlFor="wl-email" className="block text-[13px] font-medium text-fg">
                      Work email
                    </label>
                    <input
                      id="wl-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="mt-2 h-11 w-full rounded-xl border border-line bg-bg px-3.5 text-[14.5px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-line-strong"
                    />

                    <div className="mt-5 text-[13px] font-medium text-fg">What do you work on?</div>
                    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="What do you work on?">
                      {WL_ROLES.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          role="radio"
                          aria-checked={role === r.id}
                          onClick={() => setRole(r.id)}
                          className={cn(
                            "relative h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                            role === r.id ? "border-transparent text-white" : "border-line bg-bg text-fg-2 hover:text-fg",
                          )}
                        >
                          {role === r.id && <motion.span layoutId="wl-role" className="absolute inset-0 rounded-full bg-[#111113]" transition={{ type: "spring", duration: 0.35, bounce: 0.15 }} />}
                          <span className="relative">{r.label}</span>
                        </button>
                      ))}
                    </div>

                    <label htmlFor="wl-company" className="mt-5 block text-[13px] font-medium text-fg">
                      Company <span className="font-normal text-fg-3">— optional</span>
                    </label>
                    <input
                      id="wl-company"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Northwind Financial"
                      className="mt-2 h-11 w-full rounded-xl border border-line bg-bg px-3.5 text-[14.5px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-line-strong"
                    />

                    <button
                      type="submit"
                      disabled={state === "sending"}
                      className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#111113] px-5 text-[14.5px] font-medium text-white transition-[filter,opacity] hover:brightness-125 disabled:opacity-70"
                    >
                      {state === "sending" ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Adding you…
                        </>
                      ) : (
                        <>
                          Join the waitlist <ArrowRight className="size-4" />
                        </>
                      )}
                    </button>

                    <AnimatePresence initial={false}>
                      {error && (
                        <motion.p key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-[13px] text-block">
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
                      {count !== null && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full bg-allow live-dot" />
                          <span className="font-medium text-fg-2 tnum">{count.toLocaleString("en-US")}</span> {count === 1 ? "team" : "teams"} on the list
                        </span>
                      )}
                      <span>No newsletter. One email when your access opens.</span>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </Backdrop>
        </Reveal>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ, CTA, footer                                                    */
/* ------------------------------------------------------------------ */

const FAQ: [string, string][] = [
  ["How does Wrapbox connect to my agents?", "Through the official hooks in Claude Code, Cursor, Codex, Copilot and Gemini CLI; an MCP gateway in front of tools like Stripe, GitHub and Postgres; SDKs for LangGraph, the OpenAI Agents SDK and Google ADK; and connectors for Agentforce, Copilot Studio, ServiceNow and Zapier."],
  ["Does Wrapbox see my code or my data?", "It sees the action an agent is about to take — the command, tool call and its arguments — not your repository. The arguments are hashed into the permit, and the evidence trail keeps only what you choose to retain."],
  ["What happens if Wrapbox can't be reached?", "You decide per rule. Risky effects fail closed and are blocked; low-risk ones can fail open. Hooks keep the last published contract locally, so decisions keep working through a network blip."],
  ["How is this different from prompt guardrails?", "Guardrails judge text. Wrapbox authorizes actions: deterministic rules on the effect, target and amount, a signed single-use permit, and a human passkey signature when policy says so. The same action and contract always give the same answer."],
  ["Can we start without blocking anything?", "Yes. Put any rule in observe mode and Wrapbox records what it would have done. Replay a draft contract against past traffic to see the impact before you enforce it."],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 py-16 sm:py-24">
      <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <SectionHead eyebrow="FAQ" title="Questions teams ask first." body="Anything else — security reviews, data residency, procurement — we're happy to walk through it with you." />
        <Reveal>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map(([q, a], i) => (
              <div key={q}>
                <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 py-5 text-left text-[16px] font-medium text-fg" aria-expanded={open === i}>
                  <span>{q}</span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-fg-2">{open === i ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}</span>
                </button>
                <AnimatePresence initial={false}>
                  {open === i && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                      <p className="pb-5 pr-10 text-[15px] leading-relaxed text-fg-2">{a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function FinalCta() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.86, 1]);
  const radius = useTransform(scrollYProgress, [0, 1], [40, 16]);
  return (
    <section className="pb-20">
      <Container>
        <motion.div ref={ref} style={{ scale, borderRadius: radius }} className="overflow-hidden">
          <Backdrop className="px-8 py-16 sm:px-16 sm:py-24 text-white rounded-none">
            <div className="max-w-[640px]">
              <h2 className="text-[40px] sm:text-[56px] font-medium leading-[1.02] tracking-[-0.045em] [text-shadow:0_2px_24px_rgba(90,20,40,0.25)]">
                Put your agents on a <span className="text-[#1b0f33] [text-shadow:none]">permit</span> today.
              </h2>
              <p className="mt-4 text-[17px] font-medium text-white/90">Every risky action gets a decision, a reason and a signature — before it runs.</p>
              <button onClick={() => scrollTo("waitlist")} className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-medium text-[#111113] transition-transform hover:-translate-y-0.5">
                Join the waitlist <ArrowRight className="size-4" />
              </button>
            </div>
          </Backdrop>
        </motion.div>
      </Container>
    </section>
  );
}

function Footer() {
  const cols: [string, string[]][] = [
    ["Product", ["Intent contract", "Approvals", "Evidence", "MCP gateway", "Pricing"]],
    ["Integrations", ["Claude Code", "Cursor", "Codex", "LangGraph", "Agentforce"]],
    ["Company", ["Waitlist", "About", "Careers", "Security", "Contact"]],
    ["Legal", ["Terms", "Privacy", "DPA"]],
  ];
  return (
    <footer className="border-t border-line py-14">
      <Container className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <WrapboxLockup size={18} />
          <p className="mt-3 max-w-[260px] text-[13px] leading-relaxed text-fg-3">Runtime authorization for AI agents. Every action checked before it runs.</p>
        </div>
        {cols.map(([h, items]) => (
          <div key={h}>
            <div className="text-[13px] font-medium text-fg">{h}</div>
            <ul className="mt-3 space-y-2 text-[13px] text-fg-3">
              {items.map((x) => (
                <li key={x}>
                  <button onClick={() => (x === "Pricing" ? scrollTo("pricing") : x === "Waitlist" ? scrollTo("waitlist") : undefined)} className="hover:text-fg transition-colors">
                    {x}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="mt-12 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-fg-3">
        <span>© 2026 Wrapbox</span>
        <span className="flex gap-4">
          <button className="hover:text-fg transition-colors">Terms</button>
          <button className="hover:text-fg transition-colors">Privacy</button>
          <button className="hover:text-fg transition-colors">Security</button>
        </span>
      </Container>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function Landing() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <div className="min-h-screen bg-bg text-fg">
      <Nav />
      <Hero />
      <Marquee />
      <Statement />

      <FeatureRow
        id="product"
        head={<SectionHead eyebrow="Intent contract" title="Write the rules once. Every agent follows them." body="One contract covers every agent vendor. Write it in plain YAML or the rule builder, replay it against past traffic, and publish — hooks, gateways and SDKs pick it up in seconds." />}
      >
        <ParallaxShot src={shotContract} align="left">
          <YamlTyper />
        </ParallaxShot>
      </FeatureRow>

      <FeatureRow id="decide" head={<SectionHead eyebrow="Decisions" title="Every action gets an answer in milliseconds — with the reason." body="Try it. Pick an agent, then run a command, a refund or a query. This is the real policy engine: the same action and contract always give the same decision." />}>
        <Backdrop className="p-4 sm:p-12">
          <div className="mx-auto max-w-[860px]">
            <Terminal chips height={320} />
          </div>
        </Backdrop>
      </FeatureRow>

      <FeatureRow head={<SectionHead eyebrow="Human approvals" title="The risky ones wait for a person — signed, not clicked." body="REVIEW routes to the right approver in Slack or Teams. They see what was asked, exactly what will change and why it was held, then sign with a passkey. The permit is bound to those exact arguments." />}>
        <ParallaxShot src={shotApprovals} align="right">
          <PasskeyCard />
        </ParallaxShot>
      </FeatureRow>

      <FeatureRow head={<SectionHead eyebrow="Evidence" title="Hand an auditor the whole chain, not a log line." body="Human → agent → rule → permit → outcome, hash-chained for every decision. Filter by environment, person or agent, and export to your SIEM." />}>
        <ParallaxShot src={shotEvidence} align="left">
          <EvidenceChain />
        </ParallaxShot>
      </FeatureRow>

      <FeatureRow id="install" head={<SectionHead eyebrow="Integrations" title="Connect in minutes, in the tools you already use." body="Paste a hook into Claude Code or Cursor, point an MCP client at the Wrapbox gateway, or wrap a LangGraph tool with the SDK. These are the real config formats." />}>
        <InstallTabs />
      </FeatureRow>

      <Numbers />
      <UseCases />
      <Pricing />
      <Waitlist />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}
