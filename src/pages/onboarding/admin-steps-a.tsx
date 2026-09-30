// Admin onboarding — Steps 1–4: Create workspace → Discover agents → Intent
// contract → Connect & roll out. Each step commits to the real store at its
// commit point, so every other page reflects what the admin actually did.
//
// Real here: the workspace signing key (WebCrypto ECDSA P-256), the agent
// registry the scan reports, the contract publish + activation guard
// (canActivate), the drafter, clause coverage, and the status each rollout
// target can reach (Capability Registry). Simulated: SSO sign-in, the GitHub
// App install + repo scan, and the MDM / gateway rollout itself.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  useAppState, getState, setOrg, setOnboarding, publishRecommendedContracts,
  upsertContract, setContractStatus, type Idp, type Region,
} from "../../state/store";
import { ROLLOUT, rolloutStatus, type AgentKind, type RolloutTarget } from "../../model/rollout";
import { AGENTS, RESOURCES, userById, type OrgAgent } from "../../model/org";
import { SEED_CONTRACTS } from "../../model/contracts";
import { CAPABILITIES } from "../../model/registries";
import type { ContractClause, IntentContract } from "../../model/types";
import { draftClauses } from "../../engine/drafter";
import { canActivate, clauseCoverage, contractCoverage, coverageOf, destinationText } from "../../engine/coverage";
import { StepHead, StepFooter, Tick, Choice, Segmented, Modal, sleep } from "../../ui/setup";
import { Avatar, AgentMark, Chip, StatusChip, DecisionChip, SimNote, Progress } from "../../ui/kit";
import { logoUrl } from "../../ui/logos";
import type { AdminStepProps } from "./types";
import {
  Check, ShieldCheck, PenLine, Lock, X, Info, Globe, FileCode2, Sparkles, KeyRound,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Dark is the default theme; light is the opt-in `data-theme="light"` (App.tsx removes the attribute for dark). */
const isLight = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
/** GitHub's mark comes in a dark and a light variant. A `.logo-img` sits on a white chip in the dark
 *  theme (app.css) and on the light surface otherwise, so the dark mark reads in both themes. */
const ghMark = () => "github_light";
/** On the primary button the background inverts with the theme (white pill on dark, ink on light),
 *  and the `.logo-img` chip is white on dark — so the mark must be dark on dark, white on light. */
const ghOnInk = () => (isLight() ? "github_dark" : "github_light");

function Logo({ name, size = 18 }: { name: string; size?: number }) {
  return <img src={logoUrl(name === "github_light" ? ghMark() : name)} alt="" className="logo-img" style={{ width: size, height: size }} />;
}

function Bar({ value }: { value: number }) {
  return <div style={{ flex: 1 }}><Progress value={value} size="sm" /></div>;
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18, height: 18, borderRadius: 5, display: "grid", placeItems: "center", flexShrink: 0,
        border: `1px solid ${on ? "var(--ink)" : "var(--line-strong)"}`,
        background: on ? "var(--ink)" : "transparent", color: "var(--ink-fg)",
      }}
    >
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

const inset: CSSProperties = {
  background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "12px 14px",
};

/** Keeps async sequences from writing after the step has been left. */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

const ADMIN = userById("u-priya");
const ADMIN_LOCAL = ADMIN?.email.split("@")[0] ?? "admin";

// The agent kinds, in the order Step 2 and Step 4 present them.
const KIND_META: Record<AgentKind, { label: string; sub: string }> = {
  coding: { label: "Coding agents", sub: "CLI and IDE agents that read, write and run code" },
  chat: { label: "AI chat & assistants", sub: "Chat apps people paste work into" },
  copilot: { label: "Enterprise copilots", sub: "Copilots inside your productivity suite" },
  internal: { label: "Your own agents", sub: "Agents your teams built and run" },
  browser: { label: "Browser agents", sub: "Agents that click, fill and submit in the browser" },
  hosted: { label: "Hosted agents", sub: "Agents running on AWS AgentCore and similar platforms" },
  supplier: { label: "Supplier agents", sub: "Agents your suppliers run inside your systems" },
  unknown: { label: "Unregistered & MCP", sub: "Agents and MCP servers nobody registered" },
};
const KIND_ORDER: AgentKind[] = ["coding", "chat", "copilot", "internal", "browser", "hosted", "supplier", "unknown"];
const KINDS_PRESENT: AgentKind[] = KIND_ORDER.filter((k) => AGENTS.some((a) => a.kind === k));
const sortKinds = (ks: AgentKind[]) => KIND_ORDER.filter((k) => ks.includes(k));

// ---------------------------------------------------------------------------
// STEP 1 — Create your workspace
// ---------------------------------------------------------------------------

const IDPS: { idp: Exclude<Idp, "">; label: string; logo: string }[] = [
  { idp: "Google Workspace", label: "Continue with Google", logo: "google" },
  { idp: "Microsoft Entra ID", label: "Continue with Microsoft", logo: "microsoft" },
  { idp: "Okta", label: "Continue with Okta", logo: "okta" },
];
const REGIONS: { value: Region; label: string; flag: string; cloud: string }[] = [
  { value: "us", label: "United States", flag: "flag-us", cloud: "us-east-1" },
  { value: "eu", label: "European Union", flag: "flag-eu", cloud: "eu-central-1" },
  { value: "in", label: "India", flag: "flag-in", cloud: "ap-south-1" },
];
const regionOf = (r: Region) => REGIONS.find((x) => x.value === r) ?? REGIONS[0];
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const hasWebCrypto = () => typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;
const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** Generate the workspace signing key for real and return its thumbprint:
 *  SHA-256 of the raw (uncompressed) P-256 public key, first 16 hex chars. */
async function makeSigningKey(): Promise<{ thumb: string; real: boolean }> {
  if (hasWebCrypto()) {
    try {
      const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
      const digest = await crypto.subtle.digest("SHA-256", raw);
      return { thumb: toHex(digest).slice(0, 16), real: true };
    } catch { /* fall through to the labelled placeholder */ }
  }
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return { thumb: toHex(bytes), real: false };
}

export function Step1Workspace(p: AdminStepProps) {
  const s = useAppState();
  const alive = useAlive();
  const d = p.draft;
  const [stage, setStage] = useState(0); // ticks revealed during provisioning (0..4)
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState("");
  const [realKey, setRealKey] = useState(hasWebCrypto());

  const company = d.company;
  const domain = d.domain.trim().toLowerCase();
  const companyOk = company.trim().length > 0;
  const domainOk = DOMAIN_RE.test(domain);
  const idpOk = d.idp !== "";
  const valid = companyOk && domainOk && idpOk;

  // The store is the truth for "was this workspace created" (the draft can be
  // stale, e.g. after the workspace is started over). Resume shows the four
  // ticks with the stored key.
  const provisioned = !!s.org.keyThumb;
  const shownStage = provisioned ? 4 : stage;
  const shownThumb = provisioned ? s.org.keyThumb ?? thumb : thumb;
  const shownRegion = provisioned ? s.org.region : d.region;
  const shownCompany = provisioned ? s.org.company : company.trim();
  useEffect(() => {
    if (provisioned !== d.provisioned) p.setDraft({ provisioned });
  }, [provisioned, d.provisioned]); // eslint-disable-line react-hooks/exhaustive-deps
  // Workspace started over while this step is open: clear the finished reveal.
  useEffect(() => {
    if (!provisioned) { setStage(0); setThumb(""); }
  }, [provisioned]);

  async function provision() {
    if (!valid || busy) return;
    setBusy(true);
    setStage(1);
    const key = await makeSigningKey();
    if (!alive.current) return;
    setThumb(key.thumb);
    setRealKey(key.real);
    for (let i = 2; i <= 4; i++) {
      await sleep(450);
      if (!alive.current) return;
      setStage(i);
    }
    await sleep(450);
    if (!alive.current) return;
    setOrg({ company: company.trim(), domain, region: d.region, idp: d.idp, keyThumb: key.thumb, createdAt: Date.now() });
    p.setDraft({ provisioned: true, company: company.trim(), domain });
    setBusy(false);
  }

  function proceed() {
    if (!valid) return;
    // Name, domain and identity provider can change after creation; the data region cannot.
    if (s.org.company !== company.trim() || s.org.domain !== domain || s.org.idp !== d.idp) {
      setOrg({ company: company.trim(), domain, idp: d.idp });
    }
    p.next();
  }

  const hint = !idpOk ? "Choose an identity provider first"
    : !companyOk ? "Enter your company name"
    : !domainOk ? "Enter a valid email domain, like acme.com"
    : busy ? "Creating your workspace…"
    : undefined;

  return (
    <div className="card" style={{ padding: "24px 26px" }}>
      <StepHead
        n={p.n} total={p.total} title="Create your workspace"
        sub="Sign in with your company identity provider so every agent action is tied to a real person. Everyone you invite later signs in the same way."
      />

      <div className="field-label" style={{ marginBottom: 8 }}>Identity provider</div>
      <div className="grid g3" style={{ gap: 10 }}>
        {IDPS.map((x) => (
          <Choice key={x.idp} selected={d.idp === x.idp} onClick={() => p.setDraft({ idp: x.idp })} disabled={busy}>
            <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
              <Logo name={x.logo} size={22} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{x.label}</span>
                <span className="small faint" style={{ display: "block" }}>{x.idp}</span>
              </span>
              {d.idp === x.idp && <Check size={16} style={{ color: "var(--allow)", flexShrink: 0 }} />}
            </span>
          </Choice>
        ))}
      </div>

      {idpOk && (
        <div className="row" style={{ ...inset, marginTop: 12, gap: 10, fontSize: 13 }}>
          <Avatar userId="u-priya" size={24} />
          <span>
            Signed in as <b>{ADMIN_LOCAL}@{domainOk ? domain : "…"}</b> via {d.idp} · MFA verified
          </span>
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 20, gap: 16 }}>
        <div className="field">
          <label className="field-label" htmlFor="ob-company">Company name</label>
          <input id="ob-company" className="input" value={company} disabled={busy} onChange={(e) => p.setDraft({ company: e.target.value })} placeholder="Acme Corp" />
          {!companyOk && <span className="small" style={{ color: "var(--block)" }}>Company name is required.</span>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ob-domain">Email domain · auto-join for SSO users</label>
          <input id="ob-domain" className="input mono" value={d.domain} disabled={busy} onChange={(e) => p.setDraft({ domain: e.target.value })} placeholder="acme.com" spellCheck={false} />
          {!domainOk && <span className="small" style={{ color: "var(--block)" }}>Use a domain like acme.com — letters, digits and hyphens, with at least one dot.</span>}
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <span className="field-label">Data region · where decisions and evidence are stored</span>
        {provisioned ? (
          <div className="row small" style={{ gap: 8 }}>
            <Logo name={regionOf(shownRegion).flag} size={16} />
            <b>{regionOf(shownRegion).label}</b>
            <span className="faint mono">{regionOf(shownRegion).cloud}</span>
            <span className="faint">· fixed once the workspace is created — evidence already lives here</span>
          </div>
        ) : (
          <div>
            <Segmented<Region>
              value={d.region}
              onChange={(v) => { if (!busy) p.setDraft({ region: v }); }}
              options={REGIONS.map((r) => ({
                value: r.value,
                label: <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><Logo name={r.flag} size={14} />{r.label}</span>,
              }))}
            />
          </div>
        )}
      </div>

      {shownStage > 0 && (
        <div style={{ ...inset, marginTop: 20, background: "var(--surface)" }}>
          <Tick done={shownStage > 1}>
            Workspace “{shownCompany}” created · <span className="mono">{regionOf(shownRegion).cloud}</span>
          </Tick>
          {shownStage > 1 && (
            <Tick done={shownStage > 2}>
              {realKey ? (
                <>Signing key generated · ECDSA P-256 · thumbprint <span className="mono">{shownThumb}</span></>
              ) : (
                <>
                  <span style={{ color: "var(--review)" }}>No signing key — this browser has no WebCrypto (it needs HTTPS or localhost).</span>{" "}
                  Placeholder thumbprint <span className="mono">{shownThumb}</span>, not a real key
                </>
              )}
            </Tick>
          )}
          {shownStage > 2 && <Tick done={shownStage > 3}>Policy engine ready · deterministic decisions</Tick>}
          {shownStage > 3 && <Tick done={provisioned}>Hash-chained evidence log opened</Tick>}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <SimNote>Simulated sign-in — the signing key is real, generated in your browser.</SimNote>
      </div>

      <StepFooter
        onBack={p.back}
        onNext={provisioned ? proceed : provision}
        nextLabel={provisioned ? "Continue" : busy ? "Creating…" : "Create workspace"}
        disabled={!valid}
        busy={busy}
        hint={hint}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEP 2 — Discover the agents you already run
// ---------------------------------------------------------------------------

// What a read-only GitHub App sees: the small config files agents leave in a
// repo. Paths follow each vendor's documented project config:
//   Claude Code  .claude/settings.json and .mcp.json (project-scoped MCP servers)
//   Codex        .codex/config.toml (project config, trusted projects)
//   Microsoft 365 Copilot  appPackage/declarativeAgent.json (Agents Toolkit declarative agent)
// Internal agents use this org's own convention. Every hit names an agent in
// the org's registry — the scan never invents an agent.
interface Hit { agentId: string; path: string; note?: string }
interface RepoLine { repo: string; hits: Hit[] }
const HIT_REPOS: RepoLine[] = ([
  { repo: "checkout-service", hits: [{ agentId: "a-claude-code", path: ".claude/settings.json" }, { agentId: "a-codex", path: ".codex/config.toml" }] },
  { repo: "payments-api", hits: [{ agentId: "a-claude-code", path: ".claude/settings.json" }] },
  { repo: "finance-reporting", hits: [{ agentId: "a-finance", path: "agents/finance/agent.yaml" }] },
  { repo: "support-platform", hits: [{ agentId: "a-support", path: "services/support-bot/agent.yaml" }] },
  { repo: "m365-extensions", hits: [{ agentId: "a-copilot", path: "appPackage/declarativeAgent.json" }] },
  { repo: "ledger", hits: [{ agentId: "a-codex", path: ".codex/config.toml" }] },
  { repo: "ops-scripts", hits: [{ agentId: "a-unknown-mcp", path: ".mcp.json", note: "server on tcp/7823 · not in your registry" }] },
] as RepoLine[])
  .map((r) => ({ ...r, hits: r.hits.filter((h) => AGENTS.some((a) => a.id === h.agentId)) }))
  .filter((r) => r.hits.length > 0);

const CLEAN_NAMES = [
  "web-app", "design-system", "docs-site", "infra-terraform", "helm-charts", "k8s-manifests", "api-gateway",
  "auth-service", "notification-svc", "search-index", "analytics-dbt", "data-pipelines", "feature-flags",
  "load-tests", "sdk-js", "sdk-python", "status-page", "email-templates", "pricing-page", "grafana-dashboards",
  "runbooks", "webhooks", "image-proxy", "pdf-service", "cron-jobs", "legacy-billing", "sandbox", "eslint-config",
  "brand-assets", "archive-2023", "admin-portal", "partner-api", "qa-fixtures", "mobile-ios", "mobile-android",
];
// Repository count comes from the org's GitHub resource ("… · 38 repos").
const GH_RESOURCE = RESOURCES.find((r) => r.id === "r-github");
const ORG_REPOS = Math.max(HIT_REPOS.length, Number(GH_RESOURCE?.detail.match(/(\d+)\s+repos?\b/)?.[1] ?? 0));

/** Walk order the crawler uses: each repo with agent config, then a couple without. */
function orgScanOrder(): RepoLine[] {
  const cleanCount = ORG_REPOS - HIT_REPOS.length;
  const clean = Array.from({ length: cleanCount }, (_, i) => CLEAN_NAMES[i] ?? `service-${i + 1}`);
  const order: RepoLine[] = [];
  HIT_REPOS.forEach((h, i) => {
    order.push(h);
    for (let k = 0; k < 2 && clean.length; k++) order.push({ repo: clean.shift()!, hits: [] });
    if (i === HIT_REPOS.length - 1) while (clean.length) order.push({ repo: clean.shift()!, hits: [] });
  });
  return order;
}
const ORG_ORDER = orgScanOrder();

const agentsFoundIn = (lines: RepoLine[]): OrgAgent[] => {
  const ids = new Set(lines.flatMap((l) => l.hits.map((h) => h.agentId)));
  return AGENTS.filter((a) => ids.has(a.id));
};
const hitsFor = (agentId: string, lines: RepoLine[]) =>
  lines.flatMap((l) => l.hits.filter((h) => h.agentId === agentId).map((h) => ({ repo: l.repo, ...h })));

type Account = "org" | "personal";

function GitHubInstall({ orgHandle, personalHandle, onClose, onDone }: {
  orgHandle: string; personalHandle: string; onClose: () => void; onDone: (a: Account) => void;
}) {
  const alive = useAlive();
  const [screen, setScreen] = useState<"account" | "permissions" | "working">("account");
  const [account, setAccount] = useState<Account | null>(null);
  const [phase, setPhase] = useState(0);
  const name = account === "personal" ? personalHandle : orgHandle;
  const repos = account === "personal" ? 3 : ORG_REPOS;
  const lines = [
    "Redirecting to github.com/apps/wrapbox/installations/new",
    `Installing the App on ${name}`,
    "Exchanging the installation access token",
    `Listing repositories · ${repos} found`,
  ];

  async function install() {
    setScreen("working");
    for (let i = 1; i <= lines.length; i++) {
      await sleep(650);
      if (!alive.current) return;
      setPhase(i);
    }
    await sleep(350);
    if (!alive.current || !account) return;
    onDone(account);
  }

  // A personal account has no organization members, so that permission is only requested for the org.
  const PERMS: [string, string][] = [
    ["Metadata", "Read — repository names, sizes and visibility"],
    ["Contents", "Read — Wrapbox fetches only agent config paths (.claude/, .codex/, .mcp.json, agent.yaml …)"],
    ...(account === "org" ? [["Members", "Read — who belongs to the organization"] as [string, string]] : []),
  ];

  return (
    <Modal onClose={screen === "working" ? () => {} : onClose} width={520}>
      <div className="row" style={{ gap: 10, padding: "13px 18px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", flexWrap: "nowrap" }}>
        <Logo name="github_light" size={22} />
        <b style={{ fontSize: 13.5 }}>Install Wrapbox</b>
        <span className="small faint">· github.com</span>
        {screen !== "working" && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Cancel install"><X size={14} /></button>
        )}
      </div>

      {screen === "account" && (
        <div style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Install Wrapbox on your account</div>
          <p className="small dim" style={{ margin: "4px 0 14px" }}>Wrapbox wants to see which AI agents your repositories use.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {([
              { id: "org" as Account, label: orgHandle, sub: `Organization · ${ORG_REPOS} repositories` },
              { id: "personal" as Account, label: personalHandle, sub: "Personal account · 3 repositories" },
            ]).map((a) => (
              <Choice key={a.id} selected={account === a.id} onClick={() => setAccount(a.id)}>
                <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
                  <span style={{
                    width: 32, height: 32, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 700, fontSize: 13,
                    borderRadius: a.id === "org" ? 7 : 999, background: "var(--ink)", color: "var(--ink-fg)",
                  }}>{a.label[0]?.toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="mono" style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{a.label}</span>
                    <span className="small faint" style={{ display: "block" }}>{a.sub}</span>
                  </span>
                </span>
              </Choice>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-good" disabled={!account} onClick={() => setScreen("permissions")}>Continue</button>
          </div>
        </div>
      )}

      {screen === "permissions" && (
        <div style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Install on <span className="mono">{name}</span></div>
          <div className="small" style={{ fontWeight: 600, marginTop: 14 }}>Repository access</div>
          <div className="small dim" style={{ marginTop: 4 }}>All repositories · all {repos} current and future repositories</div>
          <div className="small" style={{ fontWeight: 600, marginTop: 14 }}>Wrapbox will have permission to:</div>
          <div style={{ ...inset, background: "var(--surface)", marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {PERMS.map(([t, sub]) => (
              <div key={t} className="row small" style={{ gap: 9, flexWrap: "nowrap", alignItems: "flex-start" }}>
                <Check size={14} strokeWidth={3} style={{ color: "var(--allow)", flexShrink: 0, marginTop: 2 }} />
                <span><b>{t}</b> <span className="faint">· {sub}</span></span>
              </div>
            ))}
            <div className="row small faint" style={{ gap: 9, flexWrap: "nowrap" }}>
              <Lock size={14} style={{ flexShrink: 0 }} /> No write access. Source code is never uploaded.
            </div>
          </div>
          <div className="spread" style={{ marginTop: 18 }}>
            <button className="btn" onClick={() => setScreen("account")}>Back</button>
            <button className="btn btn-good" onClick={install}>Install &amp; Authorize</button>
          </div>
        </div>
      )}

      {screen === "working" && (
        <div style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Authorizing on github.com…</div>
          {lines.slice(0, Math.min(lines.length, phase + 1)).map((t, i) => <Tick key={t} done={phase > i}>{t}</Tick>)}
        </div>
      )}
    </Modal>
  );
}

export function Step2Discover(p: AdminStepProps) {
  const s = useAppState();
  const alive = useAlive();
  const draftRef = useRef(p.draft);
  draftRef.current = p.draft;

  const orgHandle = (p.draft.domain || s.org.domain || "company").split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-") || "company";
  const personalHandle = (ADMIN?.name ?? "admin").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const personalOrder: RepoLine[] = ["dotfiles", `${personalHandle}.github.io`, "notes"].map((repo) => ({ repo, hits: [] }));

  const [modal, setModal] = useState(false);
  const [account, setAccount] = useState<Account>("org");
  const order = account === "personal" ? personalOrder : ORG_ORDER;
  const [scan, setScan] = useState<"idle" | "scanning" | "done">(p.draft.scanned ? "done" : "idle");
  const [count, setCount] = useState(p.draft.scanned ? ORG_ORDER.length : 0);
  const scannedLines = order.slice(0, count);
  const log = scannedLines.slice(-10);

  const found = agentsFoundIn(scannedLines);
  const foundKinds = new Set(found.map((a) => a.kind));
  const hitRepoCount = scannedLines.filter((l) => l.hits.length > 0).length;
  const notInRepos = AGENTS.filter((a) => !HIT_REPOS.some((r) => r.hits.some((h) => h.agentId === a.id)));
  const browserTarget = ROLLOUT.find((t) => t.governs.includes("chat"));
  const guarded = (k: AgentKind) => ROLLOUT.some((t) => s.onboarding.connected.includes(t.id) && t.governs.includes(k));
  const cats = p.draft.categories;

  async function runScan() {
    if (scan === "scanning") return;
    setScan("scanning");
    setCount(0);
    for (let i = 0; i < order.length; i++) {
      await sleep(order[i].hits.length ? 150 : 55);
      if (!alive.current) return;
      setCount(i + 1);
    }
    await sleep(350);
    if (!alive.current) return;
    setScan("done");
    // Pre-select what the scan actually found, keeping anything already ticked.
    const kinds = [...new Set(agentsFoundIn(order).map((a) => a.kind))];
    p.setDraft({ scanned: true, categories: sortKinds([...new Set([...draftRef.current.categories, ...kinds])]) });
  }

  const toggle = (k: AgentKind) =>
    p.setDraft({ categories: cats.includes(k) ? cats.filter((x) => x !== k) : sortKinds([...cats, k]) });

  const handle = account === "personal" ? personalHandle : orgHandle;
  const total = order.length;

  return (
    <div className="card" style={{ padding: "24px 26px" }}>
      <StepHead
        n={p.n} total={p.total} title="Discover the agents you already run"
        sub="Connect GitHub and Wrapbox reads only the small config files agents leave behind — never your source code — so you can see every agent in use before you govern anything."
      />

      {!p.draft.ghConnected ? (
        <div style={inset}>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn btn-primary" onClick={() => setModal(true)}>
              <img src={logoUrl(ghOnInk())} alt="" className="logo-img" style={{ width: 16, height: 16 }} /> Connect GitHub
            </button>
            <span className="small faint">Read-only GitHub App · nothing is connected yet</span>
          </div>
          <p className="small dim" style={{ margin: "10px 0 0", maxWidth: "70ch" }}>
            No GitHub? Skip it and tick the platforms yourself below — the scan only saves you guessing.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", overflow: "hidden" }}>
          <div className="row" style={{ gap: 12, padding: "12px 16px", background: "var(--surface-2)" }}>
            <Logo name="github_light" size={20} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                <span className="mono">github.com/{handle}</span> <span className="faint" style={{ fontWeight: 400 }}>· connected</span>
              </div>
              <div className="small faint">{total} repositories · read-only · installed by you</div>
            </div>
            <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
              {account === "personal" && scan !== "scanning" && (
                <button className="btn btn-sm btn-ghost" onClick={() => setModal(true)}>Install on {orgHandle} instead</button>
              )}
              <button className={`btn ${scan === "done" ? "" : "btn-primary"}`} disabled={scan === "scanning"} onClick={runScan}>
                {scan === "idle" ? `Scan ${total} repositories` : scan === "scanning" ? `Scanning ${count}/${total}…` : "Scan again"}
              </button>
            </span>
          </div>

          {scan !== "idle" && (
            <div className="grid g2" style={{ padding: 16, gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Reading config files</div>
                <div className="term" style={{ minHeight: 0, height: 262, overflow: "hidden", padding: "12px 14px", fontSize: 11.5, lineHeight: 1.75, whiteSpace: "normal" }}>
                  <div className="term-chrome"><i /><i /><i /></div>
                  {log.map((r) => (
                    <div key={r.repo} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span className="faint">{handle}/</span>{r.repo}
                      {r.hits.length > 0 ? r.hits.map((h) => (
                        <span key={h.path + h.agentId} style={{ color: "var(--allow)", marginLeft: 8 }}>+ {h.path}</span>
                      )) : <span className="faint" style={{ marginLeft: 8 }}>no agent config</span>}
                    </div>
                  ))}
                  {scan === "scanning" && <div className="dim">…</div>}
                </div>
                <div className="row small faint" style={{ marginTop: 8, gap: 10, flexWrap: "nowrap" }}>
                  <span className="tnum" style={{ flexShrink: 0 }}>{count}/{total} repositories</span>
                  <Bar value={total ? count / total : 0} />
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  {scan === "done"
                    ? `${found.length} agent${found.length === 1 ? "" : "s"} found in ${hitRepoCount} of ${total} repositories`
                    : "Agents found so far"}
                </div>
                {found.length === 0 ? (
                  <div className="small faint" style={{ ...inset, background: "var(--surface)" }}>
                    {scan === "done"
                      ? account === "personal"
                        ? `No agent config in ${handle}'s ${total} personal repositories. Your company's agents live in the ${orgHandle} organization.`
                        : "No agent config found."
                      : "Nothing yet…"}
                  </div>
                ) : (
                  <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", maxHeight: 300, overflowY: "auto" }}>
                    {found.map((a, i) => {
                      const hits = hitsFor(a.id, scannedLines);
                      const repos = new Set(hits.map((h) => h.repo)).size;
                      return (
                        <div key={a.id} className="row" style={{ gap: 10, padding: "10px 12px", flexWrap: "nowrap", alignItems: "flex-start", borderTop: i ? "1px solid var(--line)" : "none" }}>
                          <AgentMark agentId={a.id} size={22} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="row" style={{ gap: 6 }}>
                              <b style={{ fontSize: 13 }}>{a.name}</b>
                              <span className="small faint">{a.provider} · {KIND_META[a.kind].label}</span>
                            </div>
                            <div className="mono faint" style={{ fontSize: 11, marginTop: 2, overflowWrap: "anywhere" }}>
                              {[...new Set(hits.map((h) => h.path))].join(" · ")}
                              {hits.find((h) => h.note) && <span style={{ color: "var(--review)" }}> — {hits.find((h) => h.note)!.note}</span>}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            {guarded(a.kind) ? <Chip tone="allow">guard connected</Chip> : <Chip tone="review">ungoverned</Chip>}
                            <div className="small faint tnum" style={{ marginTop: 4 }}>{repos} repo{repos === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {scan === "done" && notInRepos.length > 0 && (
                  <div style={{ ...inset, marginTop: 12 }}>
                    <div className="row small" style={{ gap: 7, fontWeight: 600 }}>
                      <Globe size={14} /> Not visible from repos
                    </div>
                    <div className="row" style={{ gap: 12, marginTop: 8 }}>
                      {notInRepos.map((a) => (
                        <span key={a.id} className="row small" style={{ gap: 6 }}>
                          <AgentMark agentId={a.id} size={18} /> {a.name} <span className="faint">· {a.provider}</span>
                        </span>
                      ))}
                    </div>
                    <div className="small faint" style={{ marginTop: 8 }}>
                      {notInRepos.every((a) => a.kind === "chat") ? "Used in the browser" : "These run outside your repositories"}
                      {browserTarget ? <> — the {browserTarget.name} (Step 4) will see them.</> : "."} A repo scan can't find them.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <b style={{ fontSize: 13.5 }}>Platforms to govern</b>
          {scan === "done" && foundKinds.size > 0 && <Chip tone="allow">pre-selected from your scan</Chip>}
        </div>
        <div className="grid g3" style={{ gap: 10 }}>
          {KINDS_PRESENT.map((k) => {
            const on = cats.includes(k);
            const agents = AGENTS.filter((a) => a.kind === k);
            return (
              <Choice key={k} selected={on} onClick={() => toggle(k)}>
                <div className="spread" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <span className="row" style={{ gap: 5 }}>
                    {agents.map((a) => <AgentMark key={a.id} agentId={a.id} size={20} />)}
                  </span>
                  <Box on={on} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 10 }}>{KIND_META[k].label}</div>
                <div className="small faint" style={{ marginTop: 2 }}>{agents.map((a) => a.name).join(" · ")}</div>
                {scan === "done" && foundKinds.has(k) && (
                  <div className="small" style={{ color: "var(--allow)", fontWeight: 600, marginTop: 6 }}>found in your repos</div>
                )}
              </Choice>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <SimNote>Simulated GitHub App install and repo scan — the agents it reports are your real agent registry.</SimNote>
      </div>

      <StepFooter
        onBack={p.back}
        onNext={() => { setOnboarding({ categories: sortKinds(cats) }); p.setDraft({ categories: sortKinds(cats) }); p.next(); }}
        disabled={cats.length === 0 || scan === "scanning"}
        hint={cats.length ? `${cats.length} of ${KINDS_PRESENT.length} platform types selected` : "Scan GitHub or tick a platform to continue"}
      />

      {modal && (
        <GitHubInstall
          orgHandle={orgHandle}
          personalHandle={personalHandle}
          onClose={() => setModal(false)}
          onDone={(a) => {
            setAccount(a);
            setScan("idle");
            setCount(0);
            setModal(false);
            p.setDraft({ ghConnected: true, scanned: false });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEP 3 — Write your intent contract
// ---------------------------------------------------------------------------

const MY_ID = "ic-my-first-rules";
const MY_NAME = "My first rules";
const SEED_RULES = SEED_CONTRACTS.reduce((n, c) => n + c.clauses.length, 0);
// Examples the deterministic drafter compiles faithfully (each names its data, action and destination).
const EXAMPLES = [
  "Customer emails must be tokenized before they are sent to external AI.",
  "Source code shared with external AI requires review.",
  "Agents must never read secrets like API keys or passwords.",
];
const norm = (t: string) => t.trim().toLowerCase().replace(/\.$/, "");

/** Skills a set of clauses needs that Wrapbox can't deliver yet (why a contract stays a draft). */
function missingSkills(clauses: ContractClause[]): string[] {
  const ids = [...new Set(clauses.flatMap((cl) => cl.requiredCapabilities))];
  return ids.filter((id) => coverageOf([id]) === "PENDING").map((id) => CAPABILITIES.find((c) => c.id === id)?.label ?? id);
}

/** A clause that names no data, destination or environment applies to every
 *  matching action by every agent. The drafter produces one when it can't
 *  recognise what a sentence is about — publishing it would be a false rule. */
function tooBroad(cl: ContractClause): string | null {
  if (cl.dataClasses.length > 0 || cl.destinations !== "ANY" || (cl.environments?.length ?? 0) > 0) return null;
  if (cl.effect === "ALLOW" && cl.actions !== "ANY") return null;
  const what = cl.actions === "ANY" ? "every action" : `every ${cl.actions.map((a) => a.toLowerCase().replace("_", " ")).join(" / ")}`;
  return cl.effect === "ALLOW"
    ? "Wrapbox couldn't tell what this sentence is about, so it doesn't restrict anything."
    : `Wrapbox found no data type, destination or environment here, so this would ${cl.effect} ${what} by every agent. Name what it's about — e.g. “secrets”, “customer emails”, “external AI”.`;
}

function ClauseLine({ cl }: { cl: ContractClause }) {
  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <DecisionChip d={cl.effect} small />
        <span className="small" style={{ flex: 1, minWidth: 0 }}>{cl.text}</span>
        <StatusChip s={clauseCoverage(cl)} />
      </div>
      <div className="small faint" style={{ marginTop: 5, paddingLeft: 2 }}>
        {cl.dataClasses.length ? cl.dataClasses.join(", ") : "any data"}
        {" · "}{cl.actions === "ANY" ? "any action" : cl.actions.join(" / ")}
        {" · to "}{destinationText(cl.destinations).toLowerCase()}
        {cl.environments?.length ? ` · only in ${cl.environments.join(", ")}` : ""}
        {cl.transform ? ` · ${cl.transform}` : ""}
      </div>
    </div>
  );
}

const statusChip = (st: IntentContract["status"]) =>
  st === "ACTIVE" ? <Chip tone="allow">live</Chip> : st === "DRAFT" ? <Chip tone="neutral">draft</Chip> : <Chip tone="block">switched off</Chip>;

export function Step3Contract(p: AdminStepProps) {
  const s = useAppState();
  const [start, setStart] = useState<null | "recommended" | "scratch">(p.draft.contractStart);
  const [pubResult, setPubResult] = useState<{ active: string[]; draft: string[] } | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ContractClause[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "warn" | "neutral"; text: string } | null>(null);

  const seedInStore = (id: string) => s.contracts.find((c) => c.id === id);
  const allSeedsPublished = SEED_CONTRACTS.every((c) => seedInStore(c.id));
  const mine = s.contracts.find((c) => c.id === MY_ID);
  const live = s.contracts.filter((c) => c.status === "ACTIVE").length;
  const drafts = s.contracts.filter((c) => c.status === "DRAFT").length;
  const broad = (preview ?? []).map(tooBroad);
  const anyBroad = broad.some(Boolean);

  function publish() {
    const r = publishRecommendedContracts();
    setPubResult(r);
    p.setDraft({ contractStart: "recommended" });
  }

  function draftIt() {
    setMsg(null);
    const out = draftClauses(text.trim());
    setPreview(out);
    if (out.length === 0) setMsg({ tone: "warn", text: "Nothing to draft — write at least one full sentence." });
  }

  function addToContract() {
    if (!preview || preview.length === 0 || anyBroad) return;
    const existing = getState().contracts.find((c) => c.id === MY_ID);
    const have = new Set((existing?.clauses ?? []).map((c) => norm(c.text)));
    const fresh = preview.filter((c) => !have.has(norm(c.text)));
    if (fresh.length === 0) { setMsg({ tone: "neutral", text: "Already in your contract — nothing added." }); return; }
    // The drafter numbers clauses per call; give each a unique id before it joins the contract.
    const stamp = Date.now().toString(36);
    const added = fresh.map((c, k) => ({ ...c, id: `cl-mine-${stamp}-${k + 1}` }));
    const clauses = [...(existing?.clauses ?? []), ...added];
    // Never switch off rules that are already live to make room for one that can't be kept.
    if (existing?.status === "ACTIVE" && !canActivate({ clauses })) {
      setMsg({ tone: "warn", text: `Not added — it needs ${missingSkills(added).join(", ")}, which isn't ready. Adding it would switch off the rules already live in “${MY_NAME}”. Save it as its own draft in Intent Studio instead.` });
      return;
    }
    upsertContract({
      id: MY_ID, name: MY_NAME, author: "u-priya",
      createdAt: existing?.createdAt ?? Date.now(), version: existing?.version ?? 1,
      status: "DRAFT",
      sourceText: [existing?.sourceText, added.map((c) => `${c.text}.`).join(" ")].filter(Boolean).join(" "),
      clauses, coverage: contractCoverage({ clauses }),
    });
    const wentLive = setContractStatus(MY_ID, "ACTIVE");
    p.setDraft({ contractStart: "scratch" });
    setPreview(null);
    setText("");
    const n = `${added.length} rule${added.length === 1 ? "" : "s"}`;
    setMsg(wentLive
      ? { tone: "good", text: `Added ${n} · “${MY_NAME}” is live and enforcing now.` }
      : { tone: "warn", text: `Added ${n}, but “${MY_NAME}” stays a draft — it needs ${missingSkills(clauses).join(", ")}, which isn't ready. Wrapbox won't claim protection it can't deliver.` });
  }

  return (
    <div className="card" style={{ padding: "24px 26px" }}>
      <StepHead
        n={p.n} total={p.total} title="Write your intent contract"
        sub="The contract is the set of rules Wrapbox enforces on every agent, whichever vendor it comes from. Start from the recommended baseline, or publish only the rules you write."
      />

      <div className="grid g2" style={{ gap: 12 }}>
        <Choice selected={start === "recommended"} onClick={() => { setStart("recommended"); setMsg(null); }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="plane-icon"><ShieldCheck size={16} /></span>
            <Chip tone="neutral">recommended</Chip>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 12 }}>Start with recommended protections</div>
          <div className="small dim" style={{ marginTop: 4, lineHeight: 1.55 }}>
            A practical baseline for data sent to AI, customer data, engineering guardrails and sensitive records.
          </div>
          <div className="small faint tnum" style={{ marginTop: 8 }}>{SEED_CONTRACTS.length} contracts · {SEED_RULES} rules</div>
        </Choice>
        <Choice selected={start === "scratch"} onClick={() => { setStart("scratch"); setMsg(null); }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="plane-icon"><PenLine size={16} /></span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 12 }}>Start from scratch</div>
          <div className="small dim" style={{ marginTop: 4, lineHeight: 1.55 }}>
            Describe each rule in plain English. Wrapbox compiles it and shows exactly what it will enforce before you add it.
          </div>
          <div className="small faint tnum" style={{ marginTop: 8 }}>
            {mine ? `${mine.clauses.length} rule${mine.clauses.length === 1 ? "" : "s"} written so far` : "Nothing written yet"}
          </div>
        </Choice>
      </div>

      {start === "recommended" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", overflow: "hidden" }}>
            {SEED_CONTRACTS.map((c, i) => {
              const inStore = seedInStore(c.id);
              const missing = missingSkills(c.clauses);
              return (
                <div key={c.id} className="row" style={{ gap: 12, padding: "11px 14px", borderTop: i ? "1px solid var(--line)" : "none", flexWrap: "nowrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                    <div className="small faint tnum">
                      {c.clauses.length} rules
                      {!canActivate(c) && missing.length > 0 && <> · needs {missing.join(", ")}</>}
                    </div>
                  </div>
                  <StatusChip s={contractCoverage(c)} />
                  {inStore
                    ? statusChip(inStore.status)
                    : canActivate(c)
                      ? <Chip tone="allow">goes live</Chip>
                      : <Chip tone="neutral">stays a draft — a skill it needs isn't ready</Chip>}
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 14, gap: 12 }}>
            {!allSeedsPublished && (
              <button className="btn btn-primary" onClick={publish}><ShieldCheck size={14} /> Publish contract</button>
            )}
            {(pubResult || allSeedsPublished) && (() => {
              const act = pubResult ? pubResult.active.length : SEED_CONTRACTS.filter((c) => seedInStore(c.id)?.status === "ACTIVE").length;
              const drf = pubResult ? pubResult.draft.length : SEED_CONTRACTS.filter((c) => seedInStore(c.id)?.status !== "ACTIVE").length;
              return (
                <span className="row small" style={{ gap: 7 }}>
                  <Check size={15} strokeWidth={3} style={{ color: "var(--allow)" }} />
                  <b>Published</b> · {act} live · {drf} kept as draft
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {start === "scratch" && (
        <div style={{ marginTop: 18 }}>
          <div className="field">
            <label className="field-label" htmlFor="ob-rule">Describe a rule in plain English</label>
            <textarea
              id="ob-rule" className="input" rows={3} value={text}
              onChange={(e) => { setText(e.target.value); setPreview(null); }}
              placeholder="e.g. Customer emails must be tokenized before they are sent to external AI."
            />
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <span className="small faint">Try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="btn btn-sm" onClick={() => { setText(ex); setPreview(null); setMsg(null); }}>
                <Sparkles size={12} /> {ex}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, gap: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={draftIt}>Draft it</button>
            <SimNote>Deterministic pattern compiler — the product compiles via Policy IR</SimNote>
          </div>

          {preview && preview.length > 0 && (
            <div style={{ ...inset, marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>What Wrapbox will enforce</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {preview.map((cl, i) => (
                  <div key={cl.id}>
                    <ClauseLine cl={cl} />
                    {broad[i] && <div className="small" style={{ color: "var(--block)", marginTop: 6 }}>Too broad to publish: {broad[i]}</div>}
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn-good btn-sm" disabled={anyBroad} onClick={addToContract}>Add to my contract</button>
                {anyBroad && <span className="small faint">Rephrase the sentence, then draft it again.</span>}
              </div>
            </div>
          )}

          {mine && (
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", marginTop: 14, padding: "12px 14px" }}>
              <div className="spread" style={{ marginBottom: 10 }}>
                <span className="row" style={{ gap: 8 }}>
                  <FileCode2 size={15} className="dim" />
                  <b style={{ fontSize: 13.5 }}>{mine.name}</b>
                  <span className="small faint mono">v{mine.version}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <StatusChip s={contractCoverage(mine)} />
                  {statusChip(mine.status)}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {mine.clauses.map((cl) => <ClauseLine key={cl.id} cl={cl} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div className="small" style={{ marginTop: 12, color: msg.tone === "good" ? "var(--allow)" : msg.tone === "warn" ? "var(--review)" : "var(--fg-2)" }}>
          {msg.text}
        </div>
      )}

      {s.contracts.length > 0 && (
        <div className="row small" style={{ ...inset, marginTop: 18, gap: 8 }}>
          <KeyRound size={14} className="dim" />
          <span>
            In this workspace now: <b className="tnum">{s.contracts.length}</b> contract{s.contracts.length === 1 ? "" : "s"} ·{" "}
            <span className="tnum">{live}</span> live · <span className="tnum">{drafts}</span> draft
          </span>
        </div>
      )}

      <div className="row small faint" style={{ marginTop: 12, gap: 7, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Rules enforce the moment they're published. To try a change safely first, use the Policy Simulator.</span>
      </div>

      <StepFooter
        onBack={p.back}
        onNext={p.next}
        disabled={s.contracts.length === 0}
        hint={s.contracts.length === 0 ? "Publish the recommended contract or add a rule to continue" : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEP 4 — Connect & roll out
// ---------------------------------------------------------------------------

const REACH: Record<ReturnType<typeof rolloutStatus>, string> = {
  ENFORCED: "Can enforce",
  DEGRADED: "Partial — some parts observed only",
  UNDERSTOOD_ONLY: "Observe only — enforcement on the roadmap",
  PENDING: "Not available yet",
};

export function Step4Rollout(p: AdminStepProps) {
  const s = useAppState();
  const alive = useAlive();
  const connected = new Set(s.onboarding.connected);
  // Phases for targets being rolled out right now; connected ones come from the store.
  const phaseRef = useRef<Record<string, number>>(
    Object.fromEntries(ROLLOUT.map((t) => [t.id, connected.has(t.id) ? 4 : 0])),
  );
  const [phase, setPhase] = useState<Record<string, number>>(phaseRef.current);
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const cats = p.draft.categories;
  const isRec = (t: RolloutTarget) => t.governs.some((k) => cats.includes(k));
  const recommended = ROLLOUT.filter(isRec);
  const rest = ROLLOUT.filter((t) => !isRec(t));
  const nConnected = ROLLOUT.filter((t) => connected.has(t.id)).length;
  const recLeft = recommended.filter((t) => !connected.has(t.id));

  const setPhaseOf = (id: string, n: number) => {
    phaseRef.current = { ...phaseRef.current, [id]: n };
    setPhase(phaseRef.current);
    p.setDraft({ phase: phaseRef.current });
  };

  async function connect(t: RolloutTarget) {
    if (getState().onboarding.connected.includes(t.id)) return;
    setRunning(t.id);
    setPhaseOf(t.id, 0);
    for (let i = 1; i <= t.phases.length; i++) {
      await sleep(750);
      if (!alive.current) return;
      setPhaseOf(t.id, i);
    }
    // Persist the moment it checks in.
    setOnboarding({ connected: [...new Set([...getState().onboarding.connected, t.id])] });
    setRunning(null);
  }

  async function connectAll() {
    setRunningAll(true);
    for (const t of recommended) {
      if (getState().onboarding.connected.includes(t.id)) continue;
      await connect(t);
      if (!alive.current) return;
    }
    setRunningAll(false);
  }

  const busy = running !== null || runningAll;

  // A render helper, not a nested component — a component defined here would
  // remount every row on each render and replay the tick animations.
  const row = (t: RolloutTarget, rec: boolean) => {
    const reach = rolloutStatus(t);
    const done = connected.has(t.id);
    const ph = done ? t.phases.length : phase[t.id] ?? 0;
    const active = running === t.id;
    return (
      <div key={t.id} className="card" style={{ padding: "14px 16px" }}>
        <div className="row" style={{ gap: 14, flexWrap: "nowrap", alignItems: "flex-start" }}>
          <span className="plane-icon" style={{ width: 38, height: 38, borderRadius: 10 }}><Logo name={t.logo} size={22} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 8 }}>
              <b style={{ fontSize: 14 }}>{t.name}</b>
              {rec && <Chip tone="allow">recommended for your agents</Chip>}
            </div>
            <div className="small dim" style={{ marginTop: 3 }}>{t.detail}</div>
            <div className="small faint" style={{ marginTop: 3 }}>
              {t.method} · guards {t.governs.map((k) => KIND_META[k].label).join(", ")}
            </div>
            <div className="row small" style={{ gap: 7, marginTop: 8 }}>
              <StatusChip s={reach} />
              <span className="faint">{REACH[reach]}</span>
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            {done ? (
              <Chip tone="allow">connected</Chip>
            ) : (
              <button className={`btn btn-sm ${rec ? "btn-primary" : ""}`} disabled={busy} onClick={() => connect(t)}>
                {active ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </div>

        {active && (
          <div style={{ ...inset, marginTop: 12 }}>
            <div className="row small faint" style={{ gap: 10, flexWrap: "nowrap", marginBottom: 6 }}>
              <span className="tnum" style={{ flexShrink: 0 }}>{Math.min(ph, t.phases.length)}/{t.phases.length}</span>
              <Bar value={ph / t.phases.length} />
            </div>
            {t.phases.slice(0, Math.min(t.phases.length, ph + 1)).map((line, i) => (
              <Tick key={line} done={ph > i}>{line}</Tick>
            ))}
          </div>
        )}
        {done && (
          <div style={{ marginTop: 8 }}>
            <Tick done>
              Connected · {t.checkIn}
              {reach !== "ENFORCED" && <span className="faint"> · {REACH[reach].toLowerCase()}</span>}
            </Tick>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card" style={{ padding: "24px 26px" }}>
      <StepHead
        n={p.n} total={p.total} title="Connect & roll out"
        sub="An admin and IT task — employees do nothing here. Push the runtime and network profile with your MDM, and point agents at the gateways. Each target shows the most it can do today."
      />

      <div style={{ ...inset, marginBottom: 16 }}>
        <div className="spread">
          <span style={{ fontSize: 13.5 }}>
            <b className="tnum">{nConnected} of {ROLLOUT.length}</b> connected
          </span>
          {recLeft.length > 0 && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={connectAll}>
              {runningAll ? "Connecting…" : `Connect all recommended (${recLeft.length})`}
            </button>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}><Bar value={nConnected / ROLLOUT.length} /></div>
      </div>

      {recommended.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "4px 0 10px" }}>Recommended for the agents you chose</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recommended.map((t) => row(t, true))}
          </div>
        </>
      )}
      {rest.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "20px 0 10px" }}>Other places to connect</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rest.map((t) => row(t, false))}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <SimNote>Simulated rollout — the status each target can reach is the same one the Coverage Map shows.</SimNote>
      </div>

      <StepFooter
        onBack={p.back}
        onNext={p.next}
        disabled={busy}
        hint={busy ? "Rolling out…" : nConnected < ROLLOUT.length ? "You can connect the rest later from Integrations" : undefined}
      />
    </div>
  );
}
