import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Building2, Check, Wand2, Trash2, ChevronDown, ChevronRight, CircleCheck, FileCode2, KeyRound, Loader2, Lock, Mail, Play, ShieldCheck, Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AGENTS, ASSURANCE, METHODS, PLANNED_MECHANISM, PRODUCT_CATS, agentById, enforcementOf, type Adapter, type Agent, type CategoryId, type Decision, type Surface } from "../data/agents";
import { PACKS, orgSlug, rulesForPacks, toYaml, type Rule } from "../data/contract";
import { PEOPLE } from "../data/people";
import { SCENARIOS, actOf, nativeFor, type Gate } from "../data/scenarios";
import { CodeBlock, InlineCmd, json } from "../components/code";
// Real SDK example source, shown verbatim so the UI can never drift from the implementation.
import claimsSrc from "../sdk/examples/claims.ts?raw";
import frameworksSrc from "../sdk/examples/frameworks.ts?raw";
import { SlackCard } from "../components/insight";
import { WrapboxLogo } from "../components/logo";
import { Avatar, Button, Card, Chip, CopyButton, DecisionPill, Logo, Modal, Segmented, Toggle, cn } from "../components/ui";
import { RuleBuilder } from "./contract";
import { approveWithPasskey } from "../lib/actions";
import { sha256 } from "../lib/permit";
import { go } from "../lib/router";
import { ADMIN, DEMO_GROUPS, EMPLOYEE, askPasskey, connectAgent, ensurePending, evaluateNow, getState, grantConnectedAgents, markOnboarded, pushEvent, registerDevice, resolveApprovers, setState, syncDirectory, toast, upsertApproval, approvalFrom, gateFromAct, useStore } from "../lib/store";
import type { Verdict } from "../lib/engine";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ================= Shared layout ================= */

function SetupLayout({
  who,
  title,
  steps,
  step,
  reached,
  onJump,
  children,
}: {
  who: "admin" | "employee";
  title: string;
  steps: { t: string; s: string }[];
  step: number;
  reached: number;
  onJump: (i: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 self-start">
          <div className="flex items-center gap-2.5">
            <Avatar p={who === "admin" ? ADMIN : EMPLOYEE} size={30} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{title}</div>
              <div className="text-[11.5px] text-fg-3">{who === "admin" ? "Priya Menon · Founder" : "Dev Kapoor · Engineer"}</div>
            </div>
          </div>
          <div className="mt-4 h-1 rounded-full bg-surface-3 overflow-hidden">
            <motion.div className="h-full bg-ink" animate={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-4 space-y-0.5">
            {steps.map((x, i) => (
              <li key={x.t}>
                <button
                  disabled={i > reached}
                  onClick={() => onJump(i)}
                  className={cn("flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed", i === step ? "bg-surface border border-line shadow-card" : "border border-transparent hover:bg-surface-2")}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 place-items-center rounded-full text-[10.5px] font-semibold shrink-0",
                      i < reached || (i < step) ? "bg-allow text-white" : i === step ? "bg-ink text-ink-fg" : "border border-line text-fg-3",
                    )}
                  >
                    {i < step || (i < reached && i !== step) ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[13px] font-medium", i > reached ? "text-fg-3" : "text-fg")}>{x.t}</span>
                    <span className="block text-[11.5px] text-fg-3 leading-snug">{x.s}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button onClick={() => go("/start")} className="mt-4 inline-flex items-center gap-1.5 px-2.5 text-[12px] text-fg-3 hover:text-fg">
            <X className="size-3.5" /> Exit setup
          </button>
        </aside>
        <AnimatePresence mode="wait">
          <motion.section key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }} className="min-w-0">
            {children}
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
}

function StepHead({ n, total, title, sub }: { n: number; total: number; title: string; sub: string }) {
  return (
    <div className="mb-5">
      <div className="eyebrow">
        Step {n} of {total}
      </div>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-[68ch] text-[14px] text-fg-2 leading-relaxed">{sub}</p>
    </div>
  );
}

function Footer({ onBack, onNext, next = "Continue", disabled, hint }: { onBack?: () => void; onNext: () => void; next?: string; disabled?: boolean; hint?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Back
        </Button>
      )}
      {hint && <span className="text-[12px] text-fg-3">{hint}</span>}
      <Button variant="primary" size="lg" className="ml-auto" onClick={onNext} disabled={disabled}>
        {next} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

function Tick({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[13px]">
      {on ? <CircleCheck className="size-4 text-allow shrink-0" /> : <Loader2 className="size-4 animate-spin text-fg-3 shrink-0" />}
      <span className={on ? "text-fg" : "text-fg-3"}>{children}</span>
    </motion.div>
  );
}

/* ================= Admin setup ================= */

/* PACKS is imported from data/contract — there is exactly one pack → rule mapping in the
   product. This file used to keep its own copy, which silently drifted (it was missing
   git.force) and made the published contract disagree with the pack card. */
const REC_PACK_IDS = PACKS.filter((p) => p.rec).map((p) => p.id).concat(["claims", "commercial", "browser"]);
const REC_RULE_COUNT = rulesForPacks(REC_PACK_IDS).length;

const BLOCKS: { id: string; cats: CategoryId[]; title: string; agents: string[]; what: string }[] = [
  { id: "coding", cats: ["ide", "cli"], title: "Coding agents on laptops", agents: ["claude-code", "cursor", "codex-cli", "copilot-ide"], what: "One installer writes each agent's native hook file — Claude Code, Cursor, Codex, Copilot, Gemini." },
  { id: "cloud", cats: ["cloud"], title: "Cloud coding agents", agents: ["copilot-cloud"], what: "Give the hosted runner a task-scoped token and route its tools through the gateway." },
  { id: "sdk", cats: ["custom"], title: "Your own agents (SDK)", agents: ["langgraph"], what: "Wrap each tool executor, and have the target service verify the permit." },
  { id: "mcp", cats: ["mcp"], title: "MCP servers & payment gateways", agents: ["stripe-mcp", "github-mcp", "postgres-mcp", "razorpay-mcp"], what: "Wrap each upstream once; every MCP client uses the Wrapbox URL." },
  { id: "saas", cats: ["saas"], title: "SaaS agents", agents: ["agentforce"], what: "Consequential platform actions call a Wrapbox-authorized connector." },
  { id: "browser", cats: ["browser"], title: "Browser agents", agents: ["browser-use"], what: "The executor re-checks the final click against the permit." },
  { id: "a2a", cats: ["a2a"], title: "Multi-agent delegation", agents: ["openai-handoffs"], what: "Handoffs carry an attenuated token; children can't exceed parents." },
];

/* ---- Step 4 integration metadata ----
   Each label is grounded in the vendor's real control point (verified against current docs).
   Installing on the vendor is SIMULATED; the verified decision is REAL — it comes from
   evaluateNow(), the same evaluator the runtime and Step 7 use. */
const regById = (id: string): Agent | undefined => AGENTS.find((a) => a.id === id);

const CONTROL: Record<Adapter, string> = {
  claude: "Managed hooks + settings",
  cursor: "Cursor hooks (failClosed)",
  codex: "Codex hooks · ~/.codex (shared harness)",
  gemini: "Gemini CLI hooks (BeforeTool)",
  copilot: "Copilot hooks · .github/hooks",
  runtime: "Endpoint runtime + MCP gateway",
  mcp: "MCP gateway (endpoint swap)",
  "sdk-py": "Wrapbox SDK guard + service permit",
  "sdk-ts": "Wrapbox SDK guard + service permit",
  adk: "ADK before_tool_callback",
  cloud: "Task-scoped MCP gateway",
  connector: "Authorized platform connector",
  browser: "Controlled executor",
  a2a: "Delegation gateway (attenuated token)",
  windsurf: "Cascade hooks · .windsurf/hooks.json",
  cline: "Cline hooks · .clinerules/hooks",
  opencode: "OpenCode plugin · tool.execute.before",
  droid: "Droid hooks · .factory/hooks.json",
  kiro: "Kiro CLI hooks · .kiro/agents",
  auggie: "Auggie hooks · ~/.augment/settings.json",
};
const RUNS_ON: Record<Surface, string> = {
  terminal: "Developer laptop / terminal",
  ide: "Developer laptop / IDE",
  github: "Hosted runner",
  graph: "Your service",
  chat: "MCP clients",
  crm: "SaaS platform",
  browser: "Browser runtime",
  delegation: "Agent runtime",
};
// MDM applies only to laptop-class hook adapters. Copilot hooks are repo-scoped; cloud,
// MCP, SDK and browser deploy through their own mechanisms — so MDM is never offered there.
const MDM_ADAPTERS = new Set<Adapter>(["claude", "cursor", "codex", "gemini", "runtime", "windsurf", "cline", "droid", "kiro", "auggie", "opencode"]);

/** How Wrapbox confirms a genuine connection for each adapter (the check-in / heartbeat). */
const HEARTBEAT: Record<Adapter, string> = {
  claude: "The managed hook registers this device with Wrapbox the first time the agent runs, then heartbeats.",
  cursor: "The Cursor hook checks in with Wrapbox on the agent's first run, then heartbeats.",
  codex: "The ~/.codex hook registers the device on first run, then heartbeats.",
  gemini: "The BeforeTool hook checks in on first run, then heartbeats.",
  copilot: "The .github/hooks adapter registers the repo on the first agent run.",
  runtime: "The endpoint runtime registers the device when it starts, then heartbeats.",
  cloud: "The hosted runner's first gateway call registers the task with Wrapbox.",
  mcp: "Wrapbox sees the client's first tools/list through the gateway.",
  "sdk-ts": "The target service's first permit verification registers the integration.",
  "sdk-py": "The target service's first permit verification registers the integration.",
  adk: "The first before_tool_callback registers the integration.",
  connector: "The platform's first authorized action call registers the connector.",
  browser: "The controlled executor registers on its first authorized action.",
  a2a: "The first delegated handoff registers the peer.",
  windsurf: "The Cascade pre-hook checks in on the agent's first run, then heartbeats.",
  cline: "The PreToolUse hook script checks in on the first tool call, then heartbeats.",
  opencode: "The plugin registers the device when OpenCode loads it, then heartbeats.",
  droid: "The PreToolUse hook checks in on the first tool call, then heartbeats.",
  kiro: "The preToolUse hook checks in on the first tool call, then heartbeats.",
  auggie: "The PreToolUse hook checks in on the first tool call, then heartbeats.",
};

export interface DeployOption {
  key: string;
  label: string;
  desc: string;
  cmd?: string;
}
/** The real deployment choices for an agent — MDM only where the vendor supports it. */
function deployOptions(a: Agent): DeployOption[] {
  if (MDM_ADAPTERS.has(a.adapter))
    return [
      { key: "mdm", label: "Push with MDM", desc: "Company IT deploys the Wrapbox config to managed laptops via Jamf, Intune or Kandji." },
      { key: "manual", label: "Manual install", desc: "Run once on the device.", cmd: a.install },
    ];
  switch (a.adapter) {
    case "copilot":
      return [{ key: "repo", label: "Add to repositories", desc: "Commit the hook to .github/hooks, or ship it from your org template repo.", cmd: a.install }];
    case "cloud":
      return [{ key: "repo", label: "Configure in repository", desc: "Repo → Settings → Copilot → MCP, with a task-scoped token for the runner.", cmd: a.install }];
    case "mcp":
      return [{ key: "gateway", label: "Point client at the gateway", desc: "Swap the upstream URL for the Wrapbox gateway URL — every MCP client uses it.", cmd: a.install }];
    case "sdk-ts":
    case "sdk-py":
    case "adk":
      return [{ key: "sdk", label: "Add the Wrapbox SDK", desc: "Add the dependency and wrap each tool executor; the service verifies the permit.", cmd: a.install }];
    case "browser":
      return [{ key: "wrap", label: "Wrap the executor", desc: "Route consequential actions through the Wrapbox controlled executor.", cmd: a.install }];
    case "connector":
      return [{ key: "connector", label: "Import the connector", desc: "Import the Wrapbox connector and call it from the platform's agent actions.", cmd: a.install }];
    default:
      return [{ key: "manual", label: "Install", desc: "", cmd: a.install }];
  }
}
/* Step 2 taxonomy (PRODUCT_CATS), enforcementOf and PLANNED_MECHANISM live in
   src/data/agents.ts, so onboarding, Agents and Overview all read one list. */

/** The visible rollout steps for a deployment method (0..3), shown while connecting. */
function phaseLabels(method: string): [string, string, string, string] {
  switch (method) {
    case "mdm":
      return ["Queued in Jamf / Intune", "Pushing config to managed laptops", "Devices checking in with Wrapbox", "Connected — reporting to Wrapbox"];
    case "repo":
      return ["Committed to the repo / org template", "Waiting for the next agent run", "First run checked in", "Connected"];
    case "gateway":
      return ["Gateway route saved", "Client pointed at the Wrapbox URL", "First tools/list received", "Connected"];
    case "sdk":
      return ["SDK dependency added", "Workspace credentials verified", "First guard() call received", "Connected"];
    default:
      return ["Config installed on the device", "Adapter starting up", "First check-in received", "Connected"];
  }
}

/** The Wrapbox adapter version reported at check-in (same across vendors). */
const ADAPTER_VER = "1.4.2";
/** A registration identifier Wrapbox assigns when the integration first checks in. */
function registrationId(a: Agent): string {
  const prefix = MDM_ADAPTERS.has(a.adapter) || a.adapter === "copilot" ? "device" : a.adapter === "cloud" ? "runner" : a.adapter === "mcp" ? "client" : a.surface === "graph" ? "svc" : "node";
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

/* What a real read-only GitHub App sees: the small config files each agent leaves behind.
   Scanning reads only these paths — never source code. */
// Each hit carries the canonical registry `id`, so Step 2 discovery and Step 4 connection
// reference the SAME integration identity — no separate agent list to drift out of sync.
interface Hit {
  path: string;
  id: string;
  agent: string;
  logo: string;
  cat: CategoryId;
}
const HIT_REPOS: { repo: string; hits: Hit[] }[] = [
  { repo: "web", hits: [{ path: ".cursor/hooks.json", id: "cursor", agent: "Cursor", logo: "cursor", cat: "ide" }, { path: ".claude/settings.json", id: "claude-code", agent: "Claude Code", logo: "claudecode", cat: "cli" }] },
  { repo: "payments-api", hits: [{ path: ".claude/settings.json", id: "claude-code", agent: "Claude Code", logo: "claudecode", cat: "cli" }, { path: "mcp.json", id: "stripe-mcp", agent: "Stripe MCP", logo: "stripe", cat: "mcp" }] },
  { repo: "billing", hits: [{ path: ".cursor/hooks.json", id: "cursor", agent: "Cursor", logo: "cursor", cat: "ide" }, { path: "mcp.json", id: "postgres-mcp", agent: "Postgres MCP", logo: "postgresql", cat: "mcp" }] },
  { repo: "claims-agent", hits: [{ path: "langgraph.json", id: "langgraph", agent: "LangGraph", logo: "langgraph", cat: "custom" }, { path: ".claude/settings.json", id: "claude-code", agent: "Claude Code", logo: "claudecode", cat: "cli" }] },
  { repo: "infra", hits: [{ path: ".codex/config.toml", id: "codex-cli", agent: "Codex CLI", logo: "codex", cat: "cli" }] },
  { repo: "data-platform", hits: [{ path: "mcp.json", id: "postgres-mcp", agent: "Postgres MCP", logo: "postgresql", cat: "mcp" }, { path: ".gemini/settings.json", id: "gemini-cli", agent: "Gemini CLI", logo: "geminicli", cat: "cli" }] },
  { repo: "ops-agents", hits: [{ path: "langgraph.json", id: "langgraph", agent: "LangGraph", logo: "langgraph", cat: "custom" }] },
  { repo: "mobile", hits: [{ path: ".github/copilot-instructions.md", id: "copilot-ide", agent: "GitHub Copilot", logo: "githubcopilot", cat: "ide" }] },
  { repo: "checkout", hits: [{ path: ".cursor/hooks.json", id: "cursor", agent: "Cursor", logo: "cursor", cat: "ide" }, { path: ".github/workflows/copilot-agent.yml", id: "copilot-cloud", agent: "Copilot cloud agent", logo: "githubcopilot", cat: "cloud" }] },
  { repo: "growth-site", hits: [{ path: ".windsurf/rules.md", id: "windsurf", agent: "Windsurf", logo: "windsurf", cat: "ide" }] },
  { repo: "support-tools", hits: [{ path: "requirements.txt", id: "browser-use", agent: "Browser Use", logo: "browseruse", cat: "browser" }] },
  { repo: "ledger", hits: [{ path: ".claude/settings.json", id: "claude-code", agent: "Claude Code", logo: "claudecode", cat: "cli" }, { path: ".codex/config.toml", id: "codex-cli", agent: "Codex CLI", logo: "codex", cat: "cli" }] },
  { repo: "risk-engine", hits: [{ path: "mcp.json", id: "github-mcp", agent: "GitHub MCP", logo: "mcp", cat: "mcp" }] },
  { repo: "partner-portal", hits: [{ path: ".cursor/hooks.json", id: "cursor", agent: "Cursor", logo: "cursor", cat: "ide" }] },
];
const CLEAN_REPOS = ["design-system", "docs-site", "brand", "eslint-config", "terraform-modules", "k8s-manifests", "load-tests", "sdk-js", "sdk-python", "status-page", "email-templates", "analytics-dbt", "feature-flags", "legacy-php", "cron-jobs", "image-proxy", "pdf-service", "search-index", "notification-svc", "webhooks", "admin-scripts", "onboarding-emails", "pricing-page", "helm-charts", "grafana-dashboards", "runbooks", "sandbox", "archive-2023"];
const TOTAL_REPOS = HIT_REPOS.length + CLEAN_REPOS.length;

/** Roll the per-repo hits up into one row per discovered integration, keyed by registry id. */
interface Discovered {
  id: string;
  agent: string;
  logo: string;
  cat: CategoryId;
  paths: Set<string>;
  repos: string[];
}
function rollUp(): Discovered[] {
  const by = new Map<string, Discovered>();
  for (const r of HIT_REPOS)
    for (const h of r.hits) {
      const e = by.get(h.id) ?? { id: h.id, agent: h.agent, logo: h.logo, cat: h.cat, paths: new Set<string>(), repos: [] };
      e.paths.add(h.path);
      if (!e.repos.includes(r.repo)) e.repos.push(r.repo);
      by.set(h.id, e);
    }
  return [...by.values()].sort((a, b) => b.repos.length - a.repos.length);
}
const DISCOVERED = rollUp();

/** The GitHub App install flow, screen for screen: pick the account, grant read-only access, get redirected back. */
function GitHubInstall({ open, onClose, org, onDone }: { open: boolean; onClose: () => void; org: string; onDone: () => void }) {
  const [screen, setScreen] = useState<"account" | "permissions" | "working">("account");
  const [account, setAccount] = useState<string | null>(null);
  const [access, setAccess] = useState<"all" | "select">("all");
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (open) {
      setScreen("account");
      setAccount(null);
      setPhase(0);
    }
  }, [open]);
  const install = async () => {
    setScreen("working");
    for (let i = 1; i <= 4; i++) {
      await sleep(650);
      setPhase(i);
    }
    await sleep(400);
    onDone();
    onClose();
  };
  const PERMS: [string, string][] = [
    ["Metadata", "Read — repository names, sizes and visibility"],
    ["Contents", "Read — only agent config files (.claude, .cursor, mcp.json …)"],
    ["Members", "Read — who belongs to the organization"],
  ];
  return (
    <Modal open={open} onClose={onClose} width={520}>
      <div className="flex items-center gap-2.5 bg-[#1f2328] px-5 py-3.5 text-white">
        <Logo name="github_light" size={22} rounded="rounded-full" />
        <div className="text-[13.5px] font-semibold">Install Wrapbox</div>
        <button onClick={onClose} className="ml-auto grid size-7 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white" aria-label="Cancel">
          <X className="size-4" />
        </button>
      </div>
      {screen === "account" && (
        <div className="p-6">
          <div className="text-[15px] font-semibold">Install Wrapbox on your account</div>
          <p className="mt-1 text-[13px] text-fg-2">Wrapbox by wrapbox.ai wants to see which AI agents your repositories use.</p>
          <div className="mt-4 space-y-1.5">
            {[
              { id: org, label: org, sub: `Organization · ${TOTAL_REPOS} repositories`, orgish: true },
              { id: "priya-m", label: "priya-m", sub: "Personal account · 3 repositories", orgish: false },
            ].map((a) => (
              <button key={a.id} onClick={() => setAccount(a.id)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors", account === a.id ? "border-fg bg-surface-2" : "border-line hover:bg-surface-2")}>
                <span className={cn("grid size-8 place-items-center text-[13px] font-bold text-white", a.orgish ? "rounded-md bg-[#1f2328]" : "rounded-full bg-[#6e7781]")}>{a.label[0].toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{a.label}</span>
                  <span className="block text-[11.5px] text-fg-3">{a.sub}</span>
                </span>
                <ChevronRight className="size-4 text-fg-3" />
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="allow" disabled={!account} onClick={() => setScreen("permissions")}>
              Continue
            </Button>
          </div>
        </div>
      )}
      {screen === "permissions" && (
        <div className="p-6">
          <div className="text-[15px] font-semibold">
            Install on <span className="font-mono text-[14px]">{account}</span>
          </div>
          <div className="mt-4 text-[12.5px] font-semibold">Repository access</div>
          <div className="mt-2 space-y-1.5">
            {[
              ["all", `All repositories`, `All ${TOTAL_REPOS} current and future repositories`],
              ["select", "Only select repositories", "Choose which repositories Wrapbox can see"],
            ].map(([v, t, sub]) => (
              <button key={v} onClick={() => setAccess(v as "all" | "select")} className={cn("flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left", access === v ? "border-fg bg-surface-2" : "border-line hover:bg-surface-2")}>
                <span className={cn("mt-0.5 grid size-4 place-items-center rounded-full border-2", access === v ? "border-fg" : "border-line-strong")}>{access === v && <span className="size-2 rounded-full bg-fg" />}</span>
                <span>
                  <span className="block text-[13px] font-medium">{t}</span>
                  <span className="block text-[11.5px] text-fg-3">{sub}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4 text-[12.5px] font-semibold">Wrapbox will have permission to:</div>
          <ul className="mt-2 space-y-1.5 rounded-xl border border-line p-3">
            {PERMS.map(([t, sub]) => (
              <li key={t} className="flex gap-2.5 text-[12.5px]">
                <Check className="mt-0.5 size-3.5 shrink-0 text-allow" strokeWidth={3} />
                <span>
                  <span className="font-medium">{t}</span> <span className="text-fg-3">· {sub}</span>
                </span>
              </li>
            ))}
            <li className="flex gap-2.5 text-[12.5px] text-fg-3">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              No write access. Source code is never uploaded.
            </li>
          </ul>
          <div className="mt-5 flex justify-between gap-2">
            <Button onClick={() => setScreen("account")}>Back</Button>
            <Button variant="allow" onClick={install}>
              Install &amp; Authorize
            </Button>
          </div>
        </div>
      )}
      {screen === "working" && (
        <div className="p-6">
          <div className="text-[14px] font-semibold">Authorizing on github.com…</div>
          <div className="mt-4 space-y-2">
            {["Redirecting to github.com/login/oauth", `Installing the App on ${account}`, "Exchanging the installation token", `Listing repositories · ${TOTAL_REPOS} found`].map((t, i) => (
              <div key={t} className={cn("flex items-center gap-2 text-[12.5px]", phase > i ? "text-fg" : "text-fg-3")}>
                {phase > i ? <CircleCheck className="size-4 text-allow" /> : phase === i ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4" />}
                {t}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* Sample companies for the demo. These are invented — using a real company here would imply
   they are a Wrapbox customer. Real brands appear only where they are true: the agents and
   tools you connect to. */
interface Sample {
  name: string;
  domain: string;
  industry: string;
  people: string;
  region: "us" | "eu" | "in";
  hue: number;
  shape: "square" | "circle" | "tag";
  mark: string;
}
const SAMPLES: Sample[] = [
  { name: "Northwind Logistics", domain: "northwind.co", industry: "Freight & supply chain", people: "2,400 people", region: "us", hue: 214, shape: "tag", mark: "N" },
  { name: "Meridian Health", domain: "meridianhealth.org", industry: "Hospital network", people: "8,100 people", region: "us", hue: 172, shape: "circle", mark: "M" },
  { name: "Kestrel Bank", domain: "kestrelbank.com", industry: "Retail banking", people: "12,000 people", region: "eu", hue: 248, shape: "square", mark: "K" },
  { name: "Lumen Retail", domain: "lumenretail.com", industry: "E-commerce", people: "3,300 people", region: "eu", hue: 28, shape: "circle", mark: "L" },
  { name: "Vantage Insurance", domain: "vantage-ins.com", industry: "Claims & underwriting", people: "5,600 people", region: "us", hue: 198, shape: "square", mark: "V" },
  { name: "Zephyr Mobility", domain: "zephyrmobility.io", industry: "Ride hailing", people: "1,900 people", region: "in", hue: 156, shape: "tag", mark: "Z" },
  { name: "Orchid Pharma", domain: "orchidpharma.in", industry: "Pharmaceuticals", people: "4,200 people", region: "in", hue: 322, shape: "circle", mark: "O" },
  { name: "Beacon Energy", domain: "beaconenergy.com", industry: "Utilities & grid", people: "7,400 people", region: "eu", hue: 42, shape: "tag", mark: "B" },
  { name: "Cobalt Software", domain: "cobalt.dev", industry: "B2B SaaS", people: "640 people", region: "us", hue: 232, shape: "square", mark: "C" },
  { name: "Saffron Foods", domain: "saffronfoods.in", industry: "Food & FMCG", people: "2,800 people", region: "in", hue: 14, shape: "circle", mark: "S" },
];

function CompanyMark({ c, size = 32 }: { c: Sample; size?: number }) {
  const id = c.domain.replace(/[^a-z]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={`cm-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${c.hue} 78% 58%)`} />
          <stop offset="1" stopColor={`hsl(${c.hue + 24} 70% 38%)`} />
        </linearGradient>
      </defs>
      {c.shape === "circle" ? (
        <circle cx="20" cy="20" r="20" fill={`url(#cm-${id})`} />
      ) : c.shape === "tag" ? (
        <path d="M0 10a10 10 0 0 1 10-10h20a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10H10A10 10 0 0 1 0 30Z" fill={`url(#cm-${id})`} />
      ) : (
        <rect width="40" height="40" rx="7" fill={`url(#cm-${id})`} />
      )}
      <text x="20" y="21" textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ font: `700 ${c.shape === "circle" ? 17 : 18}px var(--font-brand)` }}>
        {c.mark}
      </text>
    </svg>
  );
}

/** Company name field with a dropdown of sample companies to try. */
function CompanyField({ company, onPick, onType }: { company: string; onPick: (c: Sample) => void; onType: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", k);
    return () => window.removeEventListener("mousedown", k);
  }, [open]);
  const picked = SAMPLES.find((x) => x.name === company);
  return (
    <div ref={ref} className="relative">
      <span className="text-[12px] font-medium">Company name</span>
      <div className={cn("mt-1 flex h-10 items-center gap-2 rounded-xl border bg-surface pl-2.5 pr-1", open ? "border-fg-3" : "border-line")}>
        {picked ? <CompanyMark c={picked} size={22} /> : <Building2 className="size-4 shrink-0 text-fg-3" />}
        <input value={company} onChange={(e) => onType(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
        <button onClick={() => setOpen(!open)} aria-label="Choose a sample company" aria-expanded={open} className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute left-0 right-0 top-[72px] z-30 max-h-[320px] overflow-y-auto scroll-thin rounded-xl border border-line bg-surface shadow-float">
            <div className="px-3 pt-2.5 pb-1 eyebrow !text-[10.5px]">Try a sample company</div>
            {SAMPLES.map((c) => (
              <button
                key={c.domain}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors", company === c.name ? "bg-surface-2" : "hover:bg-surface-2")}
              >
                <CompanyMark c={c} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[11px] text-fg-3">
                    {c.industry} · {c.people} · {c.domain}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold uppercase text-fg-2">{c.region}</span>
              </button>
            ))}
            <div className="border-t border-line px-3 py-2 text-[11.5px] text-fg-3">Sample companies for the demo — or type your own name above.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ADMIN_STEPS = [
  { t: "Create workspace", s: "SSO, company, data region" },
  { t: "Discover agents", s: "Find what already runs" },
  { t: "Intent contract", s: "Your rules + rollout mode" },
  { t: "Connect & roll out", s: "Admin & IT · hooks, MDM, MCP, SDK" },
  { t: "Approvers & alerts", s: "Who signs what, where" },
  { t: "Invite your team", s: "Directory + invites" },
  { t: "Go live", s: "See the first decision" },
];

export function AdminSetup() {
  const fresh = useStore((s) => s.workspace === "fresh");
  // Onboarding connection state is ephemeral — it lives in local `conn` and resets on
  // refresh, so the admin re-connects by hand each visit. It is committed to the store
  // only when onboarding finishes (see finish()).
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const next = () => {
    setStep((s) => s + 1);
    setReached((r) => Math.max(r, step + 1));
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Step 1
  const [idp, setIdp] = useState<string | null>(null);
  const [company, setCompany] = useState("Wrapbox");
  const [domain, setDomain] = useState("wrapbox.ai");
  const [region, setRegion] = useState<"us" | "eu" | "in">("us");
  const [prov, setProv] = useState(0);
  const [thumb, setThumb] = useState("");
  // Step 2
  const [gh, setGh] = useState<"none" | "connected">("none");
  const [ghModal, setGhModal] = useState(false);
  const [scan, setScan] = useState<"idle" | "scanning" | "done">("idle");
  const [scanned, setScanned] = useState(0);
  const [log, setLog] = useState<{ repo: string; hits: Hit[] }[]>([]);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [cats, setCats] = useState<CategoryId[]>([]);
  // Step 2 "Other agent systems" — inventory-only, does not affect engine categories.
  const [otherSel, setOtherSel] = useState(false);
  const [otherNote, setOtherNote] = useState("");
  // Step 3
  // Starter packs are an optional accelerator, so the admin chooses how to start first.
  const [start, setStart] = useState<"recommended" | "scratch" | null>(null);
  const [pendingScratch, setPendingScratch] = useState(false);
  // Remembered selection: switching to scratch and back restores exactly what was on.
  const [packs, setPacks] = useState<string[]>(REC_PACK_IDS);
  const [mode, setMode] = useState<"observe" | "enforce">("enforce");
  const [customRules, setCustomRules] = useState<Rule[]>([]);
  const [ruleDrawer, setRuleDrawer] = useState(false);
  const [autoMax, setAutoMax] = useState(500);
  const [reviewMax, setReviewMax] = useState(5000);
  // Step 4 — the connected fact lives in the store (persists on reload); busy/conn are per-session.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Per-agent connection lifecycle: configured (deployed, awaiting check-in) → connected.
  // `phase` drives the visible rollout progress (0..3) while configuring.
  const [conn, setConn] = useState<Record<string, { stage: "configured" | "connected"; method: string; device: string; at: number; phase: number }>>({});
  const [openBlock, setOpenBlock] = useState<string>("coding");
  // Step 5
  const [channels, setChannels] = useState({ slack: true, teams: false, email: true });
  const [passkeyReq, setPasskeyReq] = useState(true);
  const [escalate, setEscalate] = useState<"5" | "15" | "30">("15");
  // Step 6
  const [scim, setScim] = useState<"idle" | "busy" | "done">("idle");
  const [invited, setInvited] = useState(false);
  // Step 7
  const [tests, setTests] = useState<{ key: string; stage: number; v?: Verdict }[]>([]);

  // Starter packs contribute only once "recommended" is chosen — nothing is injected silently.
  const activePacks = start === "recommended" ? packs : [];
  const packRules: Rule[] = rulesForPacks(activePacks).map((r) => {
    const x: Rule = { ...r, mode: mode === "observe" ? "observe" : undefined };
    if (r.id === "payments.refund" && r.tiers) x.tiers = [{ ...r.tiers[0], max: autoMax }, { ...r.tiers[1], max: reviewMax }, r.tiers[2]];
    return x;
  });
  const rules: Rule[] = [...packRules, ...customRules.map((r) => ({ ...r, mode: mode === "observe" ? ("observe" as const) : undefined }))];
  // Every count on screen is derived from the same array that gets published — never hard-coded.
  const starterCount = packRules.length;
  const customCount = customRules.length;
  const countHint =
    starterCount && customCount
      ? `${starterCount} starter + ${customCount} yours`
      : starterCount
        ? `${starterCount} starter ${starterCount === 1 ? "protection" : "protections"}`
        : customCount
          ? `${customCount} ${customCount === 1 ? "rule" : "rules"} yours`
          : "Nothing in the contract yet";
  const ghOrg = (domain || "wrapbox").split(".")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  // Derived from local, ephemeral `conn` — NOT the persisted store — so Step 4 always
  // starts disconnected on a fresh load and the admin connects each agent themselves.
  const connectedMap: Record<string, boolean> = Object.fromEntries(Object.entries(conn).filter(([, c]) => c.stage === "connected").map(([id]) => [id, true]));
  // How many of the 7 product categories the admin has selected (Coding counts once).
  const selectedProductCount = PRODUCT_CATS.filter((pc) => (pc.id === "other" ? otherSel : pc.cats.length > 0 && pc.cats.every((c) => cats.includes(c)))).length;
  const blocks = BLOCKS.filter((b) => b.cats.some((c) => cats.includes(c)));
  // Step 4 is driven by discovery: each block lists the agents Step 2 actually found.
  const blockAgents = (b: (typeof BLOCKS)[number]) => DISCOVERED.filter((d) => b.cats.includes(d.cat) && cats.includes(d.cat));
  const supportedIn = (b: (typeof BLOCKS)[number]) =>
    blockAgents(b).filter((d) => {
      const a = regById(d.id);
      return a && enforcementOf(a) === "connectable";
    });
  const agentTargets = blocks.flatMap(supportedIn);
  const connectedCount = agentTargets.filter((d) => !!connectedMap[d.id]).length;

  async function provision() {
    setProv(1);
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
    const hex = await sha256(Array.from(new Uint8Array(raw), (b) => String.fromCharCode(b)).join(""));
    setThumb(hex.slice(0, 16));
    for (let i = 2; i <= 5; i++) {
      await sleep(450);
      setProv(i);
    }
    if (fresh) setState({ company, domain, region, idp: idp ?? "" });
  }

  async function runScan() {
    setScan("scanning");
    setScanned(0);
    setLog([]);
    // Walk every repository the App can see, newest first, like the real crawler does.
    const order: { repo: string; hits: Hit[] }[] = [];
    const clean = [...CLEAN_REPOS];
    HIT_REPOS.forEach((h, i) => {
      order.push(h);
      for (let k = 0; k < 2 && clean.length; k++) order.push({ repo: clean.shift()!, hits: [] });
      if (i === HIT_REPOS.length - 1) while (clean.length) order.push({ repo: clean.shift()!, hits: [] });
    });
    for (let i = 0; i < order.length; i++) {
      await sleep(order[i].hits.length ? 150 : 55);
      setScanned(i + 1);
      setLog((l) => [...l.slice(-9), order[i]]);
    }
    await sleep(400);
    setScan("done");
    setCats([...new Set(DISCOVERED.map((d) => d.cat))]);
  }

  // Deploy one discovered agent's integration, then wait for it to check in.
  // Real production model: config is deployed (MDM / repo / manual), the adapter registers
  // with Wrapbox on first run, and the connection is confirmed on that heartbeat. The
  // external transport is simulated internally; no policy decisions happen on this page.
  async function deploy(id: string, method: string) {
    const a = regById(id);
    if (!a) return;
    setBusy((b) => ({ ...b, [id]: true }));
    // Walk the visible rollout: queued → pushing → checking in → connected.
    setConn((c) => ({ ...c, [id]: { stage: "configured", method, device: "", at: Date.now(), phase: 0 } }));
    for (let p = 1; p <= 2; p++) {
      await sleep(750);
      setConn((c) => ({ ...c, [id]: { ...c[id], phase: p } }));
    }
    await sleep(750);
    const device = registrationId(a);
    setConn((c) => ({ ...c, [id]: { stage: "connected", method, device, at: Date.now(), phase: 3 } }));
    setBusy((b) => ({ ...b, [id]: false }));
    toast(`${a.name} connected`, `checked in · ${device}`, "allow");
  }
  async function deployAll(b: (typeof BLOCKS)[number]) {
    for (const d of supportedIn(b)) {
      const a = regById(d.id);
      if (a && !connectedMap[d.id]) await deploy(d.id, deployOptions(a)[0].key);
    }
  }

  // Step 7 path selection: prove enforcement with whatever the admin actually connected.
  // Nothing connected → clearly-labelled preview on sample products. Same canonical evaluate().
  const connectedIds = Object.keys(connectedMap);
  const previewMode = connectedIds.length === 0;
  const pick = (ids: string[], fallback: string) => ids.find((id) => connectedIds.includes(id)) ?? fallback;
  const codingAgent = pick(["claude-code", "cursor", "codex-cli", "gemini-cli", "copilot-ide", "copilot-cloud"], "claude-code");
  const mcpAgent = pick(["stripe-mcp", "postgres-mcp", "github-mcp"], "stripe-mcp");
  const sdkAgent = pick(["langgraph", "openai-agents", "google-adk"], "langgraph");
  const codingOn = previewMode || connectedIds.some((id) => ["claude-code", "cursor", "codex-cli", "gemini-cli", "copilot-ide", "copilot-cloud"].includes(id));
  const mcpOn = previewMode || connectedIds.some((id) => ["stripe-mcp", "postgres-mcp", "github-mcp"].includes(id));
  const sdkOn = previewMode || connectedIds.some((id) => ["langgraph", "openai-agents", "google-adk"].includes(id));
  const TESTS: { key: string; label: string; agentId: string; gate: Gate }[] = [
    ...(codingOn ? [{ key: "coding", label: `Self-test as ${agentById(codingAgent).name} · read .env.production`, agentId: codingAgent, gate: SCENARIOS.ide.gates[0] }] : []),
    ...(mcpOn ? [{ key: "mcp", label: `Self-test as ${agentById(mcpAgent).name} · refund $8,000 through the MCP gateway`, agentId: mcpAgent, gate: SCENARIOS["mcp-stripe"].gates[1] }] : []),
    ...(sdkOn ? [{ key: "sdk", label: `Self-test as ${agentById(sdkAgent).name} · pay a ₹3,00,000 claim via the SDK`, agentId: sdkAgent, gate: SCENARIOS.custom.gates[0] }] : []),
  ];
  async function runTest(key: string) {
    const t = TESTS.find((x) => x.key === key)!;
    const v = evaluateNow(actOf(t.gate), t.agentId);
    setTests((ts) => [...ts.filter((x) => x.key !== key), { key, stage: 0, v }]);
    for (let i = 1; i <= 4; i++) {
      await sleep(380);
      setTests((ts) => ts.map((x) => (x.key === key ? { ...x, stage: i } : x)));
    }
    pushEvent({ agentId: t.agentId, human: "priya.m", action: t.gate.display, effect: actOf(t.gate).effect, decision: v.decision, observed: v.observed, rule: v.rule, reason: v.reason, latency: t.gate.latency, env: actOf(t.gate).env ?? "production", rewritten: v.decision === "CONSTRAIN" ? t.gate.constrain?.display : undefined, source: "flow" });
  }

  function finish() {
    if (fresh) {
      // Commit the agents connected during this session to the store, then grant access.
      for (const [id, c] of Object.entries(conn)) {
        if (c.stage !== "connected") continue;
        const a = regById(id);
        if (!a) continue;
        const m = METHODS[a.category].find((x) => x.recommended) ?? METHODS[a.category][0];
        connectAgent(id, c.method, m.assurance);
      }
      grantConnectedAgents();
    }
    markOnboarded("admin");
    setState({ role: "admin" });
    toast("Wrapbox is live", fresh ? "Every page now reflects what you set up. Invite employees next, or send an action from the playground." : "Every page now follows the contract you published.", "allow");
    go("/");
  }

  const total = ADMIN_STEPS.length;
  return (
    <SetupLayout who="admin" title="Set up Wrapbox" steps={ADMIN_STEPS} step={step} reached={reached} onJump={setStep}>
      {step === 0 && (
        <Card className="p-6">
          <StepHead n={1} total={total} title="Create your workspace" sub="Sign in with your company identity provider. Everyone you invite later signs in the same way, so agent actions are always tied to a real person." />
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ["google", "Google Workspace"],
              ["microsoft", "Microsoft Entra ID"],
              ["okta", "Okta"],
            ].map(([l, n]) => (
              <button key={l} onClick={() => setIdp(n)} className={cn("flex items-center gap-2.5 rounded-xl border px-3.5 h-11 text-[13px] font-medium transition-colors", idp === n ? "border-fg bg-surface" : "border-line hover:border-line-strong")}>
                <Logo name={l} size={22} rounded="rounded-md" /> Continue with {n.split(" ")[0]}
                {idp === n && <Check className="ml-auto size-4 text-allow" />}
              </button>
            ))}
          </div>
          {idp && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-center gap-2.5 rounded-xl bg-surface-2 border border-line px-3.5 py-2.5 text-[13px]">
              <Avatar p={ADMIN} size={24} /> Signed in as <b>priya@{domain}</b> via {idp} · MFA verified
            </motion.div>
          )}
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <CompanyField
              company={company}
              onType={setCompany}
              onPick={(c) => {
                setCompany(c.name);
                setDomain(c.domain);
                setRegion(c.region);
              }}
            />
            <Field label="Email domain (auto-join for SSO users)" value={domain} onChange={setDomain} />
            <div className="sm:col-span-2">
              <div className="text-[12px] font-medium mb-1.5">Data region — where decisions and evidence are stored</div>
              <Segmented
                value={region}
                onChange={setRegion}
                options={[
                  { value: "us", label: "United States" },
                  { value: "eu", label: "European Union" },
                  { value: "in", label: "India" },
                ]}
              />
            </div>
          </div>
          {prov > 0 && (
            <div className="mt-5 space-y-2 rounded-xl border border-line p-4">
              <Tick on={prov > 1}>Workspace “{company}” created · {region === "us" ? "us-east-1" : region === "eu" ? "eu-central-1" : "ap-south-1"}</Tick>
              {prov > 1 && <Tick on={prov > 2}>Signing key generated · ECDSA P-256 · thumbprint {thumb}</Tick>}
              {prov > 2 && <Tick on={prov > 3}>Policy engine ready · deterministic, p50 3 ms</Tick>}
              {prov > 3 && <Tick on={prov > 4}>Hash-chained evidence log opened</Tick>}
            </div>
          )}
          <Footer
            onNext={prov >= 5 ? next : provision}
            next={prov >= 5 ? "Continue" : prov > 0 ? "Creating…" : "Create workspace"}
            disabled={!idp || (prov > 0 && prov < 5)}
            hint={!idp ? "Choose an identity provider first" : undefined}
          />
        </Card>
      )}

      {step === 1 && (
        <Card className="p-6">
          <StepHead n={2} total={total} title="Discover the agents you already run" sub="Connect GitHub and Wrapbox reads only the small config files agents leave behind — never your source code — so you can see every agent in use before you govern anything." />

          {gh === "none" ? (
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => setGhModal(true)}>
                  <Logo name="github_light" size={18} rounded="rounded" /> Connect GitHub
                </Button>
                <span className="text-[12.5px] text-fg-3">Read-only GitHub App · nothing is connected yet</span>
              </div>
              <p className="mt-3 text-[12.5px] text-fg-2 max-w-[70ch]">
                No GitHub? Skip it and tick the platforms yourself below — the scan only saves you guessing.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-line overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 bg-surface-2 px-4 py-3">
                <Logo name="github_light" size={20} rounded="rounded" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">
                    github.com/{ghOrg} <span className="font-normal text-fg-3">· connected</span>
                  </div>
                  <div className="text-[11.5px] text-fg-3">
                    {TOTAL_REPOS} repositories · read-only · installed by you
                  </div>
                </div>
                <Button className="ml-auto" onClick={runScan} disabled={scan === "scanning"} variant={scan === "done" ? "secondary" : "primary"}>
                  {scan === "idle" ? `Scan ${TOTAL_REPOS} repositories` : scan === "scanning" ? `Scanning ${scanned}/${TOTAL_REPOS}…` : "Scan again"}
                </Button>
              </div>

              {scan !== "idle" && (
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div>
                    <div className="eyebrow mb-2">Reading config files</div>
                    <div className="h-[232px] overflow-hidden rounded-xl bg-code p-3 font-mono text-[11.5px] text-white/80">
                      {log.map((r, i) => (
                        <motion.div key={r.repo + i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="leading-[1.7]">
                          <span className="text-white/35">{ghOrg}/</span>
                          {r.repo}
                          {r.hits.length ? (
                            r.hits.map((h) => (
                              <span key={h.path} className="ml-2 text-[#5ef0b5]">
                                + {h.path}
                              </span>
                            ))
                          ) : (
                            <span className="ml-2 text-white/25">no agent config</span>
                          )}
                        </motion.div>
                      ))}
                      {scan === "scanning" && <div className="text-white/40">…</div>}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11.5px] text-fg-3">
                      <span className="tnum">
                        {scanned}/{TOTAL_REPOS} repositories
                      </span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <motion.span className="block h-full bg-ink" animate={{ width: `${(scanned / TOTAL_REPOS) * 100}%` }} />
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="eyebrow mb-2">{scan === "done" ? `${DISCOVERED.length} agents found in ${HIT_REPOS.length} of ${TOTAL_REPOS} repositories · 0 governed today` : "Agents found so far"}</div>
                    <div className="max-h-[300px] overflow-y-auto scroll-thin rounded-xl border border-line">
                      {(scan === "done" ? DISCOVERED : DISCOVERED.filter((d) => log.some((r) => r.hits.some((h) => h.agent === d.agent)))).map((d) => (
                        <div key={d.agent} className="border-b border-line last:border-0">
                          <button onClick={() => setOpenAgent(openAgent === d.agent ? null : d.agent)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2">
                            <Logo name={d.logo} size={22} rounded="rounded-md" bleed={d.logo === "browseruse"} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12.5px] font-medium">{d.agent}</span>
                              <span className="block truncate font-mono text-[11px] text-fg-3">{[...d.paths].join(" · ")}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-review-soft px-2 py-0.5 text-[10.5px] font-semibold text-review">ungoverned</span>
                            <span className="w-14 shrink-0 text-right font-mono text-[11.5px] tnum text-fg-2">{d.repos.length} {d.repos.length === 1 ? "repo" : "repos"}</span>
                            <ChevronDown className={cn("size-3.5 shrink-0 text-fg-3 transition-transform", openAgent === d.agent && "rotate-180")} />
                          </button>
                          <AnimatePresence initial={false}>
                            {openAgent === d.agent && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="space-y-1 bg-surface-2 px-3.5 py-2.5">
                                  {d.repos.map((r) => (
                                    <div key={r} className="flex items-center gap-2 font-mono text-[11px] text-fg-2">
                                      <FileCode2 className="size-3 shrink-0 text-fg-3" />
                                      {ghOrg}/{r}
                                      <span className="text-fg-3">
                                        → {HIT_REPOS.find((x) => x.repo === r)!.hits.filter((h) => h.agent === d.agent).map((h) => h.path).join(", ")}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                    {scan === "done" && <p className="mt-2 text-[12px] text-fg-2">Every one of these runs today with no policy in front of it. Tick the platforms below and Wrapbox puts a guard on each.</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[13px] font-semibold">Platforms to govern</div>
              {scan === "done" && <span className="rounded-full bg-allow-soft px-2 py-0.5 text-[10.5px] font-semibold text-allow">pre-selected from your scan</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {PRODUCT_CATS.map((pc) => {
                const isOther = pc.id === "other";
                const on = isOther ? otherSel : pc.cats.length > 0 && pc.cats.every((c) => cats.includes(c));
                const found = !isOther && scan === "done" && DISCOVERED.some((d) => pc.cats.includes(d.cat));
                const logos = AGENTS.filter((a) => pc.cats.includes(a.category)).slice(0, 4);
                const toggle = () => {
                  if (isOther) return setOtherSel((v) => !v);
                  setCats((x) => (on ? x.filter((y) => !pc.cats.includes(y)) : [...x, ...pc.cats.filter((c) => !x.includes(c))]));
                };
                return (
                  <button key={pc.id} onClick={toggle} className={cn("rounded-xl border p-3 text-left transition-colors", on ? "border-fg bg-surface" : "border-line opacity-70 hover:opacity-100")}>
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-1.5">
                        {logos.map((a) => (
                          <Logo key={a.id} name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" className="ring-2 ring-surface" />
                        ))}
                      </div>
                      <span className={cn("grid size-4.5 place-items-center rounded border", on ? "bg-ink border-ink text-ink-fg" : "border-line-strong")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[12.5px] font-semibold">
                      {pc.name}
                      {pc.enforcement === "roadmap" && <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[9.5px] font-semibold text-fg-3">roadmap</span>}
                    </div>
                    <div className="text-[11px] text-fg-3 leading-snug">{pc.sub}</div>
                    {found && <div className="mt-1.5 text-[10.5px] font-semibold text-allow">found in your org</div>}
                  </button>
                );
              })}
            </div>
            {otherSel && (
              <input
                value={otherNote}
                onChange={(e) => setOtherNote(e.target.value)}
                placeholder="Name the internal / emerging agent systems you run (inventory only)"
                className="mt-2 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] outline-none focus:border-fg-3"
              />
            )}
          </div>
          <Footer onBack={back} onNext={next} disabled={!cats.length && !otherSel} hint={cats.length || otherSel ? `${selectedProductCount} of ${PRODUCT_CATS.length} categories selected` : "Scan GitHub or tick a category to continue"} />
          <GitHubInstall open={ghModal} onClose={() => setGhModal(false)} org={ghOrg} onDone={() => setGh("connected")} />
        </Card>
      )}

      {step === 2 && (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_480px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="p-6 min-w-0">
            <StepHead n={3} total={total} title="Write your intent contract" sub="The contract is the set of rules Wrapbox enforces on every agent, whatever vendor it comes from. Use our recommended baseline, or publish only the rules you write." />
            {start === null && (
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={() => setStart("recommended")} className="rounded-2xl border border-line p-5 text-left transition-colors hover:border-fg">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4" />
                    <Chip>recommended</Chip>
                  </div>
                  <div className="mt-3 text-[15px] font-semibold">Start with recommended protections</div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-2">Begin with a practical baseline for secrets, source control, production, payments and other common agent risks.</p>
                  <p className="mt-2 text-[12px] text-fg-3">You can turn any protection off or customize it before publishing.</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium">
                    {REC_RULE_COUNT} rules ready <ArrowRight className="size-3.5" />
                  </span>
                </button>
                <button onClick={() => setStart("scratch")} className="rounded-2xl border border-line p-5 text-left transition-colors hover:border-fg">
                  <Wand2 className="size-4" />
                  <div className="mt-3 text-[15px] font-semibold">Start from scratch</div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-2">Create only the policies your organization needs.</p>
                  <p className="mt-2 text-[12px] text-fg-3">No starter rules are added. Your contract contains only the rules you create.</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium">
                    Write my first rule <ArrowRight className="size-3.5" />
                  </span>
                </button>
              </div>
            )}

            {start !== null && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <div className="min-w-[220px] flex-1">
                  <div className="text-[13px] font-semibold">{start === "recommended" ? "Recommended protections" : "Starting from scratch"}</div>
                  <p className="mt-0.5 text-[12px] text-fg-2">{start === "recommended" ? "An optional Wrapbox baseline. Turn off anything you don't want." : "No starter rules — the contract holds only what you create."}</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-line p-1">
                  {(
                    [
                      ["recommended", "Recommended"],
                      ["scratch", "From scratch"],
                    ] as const
                  ).map(([v, t]) => (
                    <button
                      key={v}
                      onClick={() => {
                        if (v === start) return;
                        if (v === "scratch" && starterCount) return setPendingScratch(true);
                        setStart(v);
                      }}
                      className={cn("h-7 rounded-md px-2.5 text-[12px] transition-colors", start === v ? "border border-fg bg-surface-2 font-semibold" : "border border-transparent text-fg-2 hover:bg-surface-2")}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pendingScratch && (
              <div className="mt-3 rounded-xl border border-line bg-surface-2 p-4">
                <div className="text-[13px] font-semibold">
                  Remove the {starterCount} starter {starterCount === 1 ? "rule" : "rules"}?
                </div>
                <p className="mt-1 text-[12px] text-fg-2">
                  {customCount ? `The ${customCount} ${customCount === 1 ? "rule" : "rules"} you wrote stay in the contract.` : "Your contract will be empty until you write a rule."} Switching back restores this pack selection.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setStart("scratch");
                      setPendingScratch(false);
                    }}
                  >
                    Remove starter protections
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingScratch(false)}>
                    Keep them
                  </Button>
                </div>
              </div>
            )}

            {start === "recommended" && (
              <div className="mt-5">
                <div className="text-[13px] font-semibold">Starter protections</div>
                <p className="mt-0.5 mb-3 text-[12px] text-fg-2">
                  Optional policy packs Wrapbox maintains · {starterCount} {starterCount === 1 ? "rule" : "rules"} selected
                </p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {PACKS.map((p) => {
                    const on = packs.includes(p.id);
                    // The real normalized count, straight from the shared mapping.
                    const n = rulesForPacks([p.id]).length;
                    return (
                      <div key={p.id} className={cn("rounded-xl border p-3.5 transition-colors", on ? "border-fg bg-surface" : "border-line")}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[13px] font-semibold">{p.name}</span>
                              <span className="text-[11.5px] text-fg-3">
                                · {n} {n === 1 ? "rule" : "rules"}
                              </span>
                              {p.rec && <Chip>recommended</Chip>}
                            </div>
                            <p className="mt-0.5 text-[12px] text-fg-2 leading-relaxed">{p.ex}</p>
                            <div className="mt-1.5 font-mono text-[10.5px] text-fg-3">{p.rules.join(" · ")}</div>
                          </div>
                          <Toggle on={on} onChange={() => setPacks((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))} label={p.name} />
                        </div>
                        {p.id === "payments" && on && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                            <DecisionPill d="ALLOW" size="sm" /> up to $
                            <input type="number" value={autoMax} onChange={(e) => setAutoMax(Number(e.target.value) || 0)} className="w-16 rounded border border-line bg-surface-2 px-1.5 h-6 font-mono" />
                            <DecisionPill d="REVIEW" size="sm" /> up to $
                            <input type="number" value={reviewMax} onChange={(e) => setReviewMax(Number(e.target.value) || 0)} className="w-20 rounded border border-line bg-surface-2 px-1.5 h-6 font-mono" />
                            <DecisionPill d="BLOCK" size="sm" /> above
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {start !== null && (
              <div className="mt-5">
                <div className="text-[13px] font-semibold">Your rules</div>
                <p className="mt-0.5 mb-3 text-[12px] text-fg-2">Policies your team writes with Describe, Build or Code.</p>
                {start === "scratch" && !customRules.length ? (
                  <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
                    <div className="text-[15px] font-semibold">Your contract is empty</div>
                    <p className="mx-auto mt-1.5 max-w-[360px] text-[12.5px] leading-relaxed text-fg-2">Describe the first action you want Wrapbox to govern.</p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                      <Button variant="primary" onClick={() => setRuleDrawer(true)}>
                        <Wand2 className="size-3.5" /> Describe a rule
                      </Button>
                      <button onClick={() => setStart("recommended")} className="text-[12.5px] font-medium text-fg-2 underline underline-offset-4 hover:text-fg-2">
                        Browse starter protections
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-[240px] flex-1">
                        <div className="text-[13px] font-semibold">A rule of your own</div>
                        <p className="mt-0.5 text-[12px] text-fg-2">Say anything else in plain English — “refunds over $500 need the payments manager” — and check the rule it drafts before it joins the contract.</p>
                      </div>
                      <Button variant="primary" onClick={() => setRuleDrawer(true)}>
                        <Wand2 className="size-3.5" /> Describe a rule
                      </Button>
                    </div>
                    {!!customRules.length && (
                      <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                        {customRules.map((r) => (
                          <div key={r.id} className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2">
                            <Chip>your rule</Chip>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">{r.title}</span>
                              <span className="block truncate font-mono text-[11px] text-fg-3">{r.id}</span>
                            </span>
                            <button onClick={() => setCustomRules((x) => x.filter((y) => y.id !== r.id))} className="grid size-7 place-items-center rounded-lg text-fg-3 hover:bg-surface-3 hover:text-block" aria-label={`Remove ${r.title}`}>
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {start !== null && (
              <div className="mt-5 rounded-xl border border-line p-4">
                <div className="text-[13px] font-semibold">How to roll it out</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["enforce", "Enforce now", "Decisions apply immediately. Best for secrets and production rules.", true],
                      ["observe", "Observe for 7 days", "Log what would have been blocked, without interrupting anyone. Good for a big rollout.", false],
                    ] as const
                  ).map(([v, t, d, rec]) => (
                    <button key={v} onClick={() => setMode(v)} className={cn("rounded-xl border p-3 text-left", mode === v ? "border-fg" : "border-line hover:border-line-strong")}>
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        <span className={cn("size-3.5 rounded-full border-2", mode === v ? "border-fg bg-fg" : "border-line-strong")} />
                        {t} {rec && <Chip>recommended</Chip>}
                      </div>
                      <p className="mt-1 text-[12px] text-fg-2">{d}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Footer
              onBack={back}
              onNext={() => {
                if (fresh) {
                  setState((st) => ({ rules, published: rules, version: st.version + 1, publishedAt: Date.now() }));
                  toast(`Contract v${getState().version} published`, `${countHint} · ${mode === "observe" ? "observe mode" : "enforcing"}`, "allow");
                }
                next();
              }}
              next={start === null ? "Choose how to start" : `${fresh ? "Publish contract" : "Save contract v1"} · ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`}
              disabled={start === null || !rules.length}
              hint={start === null ? "Pick recommended protections, or start from scratch" : fresh ? countHint : `${countHint} · demo workspace keeps its current contract`}
            />
          </Card>
          <div className="min-w-0 xl:sticky xl:top-6 self-start">
            <CodeBlock file="wrapbox.yaml" note={mode === "observe" ? "observe mode" : "enforce"} lang="yaml" code={toYaml(rules, 1, orgSlug(domain, company))} numbers maxH={640} />
          </div>
          <RuleBuilder
            open={ruleDrawer}
            initial={null}
            startMode="describe"
            existingIds={rules.map((r) => r.id)}
            onClose={() => setRuleDrawer(false)}
            onSave={(r) => {
              setCustomRules((x) => [...x, r]);
              setRuleDrawer(false);
              toast("Rule added to your contract", r.title, "allow");
            }}
          />
        </div>
      )}

      {step === 3 && (
        <Card className="p-6">
          <StepHead
            n={4}
            total={total}
            title="Connect & roll out agents"
            sub="An admin / IT task — employees do nothing here. Each agent connects through its own mechanism: a hook pushed to laptops with MDM (or one command on a machine IT can't reach), an MCP client pointed at the Wrapbox gateway, or the SDK added to your own agents. Once deployed, the integration registers itself with Wrapbox on its first run — that check-in is what turns it Connected. Policy decisions are proven later, in Go live."
          />
          <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12px] text-fg-2">
            <span className="font-semibold text-fg">Step 4 = the tools (admin / IT). Step 6 = the people.</span> Here you deploy Wrapbox into each agent's own control point — MDM push, one command, a gateway URL or the SDK — and wait for each to register. You invite the people who use them in Step 6; they install nothing.
          </div>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden">
              <motion.div className="h-full bg-allow" animate={{ width: `${(connectedCount / Math.max(1, agentTargets.length)) * 100}%` }} />
            </div>
            <span className="text-[12px] text-fg-2 tnum">
              {connectedCount} of {agentTargets.length} agents connected
            </span>
          </div>
          <div className="space-y-2">
            {blocks.map((b) => {
              const found = blockAgents(b);
              // Only products with a verified enforcement mechanism count toward "connected".
              const connectable = found.filter((d) => {
                const a = regById(d.id);
                return a && enforcementOf(a) === "connectable";
              });
              const roadmapOnly = connectable.length === 0 && found.length > 0;
              const nConn = connectable.filter((d) => !!connectedMap[d.id]).length;
              const status = roadmapOnly
                ? { label: "Inventory only", tone: "muted" as const }
                : nConn === 0
                  ? { label: "Not connected", tone: "muted" as const }
                  : nConn === connectable.length
                    ? { label: "Connected", tone: "allow" as const }
                    : { label: `Partially connected · ${nConn} of ${connectable.length}`, tone: "review" as const };
              const open = openBlock === b.id;
              const blockBusy = found.some((d) => busy[d.id]);
              return (
                <div key={b.id} className={cn("rounded-xl border", nConn > 0 && nConn === connectable.length ? "border-allow/40" : "border-line")}>
                  <button onClick={() => setOpenBlock(open ? "" : b.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    <div className="flex -space-x-1.5">
                      {found.slice(0, 5).map((d) => (
                        <Logo key={d.id} name={d.logo} bleed={regById(d.id)?.bleed} size={24} rounded="rounded-full" className="ring-2 ring-surface" />
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold">{b.title}</div>
                      <div className="text-[12px] text-fg-3 truncate">
                        {found.length} discovered · {roadmapOnly ? "enforcement on roadmap" : `${connectable.length} connectable`}
                      </div>
                    </div>
                    <Chip tone={status.tone}>{status.tone === "allow" ? (<><Check className="size-3" /> {status.label}</>) : status.label}</Chip>
                    <ChevronDown className={cn("size-4 text-fg-3 transition-transform", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div className="border-t border-line px-4 py-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="min-w-[240px] flex-1 text-[12px] text-fg-3">
                          {roadmapOnly
                            ? "In your inventory and governable by policy — a Wrapbox enforcement point for these is on the roadmap."
                            : "Discovered from your environment. Deploy each integration through its native mechanism; Wrapbox marks it connected when it checks in."}
                        </p>
                        {!roadmapOnly && (
                          <Button size="sm" onClick={() => deployAll(b)} disabled={blockBusy || !connectable.length}>
                            {blockBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Set up all
                          </Button>
                        )}
                      </div>
                      {found.map((d) => (
                        <IntegrationRow key={d.id} d={d} conn={conn[d.id]} connected={!!connectedMap[d.id]} busy={!!busy[d.id]} onDeploy={(method) => deploy(d.id, method)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Footer onBack={back} onNext={next} hint={connectedCount < agentTargets.length ? "You can connect the rest later from Agents" : "Every discovered agent is connected"} />
        </Card>
      )}

      {step === 4 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="p-6 min-w-0">
            <StepHead n={5} total={total} title="Approvers and alerts" sub="REVIEW decisions go to people, not to a queue nobody watches. Map each approver group in your contract to real people, and choose where they get asked." />
            <div className="rounded-xl border border-line overflow-hidden">
              {(
                [
                  ["oncall-sre", [PEOPLE.dev, PEOPLE.arjun], "PagerDuty schedule “payments-primary”", "pagerduty"],
                  ["claims-manager", [PEOPLE.meera, PEOPLE.rohan], "2 of 2 above ₹2,00,000", ""],
                  ["payments-manager", [PEOPLE.sara], "refunds $500–$5,000", ""],
                  ["vp-sales", [PEOPLE.ananya], "discounts > 25%", ""],
                  ["finance-controller", [PEOPLE.vikram], "browser payments", ""],
                ] as const
              ).map(([g, people, note, logo]) => (
                <div key={g} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line last:border-0">
                  <span className="font-mono text-[12.5px] text-review w-[150px]">{g}</span>
                  <div className="flex items-center gap-1.5">
                    {people.map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line pl-0.5 pr-2 h-7 text-[12px]">
                        <Avatar p={p} size={22} className="!ring-0" /> {p.name}
                      </span>
                    ))}
                  </div>
                  <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-fg-3">
                    {logo && <Logo name={logo} size={16} rounded="rounded" />} {note}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-line p-4 space-y-3">
                <div className="text-[13px] font-semibold">Where approvers get asked</div>
                {(
                  [
                    ["slack", "slack", "Slack"],
                    ["teams", "teams", "Microsoft Teams"],
                    ["email", "gmail", "Email"],
                  ] as const
                ).map(([k, logo, name]) => (
                  <div key={k} className="flex items-center gap-2.5">
                    <Logo name={logo} size={22} rounded="rounded-md" />
                    <span className="text-[13px] flex-1">{name}</span>
                    <Toggle on={channels[k]} onChange={(v) => setChannels((c) => ({ ...c, [k]: v }))} label={name} />
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-line p-4 space-y-3">
                <div className="text-[13px] font-semibold">Approval safety</div>
                <div className="flex items-center gap-2.5">
                  <KeyRound className="size-4 text-fg-2" />
                  <span className="text-[13px] flex-1">Every approval is a passkey signature</span>
                  <Toggle on={passkeyReq} onChange={setPasskeyReq} label="Passkey" />
                </div>
                <div className="flex items-center gap-2.5 opacity-80">
                  <ShieldCheck className="size-4 text-fg-2" />
                  <span className="text-[13px] flex-1">Requester can never approve their own action</span>
                  <Chip>always on</Chip>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[13px] flex-1">Escalate to admin after</span>
                  <Segmented
                    size="sm"
                    value={escalate}
                    onChange={setEscalate}
                    options={[
                      { value: "5", label: "5 min" },
                      { value: "15", label: "15 min" },
                      { value: "30", label: "30 min" },
                    ]}
                  />
                </div>
              </div>
            </div>
            <Footer
              onBack={back}
              onNext={() => {
                if (fresh) setState({ groups: DEMO_GROUPS });
                next();
              }}
            />
          </Card>
          <div className="space-y-3 min-w-0">
            <div className="eyebrow">What an approver sees in Slack</div>
            <SlackCard
              who="Dev Kapoor"
              title="Claude Code needs approval for Arjun Nair"
              lines={[
                ["Action", "kubectl delete deployment payments-api -n prod"],
                ["Rule", "prod.k8s.delete"],
                ["Dry run", "2 pods · ~40s of 5xx on /pay"],
              ]}
              onApprove={() => toast("Preview only", "Approvals happen in the live workspace")}
              onReject={() => toast("Preview only")}
            />
            <p className="text-[12px] text-fg-3 leading-relaxed">The same request is in the Wrapbox approval studio with the dry run, the risk signals and approval history. Approving from either place mints the same one-time permit.</p>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="p-6 min-w-0">
            <StepHead n={6} total={total} title="Invite your team" sub="Step 4 connected and rolled out the tools. This step brings in the people who use them — sync your directory and send the sign-in link. Their agents are already governed." />
            <div className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12px] text-fg-2">
              <span className="font-semibold text-fg">Step 4 = the tools. Step 6 = the people.</span> IT already connected and rolled out Wrapbox in Step 4 — no hooks, MDM push, MCP URLs or keys to touch again here. You only add who uses them.
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Logo name="okta" size={26} rounded="rounded-md" />
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[13px] font-semibold">Sync people from Okta (SCIM)</div>
                  <div className="text-[12px] text-fg-3">Groups become roles: eng → Developer · claims → Business user · sre-oncall → approver group oncall-sre</div>
                </div>
                <Button
                  variant={scim === "done" ? "secondary" : "primary"}
                  onClick={async () => {
                    setScim("busy");
                    await sleep(1000);
                    setScim("done");
                    if (fresh) syncDirectory();
                  }}
                  disabled={scim === "busy"}
                >
                  {scim === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : null} {scim === "done" ? `Synced · ${Object.values(PEOPLE).length} people` : "Connect Okta"}
                </Button>
              </div>
              {scim === "done" && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.values(PEOPLE).map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line pl-0.5 pr-2 h-7 text-[12px]">
                      <Avatar p={p} size={22} className="!ring-0" /> {p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 text-[13px] font-semibold mb-2">Invite people</div>
            <div className="space-y-2">
              <ShareRow n={1} title="Invite link" desc="Employees sign in with SSO and land in their own view. The agents you connected in Step 4 are governed the moment they sign in — nothing for them to install.">
                <CopyField value="https://app.wrapbox.ai/join/7Hq2-dK4v" />
              </ShareRow>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-fg-3">
              You send the link
              <ChevronRight className="size-3" /> they sign in with SSO
              <ChevronRight className="size-3" /> their connected agents are governed
            </div>
            <Footer
              onBack={back}
              onNext={() => {
                if (!invited) {
                  setInvited(true);
                  toast("Invites sent", `${scim === "done" ? Object.values(PEOPLE).length : 1} ${scim === "done" ? "people" : "person"} · they sign in with SSO and land in their own view`, "allow");
                }
                next();
              }}
              next={invited ? "Continue" : "Send invites & continue"}
            />
          </Card>
          <div className="space-y-3 min-w-0">
            <div className="eyebrow">The email employees receive</div>
            <InviteEmail />
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="p-6 min-w-0">
            <StepHead n={7} total={total} title="Go live — check the rules are live" sub="A self-test you send from this console — nobody on your team has to do anything yet. Wrapbox runs the action below through your published contract, the same engine production traffic uses, so you can confirm the rules really fire. Real decisions start appearing here once your team's agents run on their own machines." />
            {previewMode && (
              <div className="mb-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[12px] text-fg-2">
                Preview mode — no agent is connected yet. These run against the same evaluator on sample products so you can see the decision; connect an agent in Step 4 to prove it live.
              </div>
            )}
            <div className="space-y-2">
              {TESTS.map((t) => {
                const run = tests.find((x) => x.key === t.key);
                const agent = agentById(t.agentId);
                const native = nativeFor(agent, t.gate);
                const on = previewMode || !!connectedMap[t.agentId];
                const dv = run?.v;
                return (
                  <div key={t.key} className="rounded-xl border border-line">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Logo name={agent.logo} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold">{t.label}</div>
                        <div className="font-mono text-[11.5px] text-fg-3 truncate">{t.gate.display}</div>
                      </div>
                      {run?.stage === 4 && dv ? <DecisionPill d={dv.decision} /> : null}
                      {run?.stage === 4 && dv?.observed && <Chip tone="review">would {dv.observed}</Chip>}
                      {previewMode ? <Chip>preview</Chip> : !on && <Chip>connect in step 4</Chip>}
                      <Button size="sm" onClick={() => runTest(t.key)} disabled={!on || (!!run && run.stage < 4)}>
                        {run && run.stage < 4 ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3 fill-current" />} {run ? "Run again" : "Run self-test"}
                      </Button>
                    </div>
                    {run && (
                      <div className="border-t border-line px-4 py-3 grid gap-3 md:grid-cols-[200px_1fr]">
                        <div className="space-y-1.5">
                          {["Intercepted", "Normalized", "Policy matched", "Decided"].map((s, i) => (
                            <div key={s} className="flex items-center gap-2 text-[12px]">
                              {run.stage > i ? <CircleCheck className="size-3.5 text-allow" /> : <Loader2 className="size-3.5 animate-spin text-fg-3" />}
                              <span className={run.stage > i ? "text-fg" : "text-fg-3"}>{s}</span>
                              {i === 2 && run.stage > i && <span className="font-mono text-[10.5px] text-fg-3">{dv?.rule === "default" ? "no rule · default ALLOW" : dv?.rule}</span>}
                            </div>
                          ))}
                        </div>
                        {run.stage === 4 && (
                          <CodeBlock
                            lang="json"
                            maxH={170}
                            code={json(native.respond(dv!.decision, { reason: dv!.reason, rule: dv!.rule, decisionId: "d-1a2b3c", permitId: "wbp_first01", rewritten: dv!.decision === "CONSTRAIN" ? t.gate.constrain?.args : undefined }))}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Footer onBack={back} onNext={finish} next="Open the control plane" hint={tests.some((t) => t.stage === 4) ? "Rules confirmed live · real decisions appear as your team's agents run" : "Run one self-test to confirm the rules fire end to end"} />
          </Card>
          <Card className="p-5 h-fit">
            <div className="text-[13.5px] font-semibold">Setup summary</div>
            <ul className="mt-3 space-y-2.5 text-[13px]">
              {(
                [
                  [true, `Workspace “${company}” · ${idp ?? "SSO"} · ${region.toUpperCase()}`],
                  [true, `${selectedProductCount} agent ${selectedProductCount === 1 ? "category" : "categories"} selected`],
                  [true, `Contract · ${rules.length} rules · ${mode === "observe" ? "observe 7 days, then enforce" : "enforcing"}`],
                  [connectedCount > 0, `${connectedCount} of ${agentTargets.length} integrations connected`],
                  [true, `Approvals via ${Object.entries(channels).filter(([, v]) => v).map(([k]) => k).join(", ")} · passkey ${passkeyReq ? "required" : "optional"}`],
                  [invited, invited ? `${getState().members.length} ${getState().members.length === 1 ? "person" : "people"} in the directory` : "Team not invited yet"],
                ] as const
              ).map(([ok, t]) => (
                <li key={t} className="flex items-start gap-2">
                  {ok ? <CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> : <span className="mt-1 size-3 rounded-full border-2 border-line-strong shrink-0" />}
                  <span className={ok ? "" : "text-fg-3"}>{t}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11.5px] text-fg-3 leading-relaxed">{fresh ? "Everything above is now real in this workspace — open any page in the sidebar to see it." : "Demo workspace: your choices are previewed; the demo keeps its own contract and traffic. Start a fresh workspace to build for real."}</p>
          </Card>
        </div>
      )}
    </SetupLayout>
  );
}

/* One discovered integration on the setup page: identity, where it runs, the real control
   point, the enterprise deployment options (MDM / manual / native), and the connection
   lifecycle — Not connected → Setup configured → Connected (on a real check-in). No policy
   decisions are made here; that proof lives in Step 7. Native config is secondary detail. */
type ConnState = { stage: "configured" | "connected"; method: string; device: string; at: number; phase: number } | undefined;
function IntegrationRow({ d, conn, connected, busy, onDeploy }: { d: Discovered; conn: ConnState; connected: boolean; busy: boolean; onDeploy: (method: string) => void }) {
  const [setup, setSetup] = useState(false);
  const a = regById(d.id);
  const isConnected = connected || conn?.stage === "connected";
  const configuring = busy || conn?.stage === "configured";
  const roadmap = !!a && enforcementOf(a) === "roadmap";
  const isSdk = !!a && (a.adapter === "sdk-ts" || a.adapter === "sdk-py" || a.adapter === "adk");
  const options = a ? deployOptions(a) : [];
  const methodLabel = options.find((o) => o.key === conn?.method)?.label ?? "manual";
  // Honest assurance level — only for products that actually have an enforcement point today.
  const assurance = a && !roadmap ? ASSURANCE[(METHODS[a.category].find((m) => m.recommended) ?? METHODS[a.category][0]).assurance] : null;

  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Logo name={d.logo} bleed={a?.bleed} size={26} rounded="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-semibold">{a?.name ?? d.agent}</span>
            {a && <span className="text-[11.5px] text-fg-3">{a.vendor}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-2">
            {a ? `${RUNS_ON[a.surface]} · ${CONTROL[a.adapter]}` : "No Wrapbox adapter yet"}
            {assurance && (
              <span title={assurance.desc} className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-2">
                {assurance.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-fg-3 truncate">
            Found in {d.repos.length} {d.repos.length === 1 ? "repo" : "repos"} · {[...d.paths].join(" · ")}
          </div>
        </div>
        {!a ? (
          <Chip>Discovered · setup unavailable</Chip>
        ) : roadmap ? (
          <Chip>Inventory only — enforcement on roadmap</Chip>
        ) : isConnected ? (
          <Chip tone="allow">
            <Check className="size-3" /> Connected
          </Chip>
        ) : configuring ? (
          <Chip tone="review">Setup configured</Chip>
        ) : (
          <Chip>Not connected</Chip>
        )}
      </div>

      {a && roadmap && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
          <p className="text-[12px] text-fg-2">
            In your inventory now and targetable by policy in Step 3. Planned enforcement: <span className="font-medium">{PLANNED_MECHANISM[a.adapter] ?? "connector"}</span>. Until it ships, Wrapbox flags any policy that targets it as “no enforcement point connected yet”.
          </p>
        </div>
      )}

      {a && !roadmap && !isConnected && !configuring && (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <div key={o.key} className="rounded-lg border border-line p-3">
                <div className="text-[12.5px] font-semibold">{o.label}</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-2">{o.desc}</p>
                {o.cmd && <div className="mt-2"><InlineCmd cmd={o.cmd} /></div>}
                <Button size="sm" className="mt-2" variant={o.key === "mdm" ? "primary" : "secondary"} onClick={() => onDeploy(o.key)}>
                  {o.key === "mdm" ? <Building2 className="size-3.5" /> : <Play className="size-3.5" />}
                  {o.key === "mdm" ? "Push with MDM" : "Mark as set up"}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">Confirmed by: {HEARTBEAT[a.adapter]}</p>
        </div>
      )}

      {a && configuring && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold">Rolling out via {methodLabel}</span>
            <span className="font-mono text-[11px] text-fg-3">step {Math.min((conn?.phase ?? 0) + 1, 4)} of 4</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <motion.div className="h-full bg-allow" animate={{ width: `${((conn?.phase ?? 0) / 3) * 100}%` }} />
          </div>
          <div className="mt-2.5 space-y-1.5">
            {phaseLabels(conn?.method ?? "manual").map((lbl, i) => {
              const ph = conn?.phase ?? 0;
              const st = i < ph ? "done" : i === ph ? "active" : "pending";
              return (
                <div key={lbl} className="flex items-center gap-2 text-[12px]">
                  {st === "done" ? (
                    <CircleCheck className="size-3.5 text-allow" />
                  ) : st === "active" ? (
                    <Loader2 className="size-3.5 animate-spin text-fg-2" />
                  ) : (
                    <span className="grid size-3.5 place-items-center">
                      <span className="size-1.5 rounded-full bg-line-strong" />
                    </span>
                  )}
                  <span className={st === "pending" ? "text-fg-3" : ""}>{lbl}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {a && isConnected && (
        <div className="mt-3 rounded-lg border border-allow/40 bg-surface-2 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <CircleCheck className="size-4 text-allow" />
            <span className="font-medium">Checked in</span>
            <span className="font-mono text-[11.5px] text-fg-2">{d.id}@{conn?.device ?? "device"} · Wrapbox adapter {ADAPTER_VER}</span>
            <span className="ml-auto text-[11px] text-fg-3">{conn ? "just now" : "connected"}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-fg-3">{HEARTBEAT[a.adapter]}</p>
        </div>
      )}

      {a && (
        <div className="mt-3">
          <button onClick={() => setSetup((s) => !s)} className="text-[12px] font-medium text-fg-2 underline underline-offset-4 hover:text-fg">
            {setup ? "Hide setup details" : "View setup details"}
          </button>
        </div>
      )}

      {a && setup && (
        <div className="mt-2 space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
            <span>Deploy · {options.map((o) => o.label).join(" or ")}</span>
            {!!a.hookEvents.length && <span>Events · {a.hookEvents.join(", ")}</span>}
            {a.docs && !a.docs.includes(" ") && (
              <a href={`https://${a.docs}`} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-fg-2">
                Vendor documentation ↗
              </a>
            )}
          </div>
          {isSdk ? (
            <>
              <CodeBlock file="your agent · @wrapbox/sdk" note="real · covered by SDK tests" lang="ts" code={claimsSrc.replace(/^\/\*[\s\S]*?\*\/\n/, "")} maxH={260} />
              <CodeBlock file="same client · OpenAI · Anthropic · LangGraph" lang="ts" code={frameworksSrc.replace(/^\/\*[\s\S]*?\*\/\n/, "")} maxH={220} />
            </>
          ) : (
            <CodeBlock file={a.file} note={a.fileNote} lang={a.lang} code={a.snippet} maxH={240} />
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full h-10 rounded-xl border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-fg-3" />
    </label>
  );
}

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 pl-3 pr-1 h-9 min-w-0">
      <code className="flex-1 truncate font-mono text-[12px]">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

function ShareRow({ n, title, desc, children }: { n: number; title: string; desc: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-6 place-items-center rounded-full bg-ink text-ink-fg text-[11px] font-semibold shrink-0">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-[12px] text-fg-3 mb-2">{desc}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

function InviteEmail({ onAccept, accepted }: { onAccept?: () => void; accepted?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b border-line bg-surface-2 text-[12px] text-fg-2">
        <Mail className="size-3.5" /> Inbox · dev.k@wrapbox.ai
      </div>
      <div className="p-6">
        <div className="text-[12px] text-fg-3">From: Priya Menon via Wrapbox &lt;no-reply@wrapbox.ai&gt;</div>
        <div className="mt-1 text-[15px] font-semibold">Priya invited you to the Wrapbox workspace</div>
        <div className="mt-4 rounded-xl bg-nav p-5 text-white">
          <div className="flex items-center gap-2.5">
            <WrapboxLogo size={26} />
            <span style={{ fontFamily: "var(--font-brand)" }} className="text-[16px] font-bold">
              Wrapbox
            </span>
          </div>
          <p className="mt-3 text-[13px] text-white/80 leading-relaxed">Hi Dev — Wrapbox keeps the AI agents you use at work safe to run. Your agents keep working as they do today; Wrapbox only steps in when an action touches secrets, main, customer data or production.</p>
          <div className="mt-3 text-[12px] text-white/60">Your role: Developer · Approver (oncall-sre)</div>
          <button onClick={onAccept} className={cn("mt-4 h-9 rounded-lg px-4 text-[13px] font-semibold", accepted ? "bg-[#3fd49b] text-[#0f1b35]" : "bg-white text-[#0f1b35] hover:opacity-90")}>
            {accepted ? "✓ Invitation accepted" : "Accept invitation"}
          </button>
        </div>
        <p className="mt-3 text-[11.5px] text-fg-3">Setup takes about 3 minutes: sign in, run one command, done.</p>
      </div>
    </div>
  );
}

/* ================= Employee setup ================= */

const EMP_STEPS = [
  { t: "Invitation", s: "From your admin" },
  { t: "Sign in", s: "SSO, device check, passkey" },
  { t: "Install", s: "One command on your laptop" },
  { t: "What changes", s: "Rules in plain English" },
  { t: "Try it", s: "Real actions in Claude Code" },
  { t: "Approve from Slack", s: "You're on call" },
  { t: "You're set", s: "Your workspace" },
];

type TryKey = "test" | "env" | "force" | "delete";
interface TryDef {
  key: TryKey;
  prompt: string;
  tool: string;
  act: import("../lib/engine").Act;
  ok: string;
}
interface TryResult {
  key: TryKey;
  d: Decision | "UNGOVERNED";
  observed?: Decision;
  out: string[];
  how?: string;
}
const TRIES: TryDef[] = [
  { key: "test", prompt: "Run the unit tests", tool: "Bash(npm test)", act: { effect: "shell.exec", command: "npm test", env: "development" }, ok: "214 passed · 0 failed" },
  { key: "env", prompt: "Print the values in .env.production", tool: "Read(.env.production)", act: { effect: "filesystem.read", path: "/wrapbox/payments/.env.production", env: "development" }, ok: "DATABASE_URL=postgres://admin:••••@prod-db…  STRIPE_SECRET_KEY=••••" },
  { key: "force", prompt: "Force-push my ledger branch", tool: "Bash(git push --force origin feat/ledger)", act: { effect: "git.push", branch: "feat/ledger", command: "git push --force origin feat/ledger", env: "development" }, ok: "+ 3f9a2c1...b81e004 feat/ledger -> feat/ledger" },
  { key: "delete", prompt: "Delete the payments deployment in prod", tool: "Bash(kubectl delete deployment payments-api -n prod)", act: { effect: "shell.exec", command: "kubectl delete deployment payments-api -n prod", env: "production" }, ok: 'deployment.apps "payments-api" deleted' },
];
const CODING_LOCAL: { id: string; name: string; ver: string; file: string; logo: string }[] = [
  { id: "cursor", name: "Cursor", ver: "1.8.2", file: ".cursor/hooks.json (failClosed: true)", logo: "cursor" },
  { id: "claude-code", name: "Claude Code", ver: "2.1", file: "managed settings (PreToolUse, 90s)", logo: "claudecode" },
  { id: "codex-cli", name: "Codex CLI", ver: "0.153.4", file: "~/.codex/hooks.json", logo: "codex" },
  { id: "copilot-cli", name: "Copilot CLI", ver: "1.0", file: ".github/hooks/wrapbox.json", logo: "githubcopilot" },
];

export function EmployeeSetup() {
  const fresh = useStore((s) => s.workspace === "fresh");
  const connected = useStore((s) => s.connected);
  const members = useStore((s) => s.members);
  const version = useStore((s) => s.version);
  const ruleCount = useStore((s) => s.published.length);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const next = () => {
    setStep((s) => s + 1);
    setReached((r) => Math.max(r, step + 1));
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  };
  const back = () => setStep((s) => Math.max(0, s - 1));
  const [accepted, setAccepted] = useState(false);
  const [signed, setSigned] = useState(false);
  const [device, setDevice] = useState(0);
  const [passkey, setPasskey] = useState(false);
  const [installed, setInstalled] = useState(0);
  const [tried, setTried] = useState<TryResult[]>([]);
  const approval = useStore((s) => s.approvals.find((a) => a.id === "ap-cli-2"));
  const invitedByAdmin = members.some((m) => m.id === EMPLOYEE.id);

  // What the installer finds: the coding agents your admin has connected are enabled for you.
  const enabled = CODING_LOCAL.filter((a) => a.id !== "copilot-cli" && connected[a.id]);
  const installLines: { t: string; ok?: boolean; dim?: boolean; warn?: boolean }[] = [
    { t: "$ npx @wrapbox/cli install --all --org wrapbox" },
    { t: "✓ signed in as dev.k@wrapbox.ai (Okta)", ok: true },
    { t: "✓ device registered: dk-macbook-pro · key in Secure Enclave", ok: true },
    { t: "→ detecting agents on this machine…", dim: true },
    ...CODING_LOCAL.map((a) =>
      enabled.some((e) => e.id === a.id)
        ? { t: `  ${a.name} ${a.ver} ${".".repeat(Math.max(2, 16 - a.name.length - a.ver.length))} enabled for you → ${a.file}`, ok: true }
        : { t: `  ${a.name} ${a.ver} ${".".repeat(Math.max(2, 16 - a.name.length - a.ver.length))} not enabled by your admin → skipped`, warn: true },
    ),
    { t: "✓ endpoint runtime on · file · process · network", ok: true },
    { t: `✓ policy cache v${version} · ${ruleCount} rules · api.wrapbox.ai 38 ms`, ok: ruleCount > 0, warn: ruleCount === 0 },
    { t: enabled.length ? "Done in 6.2s. Your agents work exactly as before." : "Done. No agents are enabled for you yet — your admin connects them in Wrapbox.", dim: true },
  ];

  useEffect(() => {
    if (!signed) return;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setDevice(i);
      if (i >= 3) clearInterval(t);
    }, 380);
    return () => clearInterval(t);
  }, [signed]);

  // Arjun's Claude Code asks for a prod delete while Dev is on call — only if the contract says it needs a person.
  useEffect(() => {
    if (step !== 5) return;
    const st = getState();
    const existing = st.approvals.find((a) => a.id === "ap-cli-2");
    if (existing) return;
    const g = SCENARIOS.cli.gates[1];
    const v = evaluateNow(actOf(g), "claude-code");
    if (v.decision === "REVIEW" && st.connected["claude-code"]) ensurePending(SCENARIOS.cli, g, "claude-code", v);
  }, [step]);

  async function install() {
    for (let i = 1; i <= installLines.length; i++) {
      await sleep(i === 1 ? 200 : 330);
      setInstalled(i);
    }
    registerDevice(
      EMPLOYEE.id,
      enabled.map((a) => ({ name: a.name, logo: a.logo, state: "protected" as const, note: a.file })),
    );
    setState((s) => ({ allowed: { ...s.allowed, [EMPLOYEE.id]: Array.from(new Set([...(s.allowed[EMPLOYEE.id] ?? []), ...enabled.map((a) => a.id)])) } }));
  }

  function tryIt(t: TryDef) {
    if (tried.some((x) => x.key === t.key)) return;
    if (!getState().connected["claude-code"]) {
      setTried((x) => [...x, { key: t.key, d: "UNGOVERNED", out: [`⎿  ${t.ok}`], how: "Claude Code isn't connected to Wrapbox in this workspace, so the action ran and nobody saw it. Your admin connects it under Agents." }]);
      return;
    }
    const v = evaluateNow(t.act, "claude-code");
    const id = "try-" + t.key + "-" + Date.now().toString(36);
    const base = { agentId: "claude-code", human: EMPLOYEE.id, action: t.tool, effect: t.act.effect, rule: v.rule, reason: v.reason, latency: 2, env: t.act.env ?? "development", source: "flow" as const, observed: v.observed };
    let r: TryResult;
    if (v.decision === "BLOCK") {
      r = { key: t.key, d: "BLOCK", out: [`⎿  PreToolUse:${t.tool.startsWith("Read") ? "Read" : "Bash"} hook error: wrapbox: ${v.reason} (rule ${v.rule})`], how: t.key === "env" ? "How to get it done: `wrapbox secrets ref DATABASE_URL` gives the agent a handle, never the value." : "Blocked by your company's contract. Request an exception from My workspace if you really need it." };
      pushEvent({ ...base, decision: "BLOCK" });
    } else if (v.decision === "CONSTRAIN") {
      const rw = "git push --force-with-lease origin feat/ledger";
      r = { key: t.key, d: "CONSTRAIN", out: [`⎿  wrapbox rewrote the command (updatedInput): ${rw}`, `⎿  ${t.ok}`], how: "Allowed as a safer variant: --force-with-lease can't overwrite a teammate's commits." };
      pushEvent({ ...base, decision: "CONSTRAIN", rewritten: rw });
    } else if (v.decision === "REVIEW") {
      const approvers = resolveApprovers(v.approvers, EMPLOYEE.id);
      upsertApproval(approvalFrom({ gate: gateFromAct(id, t.tool, t.act, v), agentId: "claude-code", human: EMPLOYEE, intent: t.prompt, approvers, quorum: v.quorum, args: { ...t.act } }));
      r = { key: t.key, d: "REVIEW", out: [`⎿  ⏸ held by Wrapbox · routed to ${approvers.map((p) => p.name).join(" + ")}`], how: `You're on call, but you asked — so you can't approve it yourself. It's waiting in ${approvers[0]?.name.split(" ")[0]}'s approvals.` };
      pushEvent({ ...base, decision: "REVIEW" });
    } else {
      const risky = t.key !== "test";
      r = { key: t.key, d: "ALLOW", observed: v.observed, out: [`⎿  ✓ allowed in 2 ms · permit wbp_${id.slice(-4)}`, `⎿  ${t.ok}`], how: risky ? (v.observed ? `Observe mode: the contract would ${v.observed} this, but it's only logging for now.` : "Your contract has no rule for this, so it ran. Your admin can add one in the Intent contract.") : undefined };
      pushEvent({ ...base, decision: "ALLOW" });
    }
    setTried((x) => [...x, r]);
  }

  function finish() {
    markOnboarded("employee");
    setState({ role: "employee" });
    toast("You're set, Dev", "Your agents are protected. Nothing else to do.", "allow");
    go("/");
  }

  const total = EMP_STEPS.length;
  return (
    <SetupLayout who="employee" title="Join Wrapbox" steps={EMP_STEPS} step={step} reached={reached} onJump={setStep}>
      {step === 0 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <StepHead n={1} total={total} title="You've been invited" sub="Priya set up Wrapbox for the company and added you. Nothing about how you use Cursor, Claude Code or Codex changes — Wrapbox only steps in for risky actions." />
            <ul className="space-y-2 text-[13px] text-fg-2">
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> Edits, tests, builds, feature branches — allowed instantly</li>
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> Secrets, main, production, customer data — checked first</li>
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> Every block tells you why, and how to get the task done</li>
            </ul>
            <Footer onNext={next} disabled={!accepted} next="Continue" hint={accepted ? undefined : "Accept the invitation in the email"} />
          </Card>
          <div className="space-y-3">
            {fresh && !invitedByAdmin && (
              <div className="rounded-xl border border-review/40 bg-review-soft/60 px-3.5 py-2.5 text-[12.5px]">
                <b>Heads up:</b> in this fresh workspace Priya hasn't synced the directory yet. Accepting adds you as an invited member so you can walk through it.
              </div>
            )}
            <InviteEmail
              accepted={accepted}
              onAccept={() => {
                setAccepted(true);
                if (!getState().members.some((m) => m.id === EMPLOYEE.id)) setState((s) => ({ members: [...s.members, { id: EMPLOYEE.id, roles: ["Developer", "Approver · oncall-sre"], status: "invited" }] }));
              }}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <Card className="p-6">
          <StepHead n={2} total={total} title="Sign in and register your approval passkey" sub="You sign in with the company SSO. Because you're an approver (on-call), you also register a passkey — approvals are signed by your device, so nobody can approve as you from a script or a spoofed prompt." />
          <Button variant={signed ? "secondary" : "primary"} onClick={() => setSigned(true)} disabled={signed}>
            <Logo name="okta" size={18} rounded="rounded" /> {signed ? "Signed in as dev.k@wrapbox.ai" : "Continue with Okta"}
          </Button>
          {signed && (
            <div className="mt-4 space-y-2 rounded-xl border border-line p-4">
              <Tick on={device > 0}>macOS 15.6 · supported</Tick>
              {device > 0 && <Tick on={device > 1}>FileVault disk encryption on</Tick>}
              {device > 1 && <Tick on={device > 2}>Managed by Jamf · compliant</Tick>}
            </div>
          )}
          {device >= 3 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant={passkey ? "secondary" : "primary"}
                disabled={passkey}
                onClick={async () => {
                  const ok = await askPasskey({ person: EMPLOYEE, title: "Register this Mac as your approval device", detail: "Touch ID · the private key never leaves the Secure Enclave" });
                  if (ok) setPasskey(true);
                }}
              >
                <KeyRound className="size-3.5" /> {passkey ? "Passkey registered" : "Register passkey"}
              </Button>
              {passkey && <span className="text-[12.5px] text-allow">✓ This Mac can now sign your approvals</span>}
            </div>
          )}
          <Footer onBack={back} onNext={next} disabled={!passkey} />
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6">
          <StepHead n={3} total={total} title="Install on your laptop" sub="On a Jamf-managed Mac this already ran for you. On any other machine it's one command. It finds your agents and writes each one's native hook file." />
          <div className="rounded-xl bg-[#0a0e19] border border-[#1b2338] overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 h-9 border-b border-[#1b2338] text-[11.5px] text-[#8a95b3] font-mono">
              <TerminalIcon className="size-3.5" /> zsh — dk-macbook-pro
              {!installed && (
                <button onClick={install} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-white text-[#0f1b35] px-2.5 h-6 font-sans text-[12px] font-semibold">
                  <Play className="size-3 fill-current" /> Run
                </button>
              )}
            </div>
            <div className="p-4 font-mono text-[12.5px] leading-[1.75] min-h-[280px]">
              {!installed && <div className="text-white">$ npx @wrapbox/cli install --all --org wrapbox<span className="caret" /></div>}
              {installLines.slice(0, installed).map((l) => (
                <motion.div key={l.t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("whitespace-pre-wrap", l.ok ? "text-[#3fd49b]" : l.warn ? "text-[#f4b453]" : l.dim ? "text-[#7d879f]" : "text-white")}>
                  {l.t}
                </motion.div>
              ))}
            </div>
          </div>
          <Footer onBack={back} onNext={next} disabled={installed < installLines.length} />
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6">
          <StepHead n={4} total={total} title="What changes for you" sub="Set by your admin, written in plain English. You can always read them under “Rules for me”." />
          <div className="grid gap-5 lg:grid-cols-2">
            <ul className="space-y-2">
              {(
                [
                  ["BLOCK", "Reading .env files, keys or credentials"],
                  ["BLOCK", "Pushing or merging to main"],
                  ["BLOCK", "Sending credentials to unknown domains"],
                  ["CONSTRAIN", "Querying customer PII — masked automatically"],
                  ["CONSTRAIN", "git push --force — becomes --force-with-lease"],
                  ["REVIEW", "Deleting anything in production — on-call signs"],
                  ["ALLOW", "Everything else: edits, tests, builds, feature branches"],
                ] as const
              ).map(([d, t]) => (
                <li key={t} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-[13px]">
                  <DecisionPill d={d} size="sm" className="w-[84px] justify-center" /> {t}
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-[12.5px] space-y-3">
              <div className="text-[13px] font-semibold">Your privacy</div>
              <div>
                <div className="font-medium">Your admin sees</div>
                <div className="text-fg-2">Your agents' actions and decisions, laptop and hook health, your requests and approvals.</div>
              </div>
              <div>
                <div className="font-medium">Never collected</div>
                <div className="text-fg-2">Source code, file contents, chat history. Your prompt is attached only when an action needs someone's approval.</div>
              </div>
            </div>
          </div>
          <Footer onBack={back} onNext={next} />
        </Card>
      )}

      {step === 4 && (
        <Card className="p-6">
          <StepHead n={5} total={total} title="Try it in Claude Code" sub="Ask your agent for something. Every action goes through Wrapbox; watch what happens in the terminal. Try all four." />
          <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-2">
              {TRIES.map((t) => {
                const r = tried.find((x) => x.key === t.key);
                return (
                  <button key={t.key} onClick={() => tryIt(t)} className={cn("w-full rounded-xl border px-3 py-2.5 text-left transition-colors", r ? "border-line bg-surface-2" : "border-line hover:border-fg")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">“{t.prompt}”</span>
                      {r && (r.d === "UNGOVERNED" ? <Chip tone="block">ungoverned</Chip> : <span className="flex items-center gap-1"><DecisionPill d={r.d} size="sm" />{r.observed && <Chip tone="review">would {r.observed}</Chip>}</span>)}
                    </div>
                  </button>
                );
              })}
              <p className="px-1 text-[11.5px] text-fg-3">Decided by contract v{version} ({ruleCount} rules){fresh ? " — the one your admin published in this workspace." : "."}</p>
            </div>
            <div className="rounded-xl bg-[#0a0e19] border border-[#1b2338] overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 h-9 border-b border-[#1b2338] font-mono text-[11.5px] text-[#8a95b3]">
                <Logo name="claudecode" size={16} rounded="rounded" /> claude — ~/wrapbox/payments
                <span className="ml-auto inline-flex items-center gap-1 rounded bg-[#131a2e] px-1.5 py-0.5 text-[10px] text-[#9db4ff]">
                  <ShieldCheck className="size-3" /> wrapbox hook
                </span>
              </div>
              <div className="p-4 font-mono text-[12.5px] leading-[1.75] min-h-[300px] space-y-3">
                {!tried.length && <div className="text-[#5f6a88]">Pick a request on the left.</div>}
                {tried.map((r) => {
                  const t = { ...TRIES.find((x) => x.key === r.key)!, ...r };
                  return (
                    <motion.div key={r.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <div className="text-white font-semibold">{"> " + t.prompt}</div>
                      <div className="text-[#e7ebf6]">
                        <span className="text-[#d97757]">⏺ </span>
                        {t.tool}
                      </div>
                      {t.out.map((o) => (
                        <div key={o} className={t.d === "BLOCK" || t.d === "UNGOVERNED" ? "text-[#ff6e8a]" : t.d === "REVIEW" ? "text-[#f4b453]" : t.d === "CONSTRAIN" ? "text-[#a78bff]" : "text-[#3fd49b]"}>
                          {"  " + o}
                        </div>
                      ))}
                      {t.how && <div className="text-[#8a95b3] font-sans text-[12px] mt-1">{t.how}</div>}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
          <Footer onBack={back} onNext={next} disabled={tried.length < 2} hint={tried.length < 2 ? "Try at least two" : `${tried.length} of 4 tried · they're in your activity now`} />
        </Card>
      )}

      {step === 5 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <StepHead n={6} total={total} title="Approve from Slack" sub="You're in the oncall-sre approver group. When Arjun's Claude Code wants to delete a production deployment, you get this message. Approving signs the exact command with your passkey — the permit can't be reused for anything else." />
            <ul className="space-y-2 text-[13px] text-fg-2">
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> You see the command, the dry run and the rule — not a vague “agent wants to run a tool”.</li>
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> Your approval mints a permit bound to this command for 60 seconds.</li>
              <li className="flex gap-2"><CircleCheck className="size-4 text-allow shrink-0 mt-0.5" /> If the agent changes a single argument, the permit fails.</li>
            </ul>
            <Footer onBack={back} onNext={next} disabled={approval?.status === "pending" && approval.approvers.some((p) => p.id === EMPLOYEE.id)} hint={approval?.status === "pending" ? "Approve the request in Slack" : undefined} />
          </Card>
          <div className="space-y-3">
            {!approval ? (
              <div className="rounded-xl border border-line bg-surface p-5 text-[13px]">
                <div className="font-semibold">Nothing to approve right now</div>
                <p className="mt-1 text-fg-2 leading-relaxed">
                  {!connected["claude-code"]
                    ? "Claude Code isn't connected in this workspace yet, so Wrapbox never sees Arjun's actions. Your admin connects it under Agents."
                    : evaluateNow(actOf(SCENARIOS.cli.gates[1]), "claude-code").observed
                      ? "Your admin's contract is still in observe mode — Arjun's delete would only be logged (would REVIEW). Once the rule is enforced, requests like this land here."
                      : "Your contract doesn't require a person for production deletes, so Arjun's delete would just run. Ask your admin to add the Production infrastructure pack in the Intent contract."}
                </p>
              </div>
            ) : (
              <>
                <SlackCard
                  who={approval.approvers[0]?.name ?? "Dev Kapoor"}
                  title={`Claude Code needs approval for ${approval.human.name}`}
                  lines={[
                    ["Action", "kubectl delete deployment payments-api -n prod"],
                    ["Asked", `“${approval.intent}”`],
                    ["Rule", approval.rule],
                  ]}
                  done={approval.status === "approved" ? "approved" : approval.status === "rejected" ? "rejected" : undefined}
                  onApprove={() => (approval.approvers.some((p) => p.id === EMPLOYEE.id) ? approveWithPasskey(approval, EMPLOYEE) : toast("You're not an approver for this", `It's routed to ${approval.approvers.map((p) => p.name).join(", ")}`, "review"))}
                  onReject={() => toast("Try approving", "Rejecting works too — the agent gets your reason.")}
                />
                {!approval.approvers.some((p) => p.id === EMPLOYEE.id) && <div className="rounded-xl border border-review/40 bg-review-soft/60 p-3.5 text-[12.5px]">This request is routed to {approval.approvers.map((p) => p.name).join(", ")} — you're not in the approver group for it in this workspace.</div>}
                {approval.status === "approved" && (
                  <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-allow/40 bg-allow-soft/60 p-3.5 text-[12.5px]">
                    <b>Signed.</b> Wrapbox minted a one-time permit for exactly this command. Arjun's Claude Code hook is released and the delete runs once.
                  </motion.div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {step === 6 && (
        <Card className="p-6">
          <StepHead n={7} total={total} title="You're set" sub="That's all an employee ever does. From here, Wrapbox stays out of the way until an action needs it." />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["Your agents", "Cursor, Claude Code and Codex are protected on dk-macbook-pro."],
              ["Your activity", "Every decision, with a plain-language reason and a way forward."],
              ["Your approvals", "On-call requests arrive in Slack; sign with your passkey."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line p-4">
                <div className="text-[13.5px] font-semibold">{t}</div>
                <div className="mt-1 text-[12.5px] text-fg-2">{d}</div>
              </div>
            ))}
          </div>
          <Footer onBack={back} onNext={finish} next="Open my workspace" />
        </Card>
      )}
    </SetupLayout>
  );
}
