import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Plus, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AGENTS, agentById, type Decision } from "../data/agents";
import { Button, Card, DecisionPill, Logo, cn } from "../components/ui";
import { go } from "../lib/router";
import { WORKSPACES, setState, switchWorkspace, useStore, workspaceHasData } from "../lib/store";

const TICKER: { agent: string; action: string; d: Decision; why: string }[] = [
  { agent: "claude-code", action: "Read .env.production", d: "BLOCK", why: "secrets are never read autonomously" },
  { agent: "stripe-mcp", action: "create_refund · $300", d: "ALLOW", why: "≤ $500 is automatic" },
  { agent: "postgres-mcp", action: "SELECT email, phone FROM customers", d: "CONSTRAIN", why: "PII masked · LIMIT 500" },
  { agent: "cursor", action: "kubectl delete deployment payments-api -n prod", d: "REVIEW", why: "on-call signs with a passkey" },
  { agent: "langgraph", action: "pay_claim · ₹3,00,000", d: "REVIEW", why: "two claims managers" },
  { agent: "openai-handoffs", action: "place_order · $100,000", d: "BLOCK", why: "exceeds the $10,000 its parent delegated" },
  { agent: "codex-cli", action: "git push --force origin feat/ledger", d: "CONSTRAIN", why: "rewritten to --force-with-lease" },
];

function Ticker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % TICKER.length), 1900);
    return () => clearInterval(t);
  }, []);
  const rows = [0, 1, 2].map((k) => TICKER[(i + k) % TICKER.length]);
  return (
    <div className="space-y-2">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((r, k) => {
          const a = agentById(r.agent);
          return (
            <motion.div
              key={r.action}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: k === 0 ? 1 : 1 - k * 0.16, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.45 }}
              className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1", k === 0 ? "bg-white/[0.16] ring-white/30 shadow-[0_8px_24px_-12px_rgba(10,4,30,0.6)]" : "bg-white/[0.08] ring-white/15")}
            >
              <span className="rounded-lg bg-white p-0.5 shadow-sm">
                <Logo name={a.logo} bleed={a.bleed} size={26} rounded="rounded-md" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] font-medium text-white truncate">{r.action}</div>
                <div className="text-[11px] text-white/75 truncate">
                  {a.name} · {r.why}
                </div>
              </div>
              <DecisionPill d={r.d} size="sm" className="bg-white! shadow-sm" />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Start() {
  const workspace = useStore((s) => s.workspace);
  const s = useStore((x) => x);
  const freshHasData = workspaceHasData("fresh");
  const meta = WORKSPACES[workspace];
  const p50 = useMemo(() => {
    const xs = s.events.map((e) => e.latency).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 3;
  }, [s.events]);

  const steps: { label: string; done: boolean; path: string; hint: string }[] = [
    { label: "Create the workspace", done: s.onboarded.admin || !!s.idp, path: "/onboarding/admin", hint: "SSO, company, data region" },
    { label: "Connect your first agent", done: Object.keys(s.connected).length > 0, path: "/agents", hint: `${Object.keys(s.connected).length} of ${AGENTS.length} connected` },
    { label: "Publish your intent contract", done: s.version > 0 && s.published.length > 0, path: "/contract", hint: s.published.length ? `v${s.version} · ${s.published.length} rules` : "empty — everything is allowed" },
    { label: meta.labs ? "Send your first action" : "See the first decision", done: s.events.length > 0, path: meta.labs ? "/playground" : "/evidence", hint: `${s.events.length.toLocaleString("en-US")} decisions so far` },
    { label: "Bring in your team", done: s.members.length > 1, path: "/team", hint: `${s.members.length} ${s.members.length === 1 ? "person" : "people"}` },
    { label: "An employee installs Wrapbox", done: s.devices.length > 0, path: "/onboarding/employee", hint: `${s.devices.length} laptops reporting` },
    { label: "First signed human approval", done: s.approvals.some((a) => a.status === "approved"), path: "/approvals", hint: `${s.approvals.filter((a) => a.status === "pending").length} waiting` },
    { label: "Read the evidence trail", done: s.events.some((e) => e.permit), path: "/evidence", hint: "human → agent → rule → permit → outcome" },
  ];
  const done = steps.filter((x) => x.done).length;

  const startFresh = (role: "admin" | "employee") => {
    switchWorkspace("fresh");
    setState({ role });
    go(role === "admin" ? "/onboarding/admin" : "/onboarding/employee");
  };
  return (
    <div className="mx-auto max-w-[1180px] px-4 lg:px-8 py-8">
      <section
        className="hero-prism parallax-head overflow-hidden rounded-3xl p-7 lg:p-9 text-white shadow-[0_24px_60px_-28px_rgba(120,40,90,0.55)]"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
          e.currentTarget.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.setProperty("--mx", "0");
          e.currentTarget.style.setProperty("--my", "0");
        }}
      >
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-center">
          <div className="parallax-mouse" style={{ ["--depth" as string]: -6 }}>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 ring-1 ring-white/40 backdrop-blur-md px-3.5 py-1.5 text-[12px] font-medium text-white">
              <span className="size-1.5 rounded-full bg-[#1b0f33]" />
              Runtime authorization for AI agents
            </div>
            <h1 className="mt-5 text-[38px] lg:text-[46px] leading-[1.02] font-semibold tracking-[-0.04em] [text-shadow:0_2px_24px_rgba(90,20,40,0.25)]">
              Put every AI agent
              <br />
              on a <span className="text-[#1b0f33] [text-shadow:none]">permit</span>.
            </h1>
            <p className="mt-4 max-w-[52ch] text-[14.5px] leading-relaxed font-medium text-white/90">
              Claude Code, Cursor, Codex, your LangGraph agents, Agentforce, browser agents — every risky action is checked a few milliseconds before it runs, against one contract you write. Explore a live company, or build your own from zero.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => startFresh("admin")} className="inline-flex items-center gap-2 h-11 rounded-full bg-[#1b0f33] px-5 text-[14px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(27,15,51,0.8)] hover:bg-[#2a1850] transition-colors">
                <Plus className="size-4" /> Build from zero
              </button>
            </div>
          </div>
          <div className="parallax-mouse rounded-2xl bg-[#160a2e]/40 ring-1 ring-white/25 p-4 backdrop-blur-xl shadow-[0_20px_50px_-20px_rgba(10,4,30,0.7)]" style={{ ["--depth" as string]: 14 }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-semibold text-white">Decisions, as they happen</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white">
                <span className="size-1.5 rounded-full bg-[#5ef0b5] live-dot" /> p50 {p50} ms
              </span>
            </div>
            <Ticker />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PathCard
          icon={<Plus className="size-4.5" />}
          tag={freshHasData ? "Fresh workspace · in progress" : "Fresh workspace · empty"}
          title="Build it yourself, as the admin"
          body="No data anywhere. Create the workspace, write the contract, connect agents, invite people — and watch every page fill in from what you do."
          cta={freshHasData ? "Resume admin setup" : "Start from zero"}
          active={workspace === "fresh"}
          onClick={() => startFresh("admin")}
        />
        <PathCard
          icon={<UserRound className="size-4.5" />}
          tag={workspace === "fresh" ? "In your fresh workspace" : `In ${s.company}`}
          title="Join as an employee"
          body="Accept the invite, run one command, see the rules in plain English, try a blocked action, approve from Slack. About 3 minutes."
          cta="Join as Dev"
          onClick={() => {
            setState({ role: "employee" });
            go("/onboarding/employee");
          }}
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-6 pt-5 pb-4">
          <div className="flex-1 min-w-[260px]">
            <div className="eyebrow">{workspace === "fresh" ? "Your fresh workspace" : `${s.company} · ${meta.label.toLowerCase()}`} · setup checklist</div>
            <div className="mt-1 text-[18px] font-semibold tracking-tight">
              {done === steps.length ? "Everything is live." : `${done} of ${steps.length} done — ${steps.find((x) => !x.done)?.label.toLowerCase()} next.`}
            </div>
          </div>
          <div className="w-[220px]">
            <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
              <motion.div className="h-full prism-swatch"animate={{ width: `${(done / steps.length) * 100}%` }} />
            </div>
            <div className="mt-1 text-right text-[11.5px] text-fg-3 tnum">{Math.round((done / steps.length) * 100)}%</div>
          </div>
        </div>
        <ol className="grid sm:grid-cols-2 border-t border-line">
          {steps.map((x, i) => (
            <li key={x.label} className={cn("border-b border-line sm:odd:border-r", i >= steps.length - 2 && "sm:border-b-0")}>
              <a href={"#" + x.path} className="flex items-center gap-3 px-6 py-3.5 hover:bg-surface-2 transition-colors">
                <span className={cn("grid size-6 place-items-center rounded-full text-[11px] font-semibold shrink-0", x.done ? "bg-allow text-white" : "border border-line-strong text-fg-3")}>{x.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13.5px] font-medium", x.done && "text-fg-2")}>{x.label}</span>
                  <span className="block text-[11.5px] text-fg-3 truncate">{x.hint}</span>
                </span>
                <ArrowRight className="size-3.5 text-fg-3" />
              </a>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function PathCard({ icon, tag, title, body, cta, onClick, active, primary }: { icon: React.ReactNode; tag: string; title: string; body: string; cta: string; onClick: () => void; active?: boolean; primary?: boolean }) {
  return (
    <Card className={cn("p-5 flex flex-col transition-all hover:shadow-card", active ? "border-fg/40" : "hover:border-line-strong")}>
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl prism-swatch text-white shadow-[0_6px_16px_-8px_rgba(236,74,34,0.55)]">{icon}</span>
        {active && <span className="rounded-full bg-surface-2 border border-line px-2 py-0.5 text-[11px] text-fg-2">you're here</span>}
      </div>
      <div className="mt-4 eyebrow">{tag}</div>
      <div className="mt-1 text-[16px] font-semibold tracking-tight">{title}</div>
      <p className="mt-1.5 text-[12.5px] text-fg-2 leading-relaxed flex-1">{body}</p>
      <Button variant={primary ? "primary" : "secondary"} className="mt-4 self-start" onClick={onClick}>
        {cta} <ArrowRight className="size-3.5" />
      </Button>
    </Card>
  );
}
