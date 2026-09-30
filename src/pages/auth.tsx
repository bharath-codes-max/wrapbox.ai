import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Eye, EyeOff, Info, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CategoryId, Decision } from "../data/agents";
import { INITIAL_RULES } from "../data/contract";
import { WrapboxLockup } from "../components/logo";
import { cn, D_DOT } from "../components/ui";
import { checkPassword, signIn } from "../lib/auth";
import { classify, evaluate, rewrite, type Act } from "../lib/engine";
import { logoUrl } from "../lib/logos";
import { go } from "../lib/router";
import { homePath } from "../lib/store";

/* ------------------------------------------------------------------ */
/* Left: the form                                                      */
/* ------------------------------------------------------------------ */

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[12.5px] font-medium text-fg-2">
        {label}
        {hint}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const inputCls =
  "w-full h-11 rounded-xl border border-line bg-surface px-3.5 text-[14px] text-fg placeholder:text-fg-3 outline-none transition-[border,box-shadow] focus:border-fg/40 focus:ring-4 focus:ring-fg/[0.06]";

function SsoButton({ logo, label, onClick }: { logo: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-[13.5px] font-medium text-fg shadow-[0_1px_2px_rgba(17,28,53,0.04)] transition-colors hover:bg-surface-2 hover:border-line-strong"
    >
      <img src={logoUrl(logo)} alt="" className="size-[18px]" draggable={false} />
      {label}
    </button>
  );
}

function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setPw("");
  }, [mode]);

  const sso = (who: string) => {
    setError(null);
    setNotice(`${who} sign-in isn't enabled for this workspace. Use your email and access code.`);
    emailRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!email.trim()) return setError("Enter your email address.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("That doesn't look like an email address. Check it and try again.");
    if (!pw) return setError("Enter your password.");
    if (!checkPassword(pw)) return setError(signup ? "That password isn't accepted. Use the access code you were given." : "That password isn't right. Check it and try again.");
    setError(null);
    setBusy(true);
    setTimeout(() => {
      signIn({ email: email.trim(), name: name.trim() || undefined, company: company.trim() || undefined });
      go(homePath());
    }, 650);
  };

  return (
    <div className="w-full max-w-[400px]">
      <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] leading-tight">{signup ? "Create your workspace" : "Welcome back"}</h1>
        <p className="mt-1.5 text-[14px] text-fg-2">{signup ? "Put every AI agent in your company on a permit. Takes about two minutes." : "Sign in to your Wrapbox control plane."}</p>

        <div className="mt-7 grid grid-cols-2 gap-2.5">
          <SsoButton logo="google" label="Google" onClick={() => sso("Google")} />
          <SsoButton logo="microsoft" label="Microsoft" onClick={() => sso("Microsoft")} />
        </div>
        <AnimatePresence>
          {notice && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-3 flex gap-2 rounded-xl bg-surface-2 border border-line px-3 py-2.5 text-[12.5px] text-fg-2">
                <Info className="size-4 shrink-0 mt-px text-fg-3" /> {notice}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="my-6 flex items-center gap-3 text-[11.5px] uppercase tracking-[0.08em] text-fg-3">
          <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {signup && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Menon" autoComplete="name" />
              </Field>
              <Field label="Company">
                <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Health" autoComplete="organization" />
              </Field>
            </div>
          )}
          <Field label={signup ? "Work email" : "Email"}>
            <input ref={emailRef} type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
          </Field>
          <Field
            label="Password"
            hint={
              !signup && (
                <button type="button" onClick={() => setNotice("To reset your password, contact your Wrapbox admin.")} className="text-[12px] font-medium text-fg-3 hover:text-fg">
                  Forgot?
                </button>
              )
            }
          >
            <span className="relative block">
              <input
                type={show ? "text" : "password"}
                className={cn(inputCls, "pr-11", error?.includes("password") && "border-block/60 focus:border-block/70 focus:ring-block/10")}
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={signup ? "Create a password" : "Your password"}
                autoComplete={signup ? "new-password" : "current-password"}
              />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-lg text-fg-3 hover:text-fg hover:bg-surface-2" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </span>
          </Field>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="flex items-center gap-2 text-[12.5px] font-medium text-block">
                <span className="size-1.5 rounded-full bg-block" /> {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button type="submit" disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#111113] text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(17,17,19,0.7)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.99] disabled:opacity-70">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? (signup ? "Creating your workspace…" : "Signing in…") : signup ? "Create workspace" : "Sign in"}
            {!busy && <ArrowRight className="size-4" />}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-fg-2">
          {signup ? "Already have an account? " : "New to Wrapbox? "}
          <a href={signup ? "#/login" : "#/signup"} className="font-semibold text-fg underline-offset-4 hover:underline">
            {signup ? "Sign in" : "Create an account"}
          </a>
        </p>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right: a live coding session, every action decided by the engine   */
/* ------------------------------------------------------------------ */

interface Step {
  tool: string;
  act: Act;
}
interface Tab {
  id: string;
  label: string;
  logo: string;
  category: CategoryId;
  prompt: string;
  placeholder: string;
  examples: string[];
  steps: Step[];
  parse: (text: string) => { tool: string; act: Act };
}

const cmd = (c: string): Step => ({ tool: `Bash(${c})`, act: classify(c, "production").act });
const refund = (usd: number): Step => ({ tool: `stripe.create_refund({ amount: ${usd * 100} })`, act: { effect: "payments.refund", amount: usd, amountUsd: usd } });
const sql = (q: string): Step => ({ tool: `postgres.execute_sql("${q}")`, act: classify(q, "production").act });

const TABS: Tab[] = [
  {
    id: "claude",
    label: "Claude Code",
    logo: "claudecode",
    category: "cli",
    prompt: 'claude "ship the ledger fix, then clean up prod"',
    placeholder: "Try: cat .env · git push origin main · curl -H 'Authorization: …' https://x.io",
    examples: ["cat .env", "git push origin main", "rm -rf ./build", "curl -H 'Authorization: Bearer sk' https://paste.io"],
    steps: [cmd("git push --force origin feat/ledger"), { tool: "Read(.env.production)", act: classify("cat .env.production", "production").act }, cmd("git push origin main"), cmd("kubectl delete deployment payments-api -n prod")],
    parse: (t) => ({ tool: `Bash(${t})`, act: classify(t, "production").act }),
  },
  {
    id: "stripe",
    label: "Stripe MCP",
    logo: "stripe",
    category: "mcp",
    prompt: 'support-agent "refund the duplicate charges from last week"',
    placeholder: "Try a refund amount in dollars: 250 · 2400 · 12000",
    examples: ["$250", "$2,400", "$12,000"],
    steps: [refund(300), refund(2400), refund(12000)],
    parse: (t) => {
      const usd = Number(t.replace(/[^0-9.]/g, "")) || 0;
      return refund(usd);
    },
  },
  {
    id: "postgres",
    label: "Postgres MCP",
    logo: "postgresql",
    category: "mcp",
    prompt: 'analyst-agent "pull churned customers and tidy old orders"',
    placeholder: "Try SQL: SELECT name FROM customers · DELETE FROM orders",
    examples: ["SELECT name FROM customers", "SELECT email, phone FROM users", "DELETE FROM orders"],
    steps: [sql("SELECT email, phone FROM customers WHERE churned"), sql("SELECT id, plan FROM accounts LIMIT 50"), sql("DELETE FROM orders WHERE created_at < '2024-01-01'")],
    parse: (t) => sql(t),
  },
];

const TONE: Record<Decision, string> = {
  ALLOW: "text-[#5ef0b5] bg-[#5ef0b5]/12 ring-[#5ef0b5]/30",
  CONSTRAIN: "text-[#c9b6ff] bg-[#a78bff]/15 ring-[#a78bff]/35",
  REVIEW: "text-[#ffc977] bg-[#f4b453]/14 ring-[#f4b453]/35",
  BLOCK: "text-[#ff9aae] bg-[#ff6e8a]/14 ring-[#ff6e8a]/35",
};

interface Line {
  id: number;
  tool: string;
  decision: Decision;
  rule: string;
  detail: string;
  ms: number;
  user?: boolean;
}

function decide(tab: Tab, s: Step, id: number, user?: boolean): Line {
  const v = evaluate(s.act, INITIAL_RULES, tab.category);
  let detail = v.reason;
  if (v.decision === "CONSTRAIN") detail = `rewritten → ${rewrite(s.act, v.constrain) ?? "narrowed"}`;
  else if (v.decision === "REVIEW") detail = `held for ${v.approvers ?? "an approver"} · signs with a passkey`;
  else if (v.decision === "ALLOW") detail = `${v.rule === "default" ? "no rule matched" : v.reason} · permit signed, single use`;
  return { id, tool: s.tool, decision: v.decision, rule: v.rule, detail, ms: 2 + (id % 3), user };
}

function useTyped(text: string, active: boolean, speed = 22) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!active) return;
    const t = setInterval(() => setN((x) => (x >= text.length ? x : x + 1)), speed);
    return () => clearInterval(t);
  }, [text, active, speed]);
  return text.slice(0, n);
}

export function Terminal({ chips, height = 300 }: { chips?: boolean; height?: number } = {}) {
  const [tabIdx, setTabIdx] = useState(0);
  const tab = TABS[tabIdx];
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  const [extra, setExtra] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const typed = useTyped(tab.prompt, true);
  const promptDone = typed.length === tab.prompt.length;
  const lines = useMemo(() => tab.steps.map((s, i) => decide(tab, s, i)), [tab]);

  useEffect(() => {
    setShown(0);
    setExtra([]);
  }, [tabIdx, run]);
  useEffect(() => {
    if (!promptDone) return;
    if (shown < lines.length) {
      const t = setTimeout(() => setShown((x) => x + 1), shown === 0 ? 500 : 1300);
      return () => clearTimeout(t);
    }
  }, [promptDone, shown, lines.length]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [shown, extra.length]);

  const runText = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const s = tab.parse(t);
    setExtra((x) => [...x.slice(-3), decide(tab, s, 100 + x.length, true)]);
    setShown(lines.length);
    setInput("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runText(input);
  };

  const visible = [...lines.slice(0, shown), ...extra];

  return (
    <div className="overflow-hidden rounded-2xl bg-[#0c0a16]/80 ring-1 ring-white/15 shadow-[0_30px_80px_-30px_rgba(10,4,30,0.8)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 h-11">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <div className="flex gap-1" role="tablist" aria-label="Agent">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={i === tabIdx}
              onClick={() => setTabIdx(i)}
              className={cn("flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-[12px] font-medium transition-colors", i === tabIdx ? "bg-white/12 text-white" : "text-white/55 hover:text-white/85")}
            >
              <span className="grid size-4 place-items-center rounded-[4px] bg-white">
                <img src={logoUrl(t.logo)} alt="" className="size-3" />
              </span>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setRun((r) => r + 1)} className="ml-auto grid size-7 place-items-center rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="Replay">
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      <div ref={bodyRef} className="overflow-y-auto scroll-thin px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-white/85" style={{ height }}>
        <div>
          <span className="text-[#5ef0b5]">~/wrapbox</span> <span className="text-white/40">$</span> {typed}
          {!promptDone && <span className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-white/80 animate-pulse" />}
        </div>
        <AnimatePresence initial={false}>
          {visible.map((l) => (
            <motion.div key={`${run}-${tabIdx}-${l.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-2.5">
              <div className="flex gap-2">
                <span className={l.user ? "text-[#9db6ff]" : "text-[#ffb38a]"}>{l.user ? "›" : "⏺"}</span>
                <span className="break-all text-white">{l.tool}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-white/60">
                <span className="text-white/35">⎿</span>
                <span className="text-white/75">wrapbox</span>
                <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.25, type: "spring", bounce: 0.4 }} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold tracking-wide ring-1", TONE[l.decision])}>
                  <span className={cn("size-1.5 rounded-full", D_DOT[l.decision])} />
                  {l.decision}
                </motion.span>
                <span className="text-white/45">
                  {l.rule} · {l.ms} ms
                </span>
              </div>
              <div className="pl-7 text-white/55 break-words">{l.detail}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {chips && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-4 py-2.5">
          <span className="font-mono text-[11px] text-white/40 mr-1">try</span>
          {tab.examples.map((x) => (
            <button key={x} type="button" onClick={() => runText(x)} className="rounded-md bg-white/[0.08] ring-1 ring-white/12 px-2 h-6 font-mono text-[11px] text-white/80 hover:bg-white/15 hover:text-white transition-colors">
              {x}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 px-4 h-12">
        <span className="font-mono text-[12px] text-[#9db6ff]">›</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tab.placeholder}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white placeholder:text-white/35 outline-none"
          aria-label="Try an agent action"
        />
        <button type="submit" className="rounded-lg bg-white/12 px-2.5 h-7 font-mono text-[11px] text-white/80 hover:bg-white/20">
          run ↵
        </button>
      </form>
    </div>
  );
}

function Showcase() {
  return (
    <div className="hero-prism relative flex h-full flex-col justify-between overflow-hidden rounded-none p-8 xl:p-10 text-white">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur-md px-3 py-1 text-[12px] font-medium">
          <span className="size-1.5 rounded-full bg-[#5ef0b5] live-dot" /> Live · decided by the real policy engine
        </div>
        <h2 className="mt-5 max-w-[20ch] text-[34px] xl:text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] [text-shadow:0_2px_24px_rgba(90,20,40,0.25)]">
          Every agent action, checked <span className="text-[#1b0f33] [text-shadow:none]">before</span> it runs.
        </h2>
        <p className="mt-3 max-w-[46ch] text-[14px] font-medium text-white/90">Watch an agent work, or type your own command below. Each one is answered ALLOW, CONSTRAIN, REVIEW or BLOCK against one intent contract.</p>
      </div>
      <div className="my-7">
        <Terminal />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[
          ["3 ms", "median decision"],
          ["25", "agents, one contract"],
          ["ES256", "signed, single-use permits"],
        ].map(([k, v]) => (
          <div key={v} className="rounded-xl bg-[#160a2e]/30 ring-1 ring-white/20 px-3.5 py-2.5 backdrop-blur-md">
            <div className="text-[18px] font-semibold tracking-tight">{k}</div>
            <div className="text-[11.5px] text-white/80">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  return (
    <div className="min-h-screen bg-bg text-fg lg:grid lg:grid-cols-[minmax(460px,1fr)_1.15fr]">
      <div className="flex min-h-screen flex-col px-6 sm:px-10 py-8">
        <a href="#/landing" aria-label="Wrapbox home" className="self-start">
          <WrapboxLockup size={22} />
        </a>
        <div className="flex flex-1 items-center justify-center py-10">
          <AuthForm mode={mode} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-3">
          <span>© 2026 Wrapbox</span>
          <span className="flex gap-4"><span>Terms</span><span>Privacy</span><span>Security</span></span>
        </div>
      </div>
      <div className="hidden lg:block lg:sticky lg:top-0 lg:h-screen">
        <Showcase />
      </div>
    </div>
  );
}
