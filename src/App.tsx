import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, BrainCircuit, CirclePlay, FileCheck2, FlaskConical, Hand, KeyRound,
  ArrowRight, Check, ChevronDown, LayoutGrid, ListChecks, ListTree, Moon, Play, Plug, RotateCcw, Rocket, ScrollText, Search, Sun,
  Settings as SettingsIcon, ShieldCheck, Siren, Table2, Timer, Waypoints,
  type LucideIcon, ChevronsUpDown,
} from "lucide-react";
import { useAppState, getState, metrics, switchWorkspace, startFreshWorkspace, type Workspace } from "./state/store";
import { KERNEL_RELEASES, installedRules, pendingRelease } from "./engine/kernel";
import { WrapboxWordmark } from "./ui/logo";
import { Avatar } from "./ui/kit";
import { ControlRoom } from "./pages/control-room";
import { LiveActions } from "./pages/live-actions";
import { AgentsPage } from "./pages/agents";
import { TasksPage } from "./pages/tasks";
import { IntentStudio } from "./pages/intent-studio";
import { SafetyKernelPage } from "./pages/safety-kernel";
import { PolicySimulator } from "./pages/policy-simulator";
import { ReviewCenter } from "./pages/review-center";
import { StandingPage } from "./pages/standing";
import { BreakGlassPage } from "./pages/break-glass";
import { CoverageMap } from "./pages/coverage";
import { TrustGraph } from "./pages/trust-graph";
import { EvidenceExplorer } from "./pages/evidence";
import { SimulationLab } from "./pages/sim-lab";
import { IntegrationsPage } from "./pages/integrations";
import { TokenVaultPage } from "./pages/token-vault";
import { CoreBrainPage } from "./pages/core-brain";
import { SettingsPage } from "./pages/settings";
import { StartPage } from "./pages/start";
import { AdminOnboarding } from "./pages/onboarding-admin";
import { EmployeeOnboarding } from "./pages/onboarding-employee";
import { DemoBar, DEMO_SCRIPT } from "./pages/demo";
import { DESKTOP_SHELL } from "./ui/shell";
import { CompanyMark } from "./ui/company-mark";
import { ORG } from "./model/org";

export type Route = string;

interface NavItem { route: string; label: string; icon: LucideIcon }
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ route: "control", label: "Control Room", icon: LayoutGrid }] },
  {
    group: "Activity",
    items: [
      { route: "live", label: "Live Actions", icon: ListTree },
      { route: "agents", label: "Agents", icon: Bot },
      { route: "tasks", label: "Tasks", icon: ListChecks },
    ],
  },
  {
    group: "Policy",
    items: [
      { route: "intent", label: "Intent Studio", icon: FileCheck2 },
      { route: "safety", label: "Safety Kernel", icon: ShieldCheck },
      { route: "simulator", label: "Policy Simulator", icon: FlaskConical },
    ],
  },
  {
    group: "Authorization",
    items: [
      { route: "reviews", label: "Review Center", icon: Hand },
      { route: "standing", label: "Standing Permissions", icon: Timer },
      { route: "breakglass", label: "Break Glass", icon: Siren },
    ],
  },
  {
    group: "Visibility",
    items: [
      { route: "coverage", label: "Coverage Map", icon: Table2 },
      { route: "trust", label: "Trust Graph", icon: Waypoints },
      { route: "evidence", label: "Evidence", icon: ScrollText },
    ],
  },
  { group: "Simulation", items: [{ route: "simlab", label: "Simulation Lab", icon: CirclePlay }] },
  {
    group: "System",
    items: [
      { route: "integrations", label: "Integrations", icon: Plug },
      { route: "vault", label: "Token Vault", icon: KeyRound },
      { route: "brain", label: "Core Brain", icon: BrainCircuit },
    ],
  },
];
const START_ITEM: NavItem = { route: "start", label: "Get started", icon: Rocket };
const SETTINGS_ITEM: NavItem = { route: "settings", label: "Settings", icon: SettingsIcon };
const ALL_ITEMS: NavItem[] = [START_ITEM, ...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

/** Light-theme mega-menu: top-level headers, each opening a multi-column panel with
 *  a short description per screen. Same routes as the sidebar, grouped for discovery. */
interface MegaItem extends NavItem { desc: string }
const MEGA: { label: string; items: MegaItem[] }[] = [
  { label: "Overview", items: [
    { route: "control", label: "Control Room", icon: LayoutGrid, desc: "Every decision, at a glance" },
    { route: "start", label: "Get started", icon: Rocket, desc: "Set up from zero or explore the demo" },
  ] },
  { label: "Activity", items: [
    { route: "live", label: "Live Actions", icon: ListTree, desc: "Every action, decided the moment it runs" },
    { route: "agents", label: "Agents", icon: Bot, desc: "Who is acting, and how far they're trusted" },
    { route: "tasks", label: "Tasks", icon: ListChecks, desc: "Multi-step jobs under one scoped envelope" },
  ] },
  { label: "Policy", items: [
    { route: "intent", label: "Intent Studio", icon: FileCheck2, desc: "Write policy in plain English" },
    { route: "safety", label: "Safety Kernel", icon: ShieldCheck, desc: "Vendor-managed rules you can't switch off" },
    { route: "simulator", label: "Policy Simulator", icon: FlaskConical, desc: "Test a rule before it goes live" },
  ] },
  { label: "Authorization", items: [
    { route: "reviews", label: "Review Center", icon: Hand, desc: "Approve or deny a parked action" },
    { route: "standing", label: "Standing Permissions", icon: Timer, desc: "Everyday authority and budgets" },
    { route: "breakglass", label: "Break Glass", icon: Siren, desc: "Scoped, time-boxed emergency override" },
  ] },
  { label: "Visibility", items: [
    { route: "coverage", label: "Coverage Map", icon: Table2, desc: "What is enforced, degraded or pending" },
    { route: "trust", label: "Trust Graph", icon: Waypoints, desc: "How identity and trust connect" },
    { route: "evidence", label: "Evidence", icon: ScrollText, desc: "The tamper-evident decision log" },
  ] },
  { label: "More", items: [
    { route: "simlab", label: "Simulation Lab", icon: CirclePlay, desc: "Watch the engine decide, step by step" },
    { route: "integrations", label: "Integrations", icon: Plug, desc: "Connect runtimes and gateways" },
    { route: "vault", label: "Token Vault", icon: KeyRound, desc: "Reversible tokens and scoped restores" },
    { route: "brain", label: "Core Brain", icon: BrainCircuit, desc: "How a decision is actually made" },
    { route: "settings", label: "Settings", icon: SettingsIcon, desc: "Workspace and preferences" },
  ] },
];

/** Watches the live theme (data-theme attribute App.tsx's toggle sets). Light theme swaps
 *  the shell to a mega-menu header + icon rail; dark keeps the classic sidebar. */
function useIsLight() {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(document.documentElement.dataset.theme === "light"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => location.hash.slice(1) || "control");
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || "control");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const nav = (r: Route) => {
    location.hash = r;
    setRoute(r);
  };
  return [route, nav];
}

/** Dark / light theme — dark by default, the choice is remembered per browser. */
const THEME_KEY = "wrapbox-theme";
function useTheme(): ["light" | "dark", () => void] {
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark")
  );
  useEffect(() => {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable — theme still applies this session */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

/** ⌘K command palette — jump to any screen. */
function Palette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: (r: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(
    () => ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
    [q]
  );
  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);
  if (!open) return null;
  const go = (r: string) => { onClose(); nav(r); };
  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="palette" role="dialog">
        <div className="palette-input-row">
          <Search size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search screens…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter" && hits[sel]) go(hits[sel].route);
              if (e.key === "Escape") onClose();
            }}
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="palette-list">
          {hits.map((h, i) => (
            <button key={h.route} className={`palette-item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(h.route)}>
              <h.icon size={15} style={{ color: "var(--fg-3)" }} />
              {h.label}
            </button>
          ))}
          {hits.length === 0 && <div className="empty" style={{ padding: 18 }}>No screens match.</div>}
        </div>
      </div>
    </>
  );
}

/** Workspace switcher — the Veridian demo (three months in) or a fresh day-one workspace. */
function WorkspaceMenu({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) { setConfirmReset(false); return; }
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick = (ws: Workspace) => {
    setOpen(false);
    if (ws !== s.workspace) switchWorkspace(ws);
    nav(getState().onboarding.adminDone ? "control" : "start");
  };
  return (
    <div className="ws-menu" ref={ref}>
      {DESKTOP_SHELL ? (
        <button className="workspace-menu ws-switch" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
          <CompanyMark demo={s.workspace === "demo"} name={s.org.company || "New workspace"} />
          <span className="ws-switch-name">{s.org.company || "New workspace"}</span>
          <span className={`ws-switch-tag${s.workspace === "demo" ? "" : " fresh"}`}>{s.workspace === "demo" ? "Demo · 3 months in" : "Day one"}</span>
          <ChevronsUpDown size={14} className="ws-switch-chev" />
        </button>
      ) : (
      <button className="workspace-menu" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="workspace-dot" />
        {s.org.company || "New workspace"}
        <span className="faint">· {s.workspace === "demo" ? "Demo · 3 months in" : "Fresh workspace"}</span>
        <ChevronDown size={13} />
      </button>
      )}
      {open && (
        <div className="ws-pop" role="menu">
          <div className="ws-pop-label">Workspaces</div>
          <button className="ws-item" role="menuitem" onClick={() => pick("demo")}>
            {DESKTOP_SHELL && <CompanyMark demo name={ORG.name} size={30} />}
            <span><b>{ORG.name}</b><span className="ws-sub">Demo · a company three months in</span></span>
            {s.workspace === "demo" && <Check size={14} />}
          </button>
          <button className="ws-item" role="menuitem" onClick={() => pick("fresh")}>
            {DESKTOP_SHELL && <CompanyMark demo={false} name="Fresh workspace" size={30} />}
            <span><b>Fresh workspace</b><span className="ws-sub">Day one · you set it up from zero</span></span>
            {s.workspace === "fresh" && <Check size={14} />}
          </button>
          <div className="ws-sep" />
          {!confirmReset ? (
            <button className="ws-item" role="menuitem" onClick={() => setConfirmReset(true)}>
              <span className="row" style={{ gap: 8 }}><RotateCcw size={14} /> Start the fresh workspace over</span>
            </button>
          ) : (
            <div className="ws-confirm">
              Erase the fresh workspace and begin again from day one? The {ORG.short} demo is not touched.
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn btn-danger btn-sm" onClick={() => { startFreshWorkspace(); setOpen(false); nav("onboarding/admin"); }}>Start over</button>
                <button className="btn btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            </div>
          )}
          <button className="ws-item" role="menuitem" onClick={() => { setOpen(false); nav("start"); }}>
            <span className="row" style={{ gap: 8 }}><Rocket size={14} /> Get started</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Second nav bar (light shell): the Safety Kernel release channel. Shows a real
 *  pending release when there is one, otherwise the installed version — never a
 *  made-up announcement. */
function KernelBar({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const pending = pendingRelease(s.kernel);
  const installed = KERNEL_RELEASES.find((r) => r.version === s.kernel.version);
  const rules = installedRules(s.kernel).length;
  const observing = Object.values(s.kernel.modes).filter((m) => m === "observing").length;
  return (
    <div className="subbar">
      {pending ? (
        <>
          <span className="subbar-dot" aria-hidden="true" />
          <span className="subbar-text">
            <b>Update available now</b>
            <span className="subbar-sep">·</span>
            Safety Kernel {pending.version} — {pending.notes[0].replace(/^New rule:\s*/, "")}
          </span>
          <button className="subbar-link" onClick={() => nav("safety")}>Review &amp; install <ArrowRight size={13} /></button>
        </>
      ) : (
        <>
          <span className="subbar-text">
            Safety Kernel <b>{installed?.version ?? s.kernel.version}</b> is up to date
            <span className="subbar-sep">·</span>
            {rules} always-on rules{observing > 0 ? ` · ${observing} observing` : ""}
          </span>
          <button className="subbar-link" onClick={() => nav("safety")}>Release notes <ArrowRight size={13} /></button>
        </>
      )}
    </div>
  );
}

function Topbar({ nav, onPalette }: { nav: (r: string) => void; onPalette: () => void }) {
  const s = useAppState();
  const [theme, toggleTheme] = useTheme();
  const m = metrics(s);
  const activeRules = s.contracts.filter((c) => c.status === "ACTIVE").reduce((n, c) => n + c.clauses.length, 0);
  return (
    <header className="topbar">
      <button className="sidebar-brand" onClick={() => nav("control")} aria-label="Wrapbox home">
        <WrapboxWordmark tone={theme === "dark" ? "dark" : "light"} height={28} className="logo" />
      </button>
      <span className="topbar-div" />
      <WorkspaceMenu nav={nav} />
      <button className="topbar-search" onClick={onPalette}>
        <Search size={15} />
        Search screens…
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {m.pendingReviews > 0 && (
          <button className="pill pill-review" onClick={() => nav("reviews")}>
            <span className="pill-dot" style={{ background: "var(--review)" }} />
            {m.pendingReviews} pending {m.pendingReviews === 1 ? "review" : "reviews"}
          </button>
        )}
        <span className="pill pill-ok">
          <span className="pill-dot live-dot" style={{ background: "var(--allow)" }} />
          Enforcing {activeRules} rules
        </span>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Avatar userId="u-priya" size={28} />
      </div>
    </header>
  );
}

function NavLink({ it, active, onClick, badge }: { it: NavItem; active: boolean; onClick: () => void; badge?: number | string }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      {active && <span className="nav-active-bar" />}
      <it.icon size={16} strokeWidth={1.8} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
      {typeof badge === "number" && badge > 0 && <span className="badge-count">{badge}</span>}
      {typeof badge === "string" && <span className="badge-setup">{badge}</span>}
    </button>
  );
}

/* ── Light-theme shell: icon rail + mega-menu header (dark keeps the classic sidebar) ── */

// Expandable dark rail: collapsed to icons, expands to labels on hover (a flyout
// sidebar). Rendered in light theme only; the header carries the brand.
function RailBtn({ it, active, onClick, dot }: { it: NavItem; active: boolean; onClick: () => void; dot?: boolean }) {
  return (
    <button className={`rail-item ${active ? "active" : ""}`} onClick={onClick}>
      <it.icon size={19} strokeWidth={1.9} />
      <span className="rail-label">{it.label}</span>
      {dot && <span className="rail-dot" />}
    </button>
  );
}

function IconRail({ nav, base, pendingReviews }: { nav: (r: string) => void; base: string; pendingReviews: number }) {
  const [theme, toggleTheme] = useTheme();
  return (
    <aside className="rail">
      <div className="rail-inner">
        <nav className="rail-nav">
          <RailBtn it={START_ITEM} active={base === "start"} onClick={() => nav("start")} />
          {NAV.map((g, gi) => (
            <div key={gi} className="rail-grp">
              {g.group && <div className="rail-grp-label">{g.group}</div>}
              {g.items.map((it) => (
                <RailBtn key={it.route} it={it} active={base === it.route} onClick={() => nav(it.route)} dot={it.route === "reviews" && pendingReviews > 0} />
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-bottom">
          <RailBtn it={SETTINGS_ITEM} active={base === "settings"} onClick={() => nav("settings")} />
          <button className="rail-item" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
            <span className="rail-label">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function MegaTopbar({ nav, base, onPalette, pendingReviews, activeRules }: { nav: (r: string) => void; base: string; onPalette: () => void; pendingReviews: number; activeRules: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <header className="megatop" onMouseLeave={() => setOpen(null)}>
      <div className="megatop-row">
        <button className="sidebar-brand" onClick={() => nav("control")} aria-label="Wrapbox home">
          <WrapboxWordmark tone="light" />
        </button>
        <span className="topbar-div" />
        <WorkspaceMenu nav={nav} />
        <nav className="megatop-nav" aria-label="Primary">
          {MEGA.map((g, i) => (
            <div key={g.label} className="megatop-item" onMouseEnter={() => setOpen(i)}>
              <button
                className={`megatop-link ${open === i ? "open" : ""} ${g.items.some((it) => it.route === base) ? "active" : ""}`}
                onClick={() => { const first = g.items[0]; if (first) nav(first.route); }}
              >
                {g.label}
                <ChevronDown size={14} className="megatop-caret" />
              </button>
            </div>
          ))}
        </nav>
        <div className="megatop-right">
          <button className="topbar-search megatop-search" onClick={onPalette} aria-label="Search">
            <Search size={15} />
            <span className="megatop-search-txt">Search…</span>
            <span style={{ display: "flex", gap: 4 }}><kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd></span>
          </button>
          {pendingReviews > 0 && (
            <button className="pill pill-review" onClick={() => nav("reviews")}>
              <span className="pill-dot" style={{ background: "var(--review)" }} />
              {pendingReviews} pending
            </button>
          )}
          <span className="pill pill-ok">
            <span className="pill-dot live-dot" style={{ background: "var(--allow)" }} />
            Enforcing {activeRules} rules
          </span>
          <Avatar userId="u-priya" size={28} />
        </div>
      </div>
      {open !== null && (
        <div className="mega-panel" onMouseEnter={() => setOpen(open)}>
          <div className="mega-inner">
            <div className="mega-head">{MEGA[open].label}</div>
            <div className="mega-cols">
              {MEGA[open].items.map((it) => (
                <button key={it.route} className={`mega-cell ${it.route === base ? "active" : ""}`} onClick={() => { nav(it.route); setOpen(null); }}>
                  <span className="mega-ic"><it.icon size={18} strokeWidth={1.8} /></span>
                  <span className="mega-txt"><b>{it.label}</b><small>{it.desc}</small></span>
                  {it.route === "reviews" && pendingReviews > 0 && <span className="badge-count" style={{ marginLeft: "auto" }}>{pendingReviews}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function App() {
  const state = useAppState();
  const [route, nav] = useRoute();
  const light = useIsLight();
  const [palette, setPalette] = useState(false);
  const m = metrics(state);
  const base = route.split("/")[0];
  const mainRef = useRef<HTMLElement>(null);

  // Parallax: publish the scroll offset of the content area as --sy.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => el.style.setProperty("--sy", String(Math.round(el.scrollTop)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Every page opens at the top — no scroll position carried over from the previous page.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    el.style.setProperty("--sy", "0");
  }, [base]);
  const demoOn = state.demoStep >= 0;
  const focus = base === "onboarding"; // setup wizards take the full width

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const page = (() => {
    switch (base) {
      case "control": return <ControlRoom nav={nav} />;
      case "live": return <LiveActions nav={nav} />;
      case "agents": return <AgentsPage nav={nav} route={route} />;
      case "tasks": return <TasksPage nav={nav} />;
      case "intent": return <IntentStudio nav={nav} route={route} />;
      case "safety": return <SafetyKernelPage nav={nav} />;
      case "simulator": return <PolicySimulator nav={nav} />;
      case "reviews": return <ReviewCenter nav={nav} />;
      case "standing": return <StandingPage nav={nav} />;
      case "breakglass": return <BreakGlassPage nav={nav} />;
      case "coverage": return <CoverageMap nav={nav} />;
      case "trust": return <TrustGraph nav={nav} />;
      case "evidence": return <EvidenceExplorer nav={nav} route={route} />;
      case "simlab": return <SimulationLab nav={nav} route={route} />;
      case "integrations": return <IntegrationsPage nav={nav} />;
      case "vault": return <TokenVaultPage nav={nav} />;
      case "brain": return <CoreBrainPage nav={nav} />;
      case "settings": return <SettingsPage nav={nav} />;
      case "start": return <StartPage nav={nav} />;
      case "onboarding": return route.split("/")[1] === "employee" ? <EmployeeOnboarding nav={nav} /> : <AdminOnboarding nav={nav} />;
      default: return <ControlRoom nav={nav} />;
    }
  })();

  const activeRules = state.contracts.filter((c) => c.status === "ACTIVE").reduce((n, c) => n + c.clauses.length, 0);

  // Light theme swaps to the mega-menu header + icon rail; dark keeps the classic sidebar.
  // The live prototype (DESKTOP_SHELL) uses the sidebar shell in both themes.
  if (light && !DESKTOP_SHELL) {
    return (
      <div className="shell-col light-shell">
        <Topbar nav={nav} onPalette={() => setPalette(true)} />
        <KernelBar nav={nav} />
        <div className="shell">
          {!focus && <IconRail nav={nav} base={base} pendingReviews={m.pendingReviews} />}
          <main className="main" ref={mainRef} style={demoOn ? { paddingBottom: 90 } : undefined}>
            <div className="parallax-bg" aria-hidden="true" />
            <div key={base} className="route-anim">{page}</div>
          </main>
        </div>
        {demoOn && <DemoBar nav={nav} />}
        <Palette open={palette} onClose={() => setPalette(false)} nav={nav} />
      </div>
    );
  }

  return (
    <div className="shell-col">
      <Topbar nav={nav} onPalette={() => setPalette(true)} />
      <div className="shell">
        {!focus && <aside className="sidebar">
          <nav className="sidebar-nav">
            <div className="nav-group first">
              <div className="nav-group-items">
                <NavLink it={START_ITEM} active={base === "start"} onClick={() => nav("start")} badge={state.onboarding.adminDone ? undefined : "Setup"} />
              </div>
            </div>
            {NAV.map((g, gi) => (
              <div key={gi} className={gi > 0 ? "nav-group" : "nav-group first"}>
                {g.group && <div className="nav-group-label">{g.group}</div>}
                <div className="nav-group-items">
                  {g.items.map((it) => (
                    <NavLink
                      key={it.route}
                      it={it}
                      active={base === it.route}
                      onClick={() => nav(it.route)}
                      badge={it.route === "reviews" ? m.pendingReviews : it.route === "safety" && pendingRelease(state.kernel) ? "Update" : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <NavLink it={{ route: "settings", label: "Settings", icon: SettingsIcon }} active={base === "settings"} onClick={() => nav("settings")} />
            {!demoOn && (
              <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} onClick={() => DEMO_SCRIPT.start(nav)}>
                <Play size={13} /> Demo Mode
              </button>
            )}
            <div className="faint" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="Wrapbox Real Prototype · integrations simulated · product behavior live">
              Prototype · integrations simulated · behavior live
            </div>
          </div>
        </aside>}
        <main className="main" ref={mainRef} style={demoOn ? { paddingBottom: 90 } : undefined}>
          <div className="parallax-bg" aria-hidden="true" />
          <div key={base} className="route-anim">{page}</div>
        </main>
      </div>
      {demoOn && <DemoBar nav={nav} />}
      <Palette open={palette} onClose={() => setPalette(false)} nav={nav} />
    </div>
  );
}
