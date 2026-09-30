// Get started hub — the front door. Two ways in (set up a fresh workspace as
// the admin, or explore the Veridian demo), the employee side, and a setup
// checklist for the CURRENT workspace. Every state, count and decision on this
// page is read from the store; the decision composer replays real recorded
// events and shows nothing when the workspace has none.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, ArrowUp, Building2, Check, ChevronDown, Plus, Radio, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  useAppState, metrics, switchWorkspace, startFreshWorkspace,
  type AppState, type Region,
} from "../state/store";
import { ORG, AGENTS, DEVICES, agentById, userById } from "../model/org";
import { CAPABILITIES, PLANE_LABEL } from "../model/registries";
import { ROLLOUT } from "../model/rollout";
import { pendingRelease } from "../engine/kernel";
import type { ContractClause, DecidedBy, Plane, SimulationEvent } from "../model/types";
import { AgentMark, Avatar, Chip, DecisionChip, timeAgo, Progress } from "../ui/kit";
import { describe } from "../ui/describe";
import { DESKTOP_SHELL } from "../ui/shell";
import { Breadcrumb, PageIcon, currentPage } from "../ui/page-meta";
import { sfx } from "../ui/sfx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Live theme, watched via the `data-theme` attribute App.tsx's toggle sets — used only to
 *  make the composer below noticeably bigger on the light prism card; dark theme (the black
 *  stage + small composer) is untouched. */
function useIsLightTheme() {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(document.documentElement.dataset.theme === "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const REGION: Record<Region, string> = { us: "US", eu: "EU", in: "India" };
const AGENT_KINDS = [...new Set(AGENTS.map((a) => a.kind))];
const EMPLOYEE_ID = "u-daniel";
const EMPLOYEE_AGENT = AGENTS.find((a) => a.owner === EMPLOYEE_ID);

/** Vendor marks are drawn for a light tile (some are single-colour black), so
 *  their tile stays light in both themes — like an app icon. */
const LOGO_TILE = "color-mix(in oklab, var(--accent-fg) 95%, var(--accent))";

const ellipsis: CSSProperties ={ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** Mouse parallax: layers move by `px` × the pointer offset (--mx/--my, −1…1) set on the hero. */
const depth = (px: number): CSSProperties => ({
  transform: `translate3d(calc(var(--mx, 0) * ${px}px), calc(var(--my, 0) * ${px}px), 0)`,
  transition: "transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
  willChange: "transform",
});

/** Core Brain layer that produced a decision — the "model" label of the composer.
 *  Names match the labels the engine writes into `decidedBy.label`. */
const LAYER: Record<DecidedBy["layer"], string> = {
  killswitch: "Kill switch",
  supplier: "Supplier contract",
  delegation: "Delegation chain",
  injection: "Injection-aware",
  output: "Output check",
  contract: "Intent Contract",
  safety: "Safety Kernel",
  blast: "Blast-Radius Governor",
  context: "Context Engine",
  envelope: "Task Envelope",
  standing: "Standing permission",
  uninspectable: "Fail closed",
  breakglass: "Break-glass override",
  default: "Core Brain default",
};

/** Same plane wording the agent terminal uses. */
const PLANE: Record<Plane, string> = PLANE_LABEL;

/** Text on the .glow composer, which keeps its dark gradient in both themes —
 *  derived from --accent-fg (white in both) rather than the theme's --fg. */
const G = {
  fg: "var(--accent-fg)",
  fg2: "color-mix(in oklab, var(--accent-fg) 72%, transparent)",
  fg3: "color-mix(in oklab, var(--accent-fg) 50%, transparent)",
  fg4: "color-mix(in oklab, var(--accent-fg) 30%, transparent)",
};

// ---------------------------------------------------------------------------
// Setup checklist — eight milestones, each derived from the current workspace
// ---------------------------------------------------------------------------

interface ChecklistItem { label: string; done: boolean; route: string; hint: string }

function checklist(s: AppState): ChecklistItem[] {
  const ob = s.onboarding;
  const active = s.contracts.filter((c) => c.status === "ACTIVE");
  const drafts = s.contracts.filter((c) => c.status === "DRAFT").length;
  const rules = active.reduce((n, c) => n + c.clauses.length, 0);
  const approved = s.events.filter((e) => e.reviewState?.status === "approved" || e.reviewState?.status === "approved_scoped").length;
  const waiting = s.events.filter((e) => e.reviewState?.status === "pending").length;
  const created = !!s.org.keyThumb || s.workspace === "demo";
  const employee = userById(EMPLOYEE_ID)?.name ?? "The employee";
  return [
    {
      label: "Create the workspace", done: created, route: "onboarding/admin",
      hint: created ? `${s.org.domain} · ${s.org.idp || "no SSO yet"} · ${REGION[s.org.region]} data region` : "SSO, company name, data region",
    },
    {
      label: "Choose agents to govern", done: ob.categories.length > 0, route: "onboarding/admin",
      hint: ob.categories.length > 0 ? `${ob.categories.length} of ${AGENT_KINDS.length} agent kinds governed` : "No agents chosen yet",
    },
    {
      label: "Publish your intent contract", done: active.length > 0, route: "intent",
      hint: active.length > 0
        ? `${plural(active.length, "contract")} active · ${plural(rules, "rule")} enforced`
        : drafts > 0 ? `${plural(drafts, "draft")} — none active yet` : "No contract yet — only the Safety Kernel applies",
    },
    {
      label: "Connect a runtime or gateway", done: ob.connected.length > 0, route: "integrations",
      hint: `${ob.connected.length} of ${ROLLOUT.length} connected`,
    },
    {
      label: "See the first decision", done: s.events.length > 0, route: "live",
      hint: s.events.length > 0 ? `${plural(s.events.length, "decision")} recorded` : "No decisions recorded yet",
    },
    {
      label: "Bring in your team", done: ob.invited.length > 1, route: "onboarding/admin",
      hint: ob.invited.length > 1 ? `${plural(ob.invited.length, "person", "people")} in the workspace` : ob.invited.length === 1 ? "Just you so far" : "No one invited yet",
    },
    {
      label: "An employee joins", done: ob.employeeDone, route: "onboarding/employee",
      hint: ob.employeeDone ? `${employee} joined`
        : ob.employee.installed ? `${employee} installed — finishing up`
        : ob.employee.accepted ? `${employee} accepted the invite`
        : "No one has joined yet",
    },
    {
      label: "First human approval", done: approved > 0, route: "reviews",
      hint: approved > 0
        ? `${plural(approved, "approval")}${waiting > 0 ? ` · ${waiting} waiting` : ""}`
        : waiting > 0 ? `${waiting} waiting for a human` : "Nothing has needed a human yet",
    },
  ];
}

// ---------------------------------------------------------------------------
// Light-theme hero — the "enforcement fabric" banner. Every number is derived
// from the workspace: agents, devices, gateway capabilities, contract rules,
// recorded decisions. The prism keeps a fixed ink palette (bright in both themes).
// ---------------------------------------------------------------------------

const PRISM_INK: CSSProperties = {
  "--fg": "#1b0f33", "--fg-2": "rgba(27,15,51,0.82)", "--fg-3": "rgba(27,15,51,0.62)", "--fg-4": "rgba(27,15,51,0.4)",
  "--surface": "#ffffff", "--line": "rgba(27,15,51,0.14)", color: "#1b0f33",
} as CSSProperties;

const PLAT_ICON: Record<string, string> = { macOS: "", Windows: "", Linux: "" };

function GovernedBanner({ s, nav }: { s: AppState; nav: (r: string) => void }) {
  // Everything here is what THIS workspace has connected — day one shows nothing
  // governed until the admin connects a runtime; the seeded company shows its fleet.
  const connected = ROLLOUT.filter((t) => s.onboarding.connected.includes(t.id));
  const seen = AGENTS.filter((a) => connected.some((t) => t.governs.includes(a.kind)) && (a.discovered || s.onboarding.categories.includes(a.kind)));
  const total = seen.length;
  const discovered = seen.filter((a) => a.discovered).length;
  const governed = total - discovered;
  const devices = connected.some((t) => t.plane === "ENDPOINT" || t.plane === "NETWORK") ? DEVICES.filter((d) => d.enrolled).length : 0;
  const gateways = new Set(connected.filter((t) => t.plane === "GATEWAY").flatMap((t) => t.caps).filter((id) => CAPABILITIES.find((c) => c.id === id)?.status === "ENFORCED")).size;
  const rules = s.contracts.filter((c) => c.status === "ACTIVE").reduce((n, c) => n + c.clauses.length, 0);
  const decided = s.events.length;
  const refused = s.events.filter((e) => e.decision === "BLOCK").length;

  const plat: Record<string, number> = { macOS: 0, Windows: 0, Linux: 0 };
  if (devices > 0) DEVICES.filter((d) => d.enrolled).forEach((d) => { const os = d.os.split(" ")[0]; plat[os === "macOS" || os === "Windows" ? os : "Linux"] += 1; });
  const platforms = (Object.entries(plat) as [string, number][]).filter(([, n]) => n > 0);

  const codeLines: { label: string; cmd: string; out: string; route: string }[] = [
    { label: "wrapboxd · runtime", cmd: "wrapbox fleet --status", out: devices > 0 ? `✓ ${devices} device${devices === 1 ? "" : "s"} reporting · runtime healthy` : "no runtime connected yet", route: "integrations" },
    { label: "wrapbox · gateway", cmd: "wrapbox gw ls --enforced", out: gateways > 0 ? `✓ ${gateways} gateway${gateways === 1 ? "" : "s"} enforcing` : "no gateway connected yet", route: "coverage" },
    { label: "wrapbox · policy", cmd: "wrapbox policy show", out: rules > 0 ? `✓ contract active · ${rules} rule${rules === 1 ? "" : "s"}` : "no active contract yet", route: "intent" },
  ];

  return (
    <section
      className="hero-prism govbanner"
      onMouseMove={(e) => { if (reducedMotion()) return; const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3)); e.currentTarget.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3)); }}
      onMouseLeave={(e) => { e.currentTarget.style.setProperty("--mx", "0"); e.currentTarget.style.setProperty("--my", "0"); }}
      style={{ ...PRISM_INK, position: "relative", overflow: "hidden", borderRadius: "var(--r-xl)", padding: "clamp(22px, 3vw, 40px)", boxShadow: "var(--shadow-md)" }}
    >
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(460px circle at calc((var(--mx,0)+1)*50%) calc((var(--my,0)+1)*50%), rgba(255,255,255,0.26), transparent 70%)" }} />
      <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: "32px clamp(24px,4vw,64px)", alignItems: "start" }}>
        <div style={{ ...depth(-3) }}>
          <span className="govbadge">
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "#1b0f33" }} /> Enforcement Fabric
          </span>
          <h1 style={{ fontSize: "clamp(32px, 3.8vw, 50px)", lineHeight: 1.02, letterSpacing: "-0.035em", fontWeight: 700, margin: "18px 0 0", color: "#1b0f33" }}>
            {total === 0 ? "No agents governed yet." : <>{governed} of {total} agent{total === 1 ? "" : "s"} governed.</>}
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: 16, lineHeight: 1.55, color: "var(--fg-2)", maxWidth: "58ch" }}>
            {total === 0
              ? <>Nothing is connected in this workspace yet. Connect a runtime during setup and Wrapbox discovers the agents on each machine — then every tool call they make is decided before it runs.</>
              : <>
                  {total} agent{total === 1 ? " was" : "s were"} discovered across {devices} device{devices === 1 ? "" : "s"} by one Runtime per machine. {governed} {governed === 1 ? "is" : "are"} governed through a Wrapbox enforcement plane, so every tool call is decided before it runs.
                  {discovered > 0 && <> The other {discovered} {discovered === 1 ? "is" : "are"} inventory only — the Coverage Map shows where enforcement is ENFORCED, DEGRADED or still PENDING.</>}
                  {" "}So far {decided} action{decided === 1 ? "" : "s"} from governed agents {decided === 1 ? "was" : "were"} decided and {refused} refused.
                </>}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            {platforms.map(([os, n]) => (
              <span key={os} className="govchip">{PLAT_ICON[os]}{os} <b>{n}</b></span>
            ))}
            <button className="govchip govchip-btn" onClick={() => nav("agents")}>View agents <ArrowRight size={13} /></button>
          </div>
        </div>
        <div className="stack" style={{ gap: 12, ...depth(3) }}>
          {codeLines.map((c, k) => (
            <button key={c.label} className="govcode" style={{ animationDelay: `${0.15 + k * 0.14}s` }} onClick={() => nav(c.route)}>
              <span className="govcode-bar"><span className="govcode-dot" />{c.label}<span className="govcode-live">live</span></span>
              <span className="govcode-cmd"><span className="govcode-prompt">$</span> {c.cmd}</span>
              <span className="govcode-out">{c.out}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function StartPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const isLight = useIsLightTheme();
  const bigComposer = isLight && !DESKTOP_SHELL;
  const m = metrics(s);
  const ob = s.onboarding;
  const fresh = s.workspace === "fresh";
  const company = s.org.company || "New workspace";
  const [confirmReset, setConfirmReset] = useState(false);

  const items = useMemo(() => checklist(s), [s]);
  const done = items.filter((i) => i.done).length;
  const next = items.find((i) => !i.done);
  const pct = Math.round((done / items.length) * 100);
  const activeRules = s.contracts.filter((c) => c.status === "ACTIVE").reduce((n, c) => n + c.clauses.length, 0);

  // "In progress" = the admin has committed something in this workspace.
  const progress = !!s.org.keyThumb || ob.categories.length > 0 || s.contracts.length > 0;
  const erasable = progress || ob.adminDone || ob.connected.length > 0 || ob.invited.length > 1 || s.events.length > 0;

  const adminTag = !fresh ? { text: "Fresh workspace · day one", tone: "neutral" }
    : ob.adminDone ? { text: "Done", tone: "allow" }
    : progress ? { text: "In progress", tone: "review" }
    : { text: "Fresh workspace · day one", tone: "neutral" };
  const adminCta = !fresh ? "Set up from zero" : ob.adminDone ? "Review setup" : progress ? "Resume admin setup" : "Start admin setup";
  const employeeTag = ob.employeeDone ? { text: "Done", tone: "allow" }
    : ob.employee.accepted ? { text: "In progress", tone: "review" }
    : { text: `In ${company}`, tone: "neutral" };

  const setUp = () => {
    if (!fresh) switchWorkspace("fresh");
    nav("onboarding/admin");
  };
  const explore = () => {
    switchWorkspace("demo"); // no-op when already in the demo
    nav("control");
  };
  const startOver = () => {
    startFreshWorkspace();
    // The admin wizard remembers its step per workspace for the session; a
    // workspace that was just erased must open at step 1, not where it was.
    try { sessionStorage.removeItem("wrapbox-onboarding-admin:fresh"); } catch { /* session-only */ }
    setConfirmReset(false);
    nav("onboarding/admin");
  };

  // Mouse parallax — CSS variables only, no re-render per mouse move.
  const onHeroMove = (e: MouseEvent<HTMLElement>) => {
    if (reducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    e.currentTarget.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const onHeroLeave = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty("--mx", "0");
    e.currentTarget.style.setProperty("--my", "0");
  };

  const governs = AGENTS.filter((a) => !a.discovered && a.kind !== "internal");
  // A Safety Kernel release this workspace has not installed yet — the "New:" link is omitted otherwise.
  const release = pendingRelease(s.kernel);
  const startMeta = DESKTOP_SHELL ? currentPage() : undefined;

  return (
    <div className="page page-wide">
      {/* 1 · Hero — light theme shows the enforcement-fabric banner; dark keeps the
             two-line headline + live decision composer. */}
      <section
        onMouseMove={onHeroMove}
        onMouseLeave={onHeroLeave}
        style={{ position: "relative", padding: DESKTOP_SHELL ? 0 : "clamp(12px, 2.6vw, 36px) 0 0" }}
      >
        {bigComposer ? (
          <GovernedBanner s={s} nav={nav} />
        ) : (
        <div style={{ maxWidth: 820, ...(DESKTOP_SHELL ? {} : depth(-2)) }}>
          {DESKTOP_SHELL && startMeta && <Breadcrumb meta={startMeta} />}
          <div className={DESKTOP_SHELL ? "page-title-row start-title-row" : undefined}>
          {DESKTOP_SHELL && startMeta && <PageIcon meta={startMeta} size={44} />}
          <h1 className="start-hero-title" style={{
            fontSize: "clamp(36px, 4.4vw, 58px)", lineHeight: 1.02, letterSpacing: "-0.04em",
            fontWeight: 600, margin: 0, color: "var(--fg)", textWrap: "balance",
          }}>
            Runtime authorization for every AI agent, from laptop to cloud.
          </h1>
          </div>
          <p className="start-hero-sub" style={{ margin: "18px 0 0", fontSize: 16.5, lineHeight: 1.5, color: "var(--fg-2)", maxWidth: "62ch" }}>
            Claude Code, Codex, ChatGPT, your own agents — Wrapbox decides whether each action is safe from its action, environment, data, destination and blast radius, and returns ALLOW, CONSTRAIN, REVIEW or BLOCK.
          </p>
        </div>
        )}

        <div className="spread" style={{ marginTop: 26, alignItems: "center" }}>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-primary btn-lg" onClick={setUp}>
              {fresh && ob.adminDone ? <Check size={15} /> : <Plus size={15} />}
              {fresh ? adminCta : "Set up from zero"}
            </button>
            <button className="btn btn-lg" onClick={explore}>
              Explore the {ORG.short} demo <ArrowRight size={15} />
            </button>
          </div>
          {release && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => nav("safety")}
              title={release.notes[0]}
              style={{ marginLeft: "auto", marginRight: -10, fontSize: 12.5, gap: 5 }}
            >
              <span style={{ color: "var(--fg)", fontWeight: 600 }}>New:</span>
              <span style={{ color: "var(--fg-2)" }}>Safety Kernel {release.version}</span>
              <ArrowRight size={13} style={{ color: "var(--fg-2)" }} />
            </button>
          )}
        </div>

        {DESKTOP_SHELL && <AgentFactory s={s} nav={nav} />}

        {/* The "video" panel — dark theme only; the light hero is the banner above. */}
        {!bigComposer && !DESKTOP_SHELL && <div
          style={{
            position: "relative", overflow: "hidden", marginTop: 28,
            borderRadius: "var(--r-xl)", border: "1px solid var(--line)", background: "var(--surface)",
            display: "flex", flexDirection: "column", minHeight: "clamp(420px, 44vw, 520px)",
            padding: "clamp(16px, 2.4vw, 28px)",
          }}
        >
          <div aria-hidden="true" className="start-stage-haze" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: [
              // pointer-following haze
              "radial-gradient(520px circle at calc((var(--mx, 0) + 1) * 50%) calc((var(--my, 0) + 1) * 50%), color-mix(in oklab, var(--accent) 9%, transparent), transparent 70%)",
              // stage light under the composer
              "radial-gradient(60% 46% at 50% 78%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 72%)",
            ].join(", "),
          }} />

          {/* Top row — stream selector + recorded count */}
          <div className="spread" style={{ position: "relative", zIndex: 1, gap: 10 }}>
            <button
              className="pill"
              onClick={() => nav("live")}
              title="Open Live Actions"
              style={{ cursor: "pointer", height: 34, padding: "0 12px 0 14px", fontSize: 13, color: "var(--fg)", background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--line-strong)" }}
            >
              <span className={`pill-dot${m.total > 0 ? " live-dot" : ""}`} style={{ background: m.total > 0 ? "var(--allow)" : "var(--fg-4)" }} />
              Live decisions <ChevronDown size={14} style={{ color: "var(--fg-3)" }} />
            </button>
            {m.total > 0 ? (
              // .pill-ok is hidden below 1000px (a topbar rule), so its look is inlined here.
              <span className="pill" style={{
                height: 28, fontSize: 12, padding: "0 12px", color: "var(--allow)",
                background: "color-mix(in oklab, var(--allow) 8%, transparent)",
                boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--allow) 26%, transparent)",
              }}>
                {m.total.toLocaleString("en-US")} recorded
              </span>
            ) : (
              <span className="pill" style={{ height: 28, fontSize: 12, padding: "0 12px" }}>None recorded</span>
            )}
          </div>

          {/* Centre — the composer */}
          <div style={{ position: "relative", zIndex: 1, flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "center", alignItems: "center", padding: "24px 0" }}>
            <DecisionPanel events={s.events} total={m.total} company={company} nav={nav} big={bigComposer} />
          </div>

          {/* Bottom row — what is governed, and where the stream comes from */}
          <div className="spread" style={{ position: "relative", zIndex: 1, gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="small faint">Governs</span>
              <span className="governs-stack" style={{ display: "inline-flex" }}>
                {governs.map((a, i) => (
                  <span key={a.id} title={a.name} style={{
                    width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center",
                    background: LOGO_TILE, border: "1px solid var(--line-strong)",
                    marginLeft: i === 0 ? 0 : -6, position: "relative", zIndex: governs.length - i,
                  }}>
                    <AgentMark agentId={a.id} size={15} />
                  </span>
                ))}
              </span>
              <span className="small faint">and your own agents</span>
            </div>
            {s.events.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => nav("live")} style={{ marginRight: -10 }}>
                Live Actions <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>}
      </section>

      {/* 2 · Paths ------------------------------------------------------ */}
      <div className="grid g3" style={{ marginTop: 16 }}>
        <PathCard
          icon={<IconTile><Plus size={19} /></IconTile>}
          tag={adminTag}
          title="Set up from zero, as the admin"
          body="Create the workspace, choose the agents to govern, publish your intent contract, connect a runtime and invite your team — every page fills in from what you do."
          cta={adminCta}
          primary={!fresh || !ob.adminDone}
          here={fresh}
          onCta={setUp}
          after={fresh && erasable ? (
            confirmReset ? (
              <div onClick={(e) => e.stopPropagation()} style={{
                marginTop: 12, padding: "10px 12px", borderRadius: 10, cursor: "default",
                background: "var(--surface-2)", border: "1px solid var(--line)",
                fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-2)",
              }}>
                Erase the fresh workspace and begin again from day one? The {ORG.short} demo is not touched.
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn btn-danger btn-sm" onClick={startOver}>Erase and start over</button>
                  <button className="btn btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: "flex-start", marginTop: 8, marginLeft: -10 }}
                onClick={(e) => { e.stopPropagation(); setConfirmReset(true); }}
              >
                <RotateCcw size={13} /> Start over
              </button>
            )
          ) : undefined}
        />
        <PathCard
          icon={
            <span style={{ position: "relative", display: "inline-grid" }}>
              <Avatar userId={EMPLOYEE_ID} size={40} />
              {EMPLOYEE_AGENT && (
                <span style={{
                  position: "absolute", right: -5, bottom: -3, width: 20, height: 20, borderRadius: 6,
                  display: "grid", placeItems: "center", background: LOGO_TILE,
                  border: "1px solid var(--line)", boxShadow: "var(--shadow-sm)",
                }}>
                  <AgentMark agentId={EMPLOYEE_AGENT.id} size={13} />
                </span>
              )}
            </span>
          }
          tag={employeeTag}
          title="Join as an employee"
          body="See the employee side: accept the invite, install, and watch your agent get governed."
          cta={`Join as ${(userById(EMPLOYEE_ID)?.name ?? "Daniel").split(" ")[0]}`}
          primary={fresh && ob.adminDone && !ob.employeeDone}
          onCta={() => nav("onboarding/employee")}
        />
        <PathCard
          icon={<IconTile tone="constrain"><Building2 size={19} /></IconTile>}
          tag={{ text: "Demo · 3 months in", tone: "neutral" }}
          title={`Explore ${ORG.name}`}
          body="A company three months in: real history, reviews, tasks and evidence."
          cta={fresh ? `Explore ${ORG.short}` : "Open the Control Room"}
          here={!fresh}
          onCta={explore}
          after={
            <div className="small faint" style={{ marginTop: 10 }}>
              {fresh
                ? "Your fresh workspace stays exactly as you left it."
                : `${plural(m.total, "decision")} · ${m.pendingReviews} awaiting review · ${plural(activeRules, "rule")} enforcing`}
            </div>
          }
        />
      </div>

      {/* 3 · Setup checklist -------------------------------------------- */}
      <section className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
        <div className="spread" style={{ padding: "20px 24px 18px", alignItems: "flex-end", gap: 20 }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div className="eyebrow">{fresh ? "Fresh workspace" : "Demo · 3 months in"}</div>
            <h2 style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.015em", marginTop: 6 }}>{company} — setup checklist</h2>
            <div className="dim" style={{ fontSize: 13.5, marginTop: 3 }}>
              {next ? `${done} of ${items.length} done — ${next.label.toLowerCase()} next.` : "Everything is live."}
            </div>
          </div>
          <div style={{ flex: "0 1 260px", minWidth: 180 }}>
            <Progress value={done} max={items.length} label="Progress" detail={`${done} of ${items.length} · ${pct}%`} size="lg" />
          </div>
        </div>
        <div className="grid g2" style={{ gap: "2px 12px", padding: "10px 12px 12px", borderTop: "1px solid var(--line)" }}>
          {items.map((it) => {
            const isNext = it === next;
            return (
              <button
                key={it.label}
                className="setup-step"
                onClick={() => nav(it.route)}
                aria-label={`${it.label} — ${it.done ? "done" : "not done"}. ${it.hint}`}
                style={{
                  alignItems: "center", gap: 12, padding: "10px 12px",
                  ...(isNext ? {
                    background: "color-mix(in oklab, var(--accent) 7%, transparent)",
                    borderColor: "color-mix(in oklab, var(--accent) 26%, transparent)",
                  } : null),
                }}
              >
                <span
                  className={`setup-num${it.done ? " done" : ""}`}
                  aria-hidden="true"
                  style={{ width: 22, height: 22, marginTop: 0, ...(isNext ? { borderColor: "var(--accent)" } : null) }}
                >
                  {it.done && <Check size={12} strokeWidth={3} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="setup-step-title" style={{ color: it.done ? "var(--fg-2)" : "var(--fg)" }}>{it.label}</span>
                  <span className="setup-step-sub" style={ellipsis}>{it.hint}</span>
                </span>
                {isNext && <Chip tone="neutral">Next</Chip>}
                <ArrowRight size={14} style={{ color: "var(--fg-4)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero composer — a chat-style prompt box that replays the workspace's latest
// real decisions. The "prompt" is the decision sentence; the "model" is the
// Core Brain layer that decided it.
// ---------------------------------------------------------------------------

const ROW_BASE = 62;
const ROW_BIG = 84; // light theme's prism composer — a hero element, not a small floating chip
const GAP = 0;
const SHOWN = 1; // one decision reads as the prompt; the next slides in from above
const WINDOW = 8; // replay the latest N recorded decisions
const windowHeight = (rows: number, rowH: number) => rows * rowH + Math.max(0, rows - 1) * GAP;

function DecisionPanel({ events, total, company, nav, big }: {
  events: SimulationEvent[]; total: number; company: string; nav: (r: string) => void; big: boolean;
}) {
  const rowH = big ? ROW_BIG : ROW_BASE;
  // Chronological (oldest → newest) window of the latest recorded decisions.
  const recent = useMemo(() => [...events].sort((a, b) => a.timestamp - b.timestamp).slice(-WINDOW), [events]);
  const n = recent.length;
  const newest = recent[n - 1]?.id;
  const rotates = n > SHOWN;
  const [t, setT] = useState(Math.max(0, n - 1)); // top row = recent[t mod n]
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // A newly recorded decision goes straight to the top.
  useEffect(() => { setT(Math.max(0, n - 1)); }, [newest, n]);

  // Advance every 1.9 s; hover/focus pauses so a row can be read. Reduced motion: no auto-advance.
  useEffect(() => {
    if (!rotates || paused || reducedMotion()) return;
    const id = window.setInterval(() => setT((x) => x + 1), 1900);
    return () => window.clearInterval(id);
  }, [rotates, paused]);

  // Slide: render the new top row above the window, then ease the list down one row.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !rotates || reducedMotion()) return;
    el.style.transition = "none";
    el.style.transform = `translateY(-${rowH + GAP}px)`;
    void el.offsetHeight; // commit the start position before animating
    el.style.transition = "transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "translateY(0)";
  }, [t, rotates, rowH]);

  const at = (k: number) => recent[(((t - k) % n) + n) % n];
  const rows = n === 0 ? [] : Array.from({ length: rotates ? SHOWN + 1 : n }, (_, k) => at(k));
  const current = rows[0]; // the decision currently reading as the prompt
  const why = current ? (current.decidedBy?.label ?? current.decisionReasons[0] ?? "") : "";

  return (
    <div
      className="glow"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        width: "100%", maxWidth: big ? 880 : 580, minWidth: 0,
        padding: big ? "30px 32px 24px" : "18px 18px 14px", color: G.fg, ...depth(6),
      }}
    >
      {n === 0 ? (
        <div style={{ minHeight: windowHeight(SHOWN, rowH), display: "flex", alignItems: "center", gap: big ? 18 : 14, padding: "4px 2px" }}>
          <span style={{
            width: big ? 48 : 36, height: big ? 48 : 36, borderRadius: big ? 14 : 10, flexShrink: 0, display: "grid", placeItems: "center",
            color: G.fg3, border: `1px dashed ${G.fg4}`,
          }}>
            <Radio size={big ? 21 : 17} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: big ? 18 : 14.5, fontWeight: 500, color: G.fg2 }}>No decisions yet — run a go-live self-test in setup</div>
            <div style={{ fontSize: big ? 14 : 12, color: G.fg3, marginTop: 3 }}>Nothing shows here until {company} records a real one.</div>
          </div>
          <button className="btn btn-sm" onClick={() => nav("onboarding/admin")}>
            Open setup <ArrowRight size={13} />
          </button>
        </div>
      ) : (
        <div
          aria-live="off"
          style={{
            height: windowHeight(Math.min(n, SHOWN), rowH), overflow: "hidden", position: "relative",
            ...(rotates ? {
              maskImage: "linear-gradient(to bottom, black 0%, black 84%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 84%, transparent 100%)",
            } : null),
          }}
        >
          <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: GAP, willChange: "transform" }}>
            {rows.map((e, k) => <TickerRow key={k} e={e} big={big} />)}
          </div>
        </div>
      )}

      {/* Bottom row — the "model" picker: which Core Brain layer decided, on which plane */}
      <div className="spread" style={{ marginTop: big ? 16 : 10, paddingTop: big ? 16 : 10, borderTop: "1px solid color-mix(in oklab, var(--accent) 22%, transparent)", gap: 8 }}>
        <div className="row" style={{ gap: 6, minWidth: 0, flex: 1 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => nav("brain")}
            title={why || "How the Core Brain decides"}
            style={{ marginLeft: -8, gap: 5, fontSize: big ? 14.5 : 12.5, color: G.fg2, background: "transparent", maxWidth: "100%" }}
          >
            <span style={ellipsis}>
              Decided by · {current?.decidedBy ? LAYER[current.decidedBy.layer] : n === 0 ? "—" : "Core Brain"}
            </span>
            <ChevronDown size={13} style={{ flexShrink: 0 }} />
          </button>
          {current && (
            <span style={{ fontSize: big ? 14 : 12, color: G.fg3, ...ellipsis }}>
              {PLANE[current.plane]}{paused && rotates ? " · paused" : ""}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: big ? 13 : 11.5, color: G.fg3, ...ellipsis }}>
            {n === 0 ? `${company} · nothing recorded` : `Latest ${n} of ${total.toLocaleString("en-US")} in ${company}`}
          </span>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => nav("live")}
            aria-label="Open Live Actions"
            title="Open Live Actions"
            disabled={n === 0}
            style={{ width: big ? 36 : 30, height: big ? 36 : 30, padding: 0, borderRadius: 999 }}
          >
            <ArrowUp size={big ? 17 : 15} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TickerRow({ e, big }: { e: SimulationEvent; big: boolean }) {
  const agent = agentById(e.agent);
  const sentence = describe(e);
  const why = e.decidedBy?.label ?? e.decisionReasons[0] ?? "";
  const rowH = big ? ROW_BIG : ROW_BASE;
  return (
    <div
      title={`${sentence} — ${e.decision}${why ? `\n${why}` : ""}`}
      style={{ height: rowH, flexShrink: 0, display: "flex", alignItems: "center", gap: big ? 18 : 14, padding: "0 2px" }}
    >
      <span style={{
        width: big ? 48 : 36, height: big ? 48 : 36, borderRadius: big ? 14 : 10, flexShrink: 0, display: "grid", placeItems: "center",
        background: LOGO_TILE, border: `1px solid ${G.fg4}`,
      }}>
        <AgentMark agentId={e.agent} size={big ? 25 : 19} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...ellipsis, fontSize: big ? 19 : 15, fontWeight: 500, letterSpacing: "-0.01em", color: G.fg }}>{sentence}</div>
        <div style={{ ...ellipsis, fontSize: big ? 14 : 12, color: G.fg3, marginTop: 3 }}>
          {agent?.name ?? e.agent}{why ? ` · ${why}` : ""} · {timeAgo(e.timestamp)}
        </div>
      </div>
      <DecisionChip d={e.decision} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity grid — a decorative contribution-graph band: square cells in
// GitHub's green scale, about half lit, some blinking. The pattern is visual
// only; hovering a cell shows a real clause from the workspace's active rules,
// picked at random per cell. Hover and click play the interface sounds.
// Desktop only (hidden below 860px).
// ---------------------------------------------------------------------------

const GRID_COLS = 52;
const GRID_ROWS = 7;

/** Stable pseudo-random 0..1 per cell, so the pattern never reshuffles on render. */
function cellNoise(i: number): number {
  let h = (i + 1) * 2654435761;
  h = (h ^ (h >>> 15)) * 2246822519;
  h = (h ^ (h >>> 13)) * 3266489917;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Half the cells lit (2 of 4), the lit half spread across the four green tints. */
const GRID_LEVELS = Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => {
  const n = cellNoise(i);
  return n < 0.5 ? 0 : 1 + Math.floor(((n - 0.5) / 0.5) * 4);
});

function SfxToggle() {
  const [, force] = useState(0);
  useEffect(() => sfx.subscribe(() => force((n) => n + 1)), []);
  const muted = sfx.isMuted();
  const locked = !muted && !sfx.isUnlocked();
  return (
    <span className="heat-sound">
      {locked && <span className="heat-sound-hint"><i />Click anywhere to enable sound</span>}
      <button
        type="button"
        className={`heat-mute${locked ? " locked" : ""}`}
        onClick={() => { const next = !muted; sfx.setMuted(next); if (!next) sfx.chime(); }}
        aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
        title={muted ? "Unmute sound effects" : "Mute sound effects"}
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
    </span>
  );
}

type CodeLine = { k?: string; v?: string; c?: string; tone?: string };

/** A real clause from the workspace's active rules, rendered as policy YAML. */
function clauseSnippet(contract: string, cl: ContractClause): CodeLine[] {
  const list = (x: string[] | "ANY" | undefined) => (!x || x === "ANY" ? "any" : `[${x.join(", ")}]`);
  const text = cl.text.length > 54 ? `${cl.text.slice(0, 53)}…` : cl.text;
  const lines: CodeLine[] = [
    { c: `# ${contract}` },
    { k: "- id", v: cl.id },
    { k: "  rule", v: `"${text}"` },
    { k: "  when" },
    { k: "      actions", v: list(cl.actions) },
    { k: "      data", v: list(cl.dataClasses.length ? cl.dataClasses : "ANY") },
    { k: "      destinations", v: list(cl.destinations) },
  ];
  if (cl.environments?.length) lines.push({ k: "      env", v: list(cl.environments) });
  lines.push({ k: "  effect", v: cl.effect, tone: cl.effect.toLowerCase() });
  if (cl.transform) lines.push({ k: "  transform", v: cl.transform });
  lines.push({ k: "  fail_closed", v: String(cl.failClosed) });
  return lines;
}

function AgentFactory({ s, nav }: { s: AppState; nav: (r: string) => void }) {
  const registered = AGENTS.filter((a) => !a.discovered).length;
  const active = s.contracts.filter((c) => c.status === "ACTIVE");
  const activeRules = active.reduce((n, c) => n + c.clauses.length, 0);
  const clauses = useMemo(() => active.flatMap((c) => c.clauses.map((cl) => ({ name: c.name, cl }))), [s.contracts]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number; below: boolean } | null>(null);

  const enter = (i: number, el: HTMLElement) => {
    sfx.hover();
    const box = boxRef.current;
    if (!box) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    const below = r.top - b.top < 150;
    setTip({ i, x: Math.min(Math.max(r.left - b.left + r.width / 2, 176), b.width - 176), y: below ? r.bottom - b.top : r.top - b.top, below });
  };
  const pick = tip && clauses.length ? clauses[Math.floor(cellNoise(tip.i + 31) * clauses.length)] : null;
  const code = pick ? clauseSnippet(pick.name, pick.cl) : null;

  return (
    <section className="heat">
      <div className="heat-board" ref={boxRef} onMouseLeave={() => setTip(null)}>
        <div className="heat-head">
          <span className="heat-title-main">Agent activity</span>
          <SfxToggle />
        </div>
        <div className="heat-grid" style={{ ["--cols" as string]: GRID_COLS }}>
          {GRID_LEVELS.map((lvl, i) => {
            const n = cellNoise(i + 7919);
            const blink = lvl ? (n < 0.34 ? " bk" : "") : n < 0.09 ? " bk-on" : "";
            return (
              <span
                key={i}
                className={`heat-cell g-${lvl}${blink}${tip?.i === i ? " on" : ""}`}
                style={{ ["--d" as string]: Math.floor(cellNoise(i + 104729) * 50), ["--t" as string]: `${2.2 + cellNoise(i + 15485863) * 3.2}s` } as CSSProperties}
                onMouseEnter={(e) => enter(i, e.currentTarget)}
                onClick={() => sfx.click()}
                aria-hidden="true"
              />
            );
          })}
        </div>
        <div className="heat-legend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-cell g-${l}`} />)}
          <span>More</span>
        </div>
        {tip && (
          <div key={tip.i} className={`heat-code${tip.below ? " below" : ""}`} style={{ left: tip.x, top: tip.y }}>
            <div className="heat-code-bar">
              <span className="heat-code-dots"><i /><i /><i /></span>
              <span className="heat-code-file">{code ? "policy.yaml" : "workspace"}</span>
            </div>
            <pre className="heat-code-body">
              {code
                ? code.map((l, n) => (
                    <span key={n} className="heat-code-line" style={{ animationDelay: `${n * 32}ms` }}>
                      <span className="ln">{n + 1}</span>
                      {l.c ? <span className="cm">{l.c}</span> : <><span className="ky">{l.k}:</span>{l.v !== undefined && <> <span className={l.tone ? `vl fx-${l.tone}` : "vl"}>{l.v}</span></>}</>}
                    </span>
                  ))
                : <span className="heat-code-line"><span className="cm"># No active rules yet — publish one in Intent Studio.</span></span>}
            </pre>
          </div>
        )}
      </div>
      <div className="heat-foot">
        <span>{registered} of {AGENTS.length} agents registered</span> <span className="dim">·</span> <span>{activeRules} rules enforced</span>
        <button className="btn btn-ghost btn-sm" onClick={() => nav("live")}>Live Actions <ArrowRight size={13} /></button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Path card
// ---------------------------------------------------------------------------

function IconTile({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "constrain" }) {
  const other = tone === "accent" ? "var(--constrain)" : "var(--accent)";
  return (
    <span className="icon-tile" style={{
      width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", color: "var(--accent-fg)",
      background: `linear-gradient(135deg, var(--${tone}), color-mix(in oklab, var(--${tone}) 58%, ${other}))`,
      boxShadow: `0 8px 18px -10px color-mix(in oklab, var(--${tone}) 85%, transparent)`,
    }}>
      {children}
    </span>
  );
}

function PathCard({ icon, tag, title, body, cta, onCta, primary, here, after }: {
  icon: ReactNode;
  tag: { text: string; tone: string };
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
  primary?: boolean;
  here?: boolean;
  after?: ReactNode;
}) {
  // The whole card is the target; the CTA button is its keyboard-focusable face.
  return (
    <div
      className="card clickable-card"
      onClick={onCta}
      style={{
        display: "flex", flexDirection: "column", padding: 22,
        ...(here ? { borderColor: "color-mix(in oklab, var(--accent) 42%, var(--line))" } : null),
      }}
    >
      <div className="spread" style={{ alignItems: "flex-start" }}>
        {icon}
        {here && <span className="chip c-neutral">You're here</span>}
      </div>
      {/* Status tag in the sans face — the decision tones render mono by default, which is reserved for decisions. */}
      <div style={{ marginTop: 16 }}><span className={`chip c-${tag.tone}`} style={{ fontFamily: "var(--sans)", letterSpacing: "0.01em" }}>{tag.text}</span></div>
      <div style={{ fontSize: 16.5, fontWeight: 650, letterSpacing: "-0.015em", marginTop: 8 }}>{title}</div>
      <p className="dim" style={{ fontSize: 13, lineHeight: 1.55, margin: "6px 0 0", flex: 1 }}>{body}</p>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className={`btn${primary ? " btn-primary" : ""}`}>
          {cta} <ArrowRight size={14} />
        </button>
      </div>
      {after}
    </div>
  );
}
