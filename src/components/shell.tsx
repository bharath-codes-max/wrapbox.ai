import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Clapperboard,
  ChevronsUpDown,
  CircleCheck,
  CirclePlay,
  Download,
  FileCheck2,
  FlaskConical,
  Hand,
  Info,
  Laptop,
  ShieldCheck,
  Settings as SettingsIcon,
  KeyRound,
  LayoutGrid,
  ListTree,
  Lock,
  Menu,
  Network,
  OctagonX,
  Plus,
  RotateCcw,
  Rocket,
  Search,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AGENTS, CATEGORIES, agentById } from "../data/agents";
import { SCENARIOS } from "../data/scenarios";
import type { Env } from "../lib/engine";
import { KID } from "../lib/permit";
import { go } from "../lib/router";
import { ADMIN, EMPLOYEE, VISIBLE_WORKSPACES, WORKSPACES, getState, regionLabel, resetFresh, setState, switchWorkspace, tourFor, useStore, useWorkspace, workspaceHasData, workspaceSummary, type Role, type WorkspaceId } from "../lib/store";
import { PasskeyModal } from "./insight";
import { WrapboxWordmark } from "./logo";
import { useNavStyle } from "../lib/navstyle";
import { Avatar, CompanyMark, Kbd, Logo, PersonFigure, cn } from "./ui";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Bot;
  badge?: number | string;
  adminOnly?: boolean;
  tone?: "review" | "accent";
  /** Prototype scaffolding: shown only in workspaces that exist to explain and test Wrapbox. */
  labs?: boolean;
}

function useNav(role: Role): { section?: string; items: NavItem[] }[] {
  const pending = useStore((s) => s.approvals.filter((a) => a.status === "pending").length);
  const myPending = useStore((s) => s.approvals.filter((a) => a.status === "pending" && a.approvers.some((p) => p.id === EMPLOYEE.id)).length);
  const connectedCount = useStore((s) => Object.keys(s.connected).length);
  const requests = useStore((s) => s.requests.filter((r) => r.status === "pending").length);
  const onboarded = useStore((s) => s.onboarded);
  const ruleCount = useStore((s) => s.published.length);
  const { labs, fabric } = useWorkspace();
  if (fabric)
    return role === "admin"
      ? [
          { items: [{ path: "/onboarding/admin", label: onboarded.admin ? "Deployment walkthrough" : "Get started", icon: Rocket, badge: onboarded.admin ? undefined : "Setup", tone: "accent" }] },
          { section: "Enforce", items: [{ path: "/", label: "Fleet", icon: Laptop }, { path: "/gateway", label: "Gateway", icon: Network }] },
          { section: "Deploy", items: [{ path: "/downloads", label: "Downloads", icon: Download }, { path: "/docs", label: "Docs", icon: BookOpen }] },
          { section: "Govern", items: [{ path: "/contract", label: "Intent contract", icon: FileCheck2, badge: ruleCount || undefined }] },
          { section: "Operate", items: [{ path: "/approvals", label: "Approvals", icon: Hand, badge: pending || undefined, tone: "review" }, { path: "/evidence", label: "Evidence", icon: ListTree }] },
        ]
      : [
          { items: [{ path: "/", label: "My device", icon: Laptop }] },
          { section: "My work", items: [{ path: "/contract", label: "Rules for me", icon: FileCheck2 }, { path: "/approvals", label: "My approvals", icon: Hand, badge: myPending || undefined, tone: "review" }, { path: "/evidence", label: "My activity", icon: ListTree }] },
          { section: "Deploy", items: [{ path: "/downloads", label: "Install the Runtime", icon: Download }, { path: "/docs/runtime", label: "Docs", icon: BookOpen }] },
          { section: "Admin only", items: [{ path: "/gateway", label: "Gateway", icon: Network, adminOnly: true }] },
        ];
  const groups: { section?: string; items: NavItem[] }[] = role === "admin" ? [
      {
        items: [
          { path: "/start", label: "Get started", icon: Rocket, badge: onboarded.admin ? undefined : "Setup", tone: "accent" },
          { path: "/", label: "Overview", icon: LayoutGrid },
        ],
      },
      {
        section: "Govern",
        items: [
          { path: "/agents", label: "Agents", icon: Bot, badge: connectedCount || undefined },
          { path: "/contract", label: "Intent contract", icon: FileCheck2, badge: ruleCount || undefined },
          { path: "/gateway", label: "MCP gateway", icon: Network },
        ],
      },
      {
        section: "Operate",
        items: [
          { path: "/playground", label: "Playground", icon: FlaskConical, labs: true },
          { path: "/flows", label: "Happy flows", icon: CirclePlay, labs: true },
          { path: "/approvals", label: "Approvals", icon: Hand, badge: pending || undefined, tone: "review" },
          { path: "/evidence", label: "Evidence", icon: ListTree },
        ],
      },
      { section: "Organization", items: [{ path: "/team", label: "Team & devices", icon: Users, badge: requests || undefined, tone: "review" }] },
    ]
  : [
    {
      items: [
        { path: "/onboarding/employee", label: "Get started", icon: Rocket, badge: onboarded.employee ? undefined : "Setup", tone: "accent" },
        { path: "/", label: "My workspace", icon: LayoutGrid },
      ],
    },
    {
      section: "My work",
      items: [
        { path: "/agents", label: "My agents", icon: Bot },
        { path: "/contract", label: "Rules for me", icon: FileCheck2 },
        { path: "/playground", label: "Playground", icon: FlaskConical, labs: true },
        { path: "/flows", label: "Happy flows", icon: CirclePlay, labs: true },
        { path: "/approvals", label: "My approvals", icon: Hand, badge: myPending || undefined, tone: "review" },
        { path: "/evidence", label: "My activity", icon: ListTree },
      ],
    },
    {
      section: "Admin only",
      items: [
        { path: "/gateway", label: "MCP gateway", icon: Network, adminOnly: true },
        { path: "/team", label: "Team & devices", icon: Users, adminOnly: true },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, items: g.items.filter((it) => !it.labs || labs) }));
}

function isActive(path: string, current: string) {
  if (path === "/") return current === "/" || current.startsWith("/fleet");
  if (path === "/start") return current === "/start" || current.startsWith("/onboarding/admin");
  return current === path || current.startsWith(path + "/");
}

function NavLink({ it, current, onNavigate, lead }: { it: NavItem; current: string; onNavigate?: () => void; lead?: boolean }) {
  const active = isActive(it.path, current);
  // The lead accent item is the setup call to action: carry the brand gradient so it reads as one.
  if (lead && it.tone === "accent")
    return (
      <a
        href={"#" + it.path}
        onClick={onNavigate}
        className={cn("group relative flex items-center gap-2.5 rounded-xl px-3 h-11 text-[13.5px] font-medium text-white overflow-hidden shadow-[0_6px_16px_-8px_rgba(236,74,34,0.55)] transition-transform hover:-translate-y-px", active && "ring-2 ring-fg/15")}
      >
        <span className="prism-swatch absolute inset-0" aria-hidden />
        <it.icon className="relative size-4 shrink-0" strokeWidth={2} />
        <span className="relative truncate">{it.label}</span>
        {it.badge !== undefined ? (
          <span className="relative ml-auto rounded-full bg-white/25 px-1.5 py-px text-[10.5px] font-semibold backdrop-blur-sm">{it.badge}</span>
        ) : (
          <ArrowRight className="relative ml-auto size-3.5 opacity-80 transition-transform group-hover:translate-x-0.5" />
        )}
      </a>
    );
  return (
    <a
      href={"#" + it.path}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13.5px] transition-colors",
        // Flat by default; the active row is the only one that draws a surface.
        active ? "bg-accent-soft text-accent font-medium" : "text-fg-2 hover:text-fg hover:bg-surface-2",
        it.adminOnly && "opacity-60",
      )}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent" />}
      <it.icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-3 group-hover:text-fg-2")} strokeWidth={1.8} />
      <span className="truncate">{it.label}</span>
      {it.adminOnly ? (
        <Lock className="ml-auto size-3.5 text-fg-3" />
      ) : it.badge !== undefined ? (
        <span className={cn("ml-auto rounded-full px-1.5 text-[11px] font-semibold tnum", it.tone === "review" ? "bg-review-soft text-review" : it.tone === "accent" ? "bg-ink text-ink-fg" : "bg-surface-3 text-fg-2")}>{it.badge}</span>
      ) : null}
    </a>
  );
}

function Sidebar({ current, onNavigate }: { current: string; onNavigate?: () => void }) {
  const role = useStore((s) => s.role);
  const workspace = useStore((s) => s.workspace);
  const company = useStore((s) => s.company);
  const nav = useNav(role);
  const me = role === "admin" ? ADMIN : EMPLOYEE;
  return (
    <div className="flex h-full flex-col">
      {/* Classic flat nav: section labels sit directly on the page, items carry
          no chrome of their own. Only the active row is drawn, so the eye finds
          "where am I" instantly instead of parsing four nested boxes. */}
      <nav className="flex-1 overflow-y-auto scroll-thin px-3 pt-3 pb-3">
        {nav.map((g, gi) =>
          // The lead group is a call to action, not a section — it keeps its own emphasis.
          g.section ? (
            <div key={gi} className={cn(gi > 0 && "mt-6")}>
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-fg-3">{g.section}</div>
              <div className="space-y-px">
                {g.items.map((it) => (
                  <NavLink key={it.path} it={it} current={current} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          ) : (
            <div key={gi} className={cn(gi > 0 && "mt-6")}>
              {g.items.map((it) => (
                <NavLink key={it.path} it={it} current={current} onNavigate={onNavigate} lead />
              ))}
            </div>
          ),
        )}
      </nav>
      <div className="px-3 pb-2 pt-2 space-y-px border-t border-line">
        <NavLink it={{ path: "/settings", label: "Settings", icon: SettingsIcon }} current={current} onNavigate={onNavigate} />
        <NavLink it={{ path: "/welcome", label: "About Wrapbox", icon: Info }} current={current} onNavigate={onNavigate} />
      </div>
      <ProfileSwitcher me={me} role={role} company={company} fresh={workspace === "fresh"} />
    </div>
  );
}

const ROLE_BADGE: Record<Role, ReactNode> = {
  admin: <ShieldCheck className="size-[9px]" strokeWidth={3} />,
  employee: <Laptop className="size-[9px]" strokeWidth={2.6} />,
};

/** Bottom-of-sidebar profile: who you're viewing as, and a menu to switch between the admin and an employee. */
function ProfileSwitcher({ me, role, company, fresh }: { me: typeof ADMIN; role: Role; company: string; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", click);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const opts: { v: Role; p: typeof ADMIN; title: string; sub: string }[] = [
    { v: "admin", p: ADMIN, title: "Admin", sub: "Owner · sets the rules and approves" },
    { v: "employee", p: EMPLOYEE, title: "Employee", sub: "Engineer · runs agents, asks for access" },
  ];
  return (
    <div ref={ref} className="relative mx-2.5 mb-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-full left-0 mb-2 z-50 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-surface shadow-float"
            role="menu"
          >
            <div className="px-3 pt-2.5 pb-1.5 eyebrow !text-[10.5px]">View Wrapbox as</div>
            <div className="px-1.5 pb-1.5 space-y-0.5">
              {opts.map((o) => (
                <button
                  key={o.v}
                  role="menuitemradio"
                  aria-checked={role === o.v}
                  onClick={() => {
                    setState({ role: o.v });
                    setOpen(false);
                  }}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors", role === o.v ? "bg-surface-2" : "hover:bg-surface-2")}
                >
                  <PersonFigure p={o.p} size={32} badge={ROLE_BADGE[o.v]} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold">
                      {o.p.name}
                      <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", o.v === "admin" ? "bg-[#111113] text-white" : "bg-surface-3 text-fg-2")}>{o.title}</span>
                    </span>
                    <span className="block text-[11px] leading-snug text-fg-3">{o.sub}</span>
                  </span>
                  {role === o.v && <Check className="size-4 shrink-0 text-fg" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("flex w-full items-center gap-2.5 rounded-xl border bg-surface p-2.5 text-left transition-colors", open ? "border-line-strong" : "border-line hover:border-line-strong")}
      >
        <PersonFigure p={me} size={34} badge={ROLE_BADGE[role]} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold truncate">{me.name}</span>
            <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold", role === "admin" ? "bg-[#111113] text-white" : "bg-surface-3 text-fg-2")}>{role === "admin" ? "Admin" : "Employee"}</span>
          </span>
          <span className="block text-[11.5px] text-fg-3 truncate">
            {company}
            {fresh ? " · fresh" : ""} · switch view
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-fg-3" />
      </button>
    </div>
  );
}

const TITLES: [string, string][] = [
  ["/welcome", "About Wrapbox"],
  ["/settings", "Settings"],
  ["/start", "Get started"],
  ["/onboarding/admin", "Admin setup"],
  ["/onboarding/employee", "Employee setup"],
  ["/agents", "Agents"],
  ["/contract", "Intent contract"],
  ["/gateway", "MCP gateway"],
  ["/playground", "Playground"],
  ["/flows", "Happy flows"],
  ["/approvals", "Approvals"],
  ["/evidence", "Evidence"],
  ["/team", "Team & devices"],
  ["/", "Overview"],
];
const FABRIC_TITLES: [string, string][] = [
  ["/", "Fleet"],
  ["/gateway", "Gateway"],
  ["/downloads", "Downloads"],
  ["/docs", "Docs"],
  ["/docs/runtime", "Runtime docs"],
  ["/docs/gateway", "Gateway docs"],
  ["/contract", "Intent contract"],
  ["/approvals", "Approvals"],
  ["/evidence", "Evidence"],
  ["/settings", "Settings"],
  ["/welcome", "About Wrapbox"],
];

const ENVS: { id: "all" | Env; label: string; dot: string; note: string }[] = [
  { id: "all", label: "All environments", dot: "bg-(--n-fg-3)", note: "every decision" },
  { id: "production", label: "Production", dot: "bg-[#3fd49b]", note: "customer-facing systems" },
  { id: "staging", label: "Staging", dot: "bg-[#f4b453]", note: "cloud runners, previews" },
  { id: "development", label: "Development", dot: "bg-[#9db4ff]", note: "laptops and sandboxes" },
];

const WS_ICON: Record<WorkspaceId, typeof Bot> = { v2: Rocket, live: Clapperboard, fabric: ShieldCheck, fresh: Plus };
const WS_SHORT: Record<WorkspaceId, string> = { v2: "v2", live: "live", fabric: "fabric", fresh: "fresh" };

function WorkspaceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const workspace = useStore((s) => s.workspace);
  const company = useStore((s) => s.company);
  const region = useStore((s) => s.region);
  const domain = useStore((s) => s.domain);
  const idp = useStore((s) => s.idp);
  const envFilter = useStore((s) => s.envFilter);
  const events = useStore((s) => s.events);
  const connectedCount = useStore((s) => Object.keys(s.connected).length);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: events.length, production: 0, staging: 0, development: 0 };
    // Evt.env is optional now — live CP events carry no environment, so they
    // count toward no bucket and the picker below collapses the empty ones.
    for (const e of events) if (e.env) m[e.env] = (m[e.env] ?? 0) + 1;
    return m;
  }, [events]);
  useEffect(() => {
    const k = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", k);
    return () => window.removeEventListener("mousedown", k);
  }, []);
  const env = ENVS.find((e) => e.id === envFilter)!;
  const pickWs = (id: WorkspaceId) => {
    switchWorkspace(id);
    setOpen(false);
    go(id === "fresh" && !workspaceHasData("fresh") ? "/start" : "/");
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className={cn("flex items-center gap-2.5 rounded-xl h-10 pl-2 pr-2.5 transition-colors ring-1", open ? "bg-(--n-soft-2) ring-(--n-ring-2)" : "bg-(--n-soft) ring-(--n-ring) hover:bg-(--n-soft-2)")}>
        <CompanyMark name={company} size={24} className="rounded-md" />
        <span className="text-left leading-tight">
          <span className="block text-[12.5px] font-semibold text-(--n-fg)">
            {company}
            {VISIBLE_WORKSPACES.length > 1 && <span className="font-normal text-(--n-fg-3)"> · {WS_SHORT[workspace]}</span>}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-(--n-fg-2)">
            <span className={cn("size-1.5 rounded-full", env.dot)} />
            {env.label}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 text-(--n-fg-3)" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} className="absolute left-0 top-12 z-50 w-[360px] rounded-2xl border border-line bg-surface text-fg shadow-float overflow-hidden">
            <div className="flex items-center gap-3 px-4 pt-4 pb-3.5 border-b border-line">
              <CompanyMark name={company} size={36} className="rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold truncate">{company}</div>
                <div className="text-[11.5px] text-fg-3 truncate">
                  {domain} · {regionLabel(region)}
                </div>
              </div>
              {idp && <Logo name={idp.toLowerCase().includes("okta") ? "okta" : "microsoft"} size={20} rounded="rounded" />}
            </div>
            {VISIBLE_WORKSPACES.length > 1 && <div className="px-4 pt-3.5 pb-2 eyebrow">Workspace</div>}
            <div className={cn("px-2 space-y-1", VISIBLE_WORKSPACES.length <= 1 && "hidden")}>
              {VISIBLE_WORKSPACES.map((id) => {
                const meta = WORKSPACES[id];
                const sum = workspaceSummary(id);
                const Icon = WS_ICON[id];
                const title = id === "fresh" ? meta.label : `${sum.company} · ${meta.label}`;
                const desc =
                  id === "fresh"
                    ? workspaceHasData("fresh")
                      ? `Your own build · ${workspace === "fresh" ? connectedCount : sum.agents} agents · resumes where you left off`
                      : meta.blurb
                    : `${sum.agents} agents connected · ${sum.approvals} approvals waiting · contract v${sum.version}`;
                return (
                  <button key={id} onClick={() => pickWs(id)} className={cn("flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors", workspace === id ? "bg-surface-2" : "hover:bg-surface-2")}>
                    <span className={cn("mt-0.5 grid size-8 place-items-center rounded-lg shrink-0", id === "fresh" ? "border border-dashed border-line-strong" : "bg-surface-2 border border-line")}>
                      <Icon className="size-4 text-fg-2" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{title}</span>
                      <span className="block text-[11.5px] text-fg-3 leading-snug">{desc}</span>
                    </span>
                    {workspace === id && <Check className="size-4 text-fg mt-1" />}
                  </button>
                );
              })}
            </div>
            {VISIBLE_WORKSPACES.includes("fresh") && workspaceHasData("fresh") && (
              <button
                onClick={() => {
                  resetFresh();
                  setOpen(false);
                  if (getState().workspace === "fresh") go("/start");
                }}
                className="mx-4 mt-1 inline-flex items-center gap-1.5 text-[11.5px] text-fg-3 hover:text-block"
              >
                <RotateCcw className="size-3" /> Reset the fresh workspace
              </button>
            )}
            <div className={cn("border-t border-line px-4 pt-3 pb-2 eyebrow", VISIBLE_WORKSPACES.length > 1 ? "mt-2" : "border-t-0")}>Environment</div>
            <div className="px-2 pb-2 grid grid-cols-2 gap-1">
              {/* Only environments this tenant actually runs in — an empty one is noise, not a choice. */}
              {ENVS.filter((e) => e.id === "all" || (counts[e.id] ?? 0) > 0 || envFilter === e.id).map((e) => (
                <button key={e.id} onClick={() => setState({ envFilter: e.id })} className={cn("rounded-xl px-2.5 py-2 text-left transition-colors border", envFilter === e.id ? "border-fg bg-surface" : "border-transparent hover:bg-surface-2")}>
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    <span className={cn("size-2 rounded-full", e.dot.replace("bg-(--n-fg-3)", "bg-fg-3"))} />
                    {e.label}
                  </span>
                  <span className="block text-[11px] text-fg-3">
                    {counts[e.id] ?? 0} decisions · {e.note}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-[11px] text-fg-3">
              <KeyRound className="size-3" /> Signing key {KID} · ECDSA P-256 · region {regionLabel(region)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const kill = useStore((s) => s.killSwitch);
  const live = useStore((s) => s.live);
  const events = useStore((s) => s.events.length);
  const ruleCount = useStore((s) => s.published.length);
  const fleet = useStore((s) => s.fleet);
  const workspace = useStore((s) => s.workspace);
  const { labs, fabric } = useWorkspace();
  const nav = useNavStyle();
  // v2 is the only live Control-Plane-backed workspace. There `ruleCount` is a
  // row count in the CP rules table — it proves a rule exists, never that any
  // device pulled it or is enforcing it — and the CP's default posture is
  // fail-closed BLOCK. fabric/fresh are the simulated prototype, where the local
  // engine genuinely enforces the rules and defaults to ALLOW when none match,
  // so the older "Enforcing / allowing everything" copy is true there.
  const cpBacked = workspace === "v2";
  // Enforcement is real only on a device that has actually pulled the ruleset
  // and is still reporting; an unmapped/absent pull timestamp counts as 0.
  const enforcing = cpBacked ? fleet.filter((d) => (d.rulesetPulledAt ?? 0) > 0 && d.state !== "heartbeat-lost").length : 0;
  return (
    <header data-nav={nav} className="wb-nav relative sticky top-0 z-40 flex items-center gap-3 h-[68px] px-4 lg:px-5 border-b border-(--n-edge) transition-[background,color] duration-300">
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--n-glow),transparent)]" />
      <button onClick={onMenu} className="lg:hidden grid size-9 place-items-center rounded-lg hover:bg-(--n-soft-2)" aria-label="Open menu">
        <Menu className="size-4.5" />
      </button>
      <a href="#/" aria-label="Wrapbox home" className="shrink-0">
        <WrapboxWordmark tone={nav === "light" ? "light" : "dark"} />
      </a>
      <span className="hidden md:block h-7 w-px bg-(--n-ring) mx-1" />
      <div className="hidden md:block">
        <WorkspaceMenu />
      </div>
      <button
        onClick={() => setState({ palette: true })}
        className="ml-2 hidden lg:flex items-center gap-2.5 h-10 w-[min(420px,32vw)] rounded-xl bg-(--n-soft) ring-1 ring-(--n-ring) px-3.5 text-[13px] text-(--n-fg-3) hover:bg-(--n-soft-2) hover:text-(--n-fg-2) transition-colors"
      >
        <Search className="size-4" />
        {labs ? "Search agents, rules, flows, people…" : fabric ? "Search devices, agents, rules, people…" : "Search agents, rules, people…"}
        <span className="ml-auto flex items-center gap-1">
          <kbd className="grid h-5 min-w-5 place-items-center rounded-md bg-(--n-soft-2) px-1 font-mono text-[10.5px] text-(--n-fg-2)">⌘</kbd>
          <kbd className="grid h-5 min-w-5 place-items-center rounded-md bg-(--n-soft-2) px-1 font-mono text-[10.5px] text-(--n-fg-2)">K</kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        {kill ? (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#ff6e8a]/15 text-(--n-bad-fg) ring-1 ring-[#ff6e8a]/30 px-3 h-8 text-[12px] font-semibold">
            <OctagonX className="size-3.5" /> Kill switch on
          </span>
        ) : cpBacked ? (
          // Live posture. A green "enforcing" claim requires devices that have
          // actually pulled the ruleset; a published-but-unpulled ruleset and the
          // fail-closed default both read as neutral, never as active enforcement.
          ruleCount && enforcing ? (
            <span className="hidden xl:inline-flex items-center gap-2 rounded-full bg-(--n-ok-bg) ring-1 ring-(--n-ok-ring) px-3 h-8 text-[12px] font-medium text-(--n-ok-fg)">
              <span className={cn("size-1.5 rounded-full bg-(--n-ok-dot)", live && "live-dot")} />
              {ruleCount} {ruleCount === 1 ? "rule" : "rules"} · enforcing on {enforcing}/{fleet.length} {fleet.length === 1 ? "device" : "devices"}
            </span>
          ) : ruleCount ? (
            <span className="hidden xl:inline-flex items-center gap-2 rounded-full ring-1 ring-(--n-ring) px-3 h-8 text-[12px] text-(--n-fg-2)">
              <span className="size-1.5 rounded-full bg-(--n-fg-3)" />
              {ruleCount} {ruleCount === 1 ? "rule" : "rules"} published · no device has pulled them yet
            </span>
          ) : (
            <span className="hidden xl:inline-flex items-center gap-2 rounded-full ring-1 ring-(--n-ring) px-3 h-8 text-[12px] text-(--n-fg-2)">
              <span className="size-1.5 rounded-full bg-(--n-fg-3)" />
              {events ? "No rules — blocking by default" : "Waiting for your first agent"}
            </span>
          )
        ) : ruleCount ? (
          <span className="hidden xl:inline-flex items-center gap-2 rounded-full bg-(--n-ok-bg) ring-1 ring-(--n-ok-ring) px-3 h-8 text-[12px] font-medium text-(--n-ok-fg)">
            <span className={cn("size-1.5 rounded-full bg-(--n-ok-dot)", live && "live-dot")} />
            Enforcing {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
          </span>
        ) : (
          <span className="hidden xl:inline-flex items-center gap-2 rounded-full ring-1 ring-(--n-ring) px-3 h-8 text-[12px] text-(--n-fg-2)">
            <span className="size-1.5 rounded-full bg-(--n-fg-3)" />
            {events ? "No rules — allowing everything" : "Waiting for your first agent"}
          </span>
        )}
      </div>
    </header>
  );
}

function Palette() {
  const open = useStore((s) => s.palette);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const rules = useStore((s) => s.rules);
  const members = useStore((s) => s.members);
  const fleet = useStore((s) => s.fleet);
  const { labs, fabric } = useWorkspace();
  const items = useMemo(() => {
    const pages = (fabric ? FABRIC_TITLES : TITLES.filter(([p]) => labs || (p !== "/playground" && p !== "/flows"))).map(([p, t]) => ({ label: t, hint: "Page", path: p, logo: undefined as string | undefined }));
    const agents = fabric
      ? Array.from(new Set(fleet.flatMap((d) => d.agents.map((a) => a.agentId)))).map((id) => ({ label: agentById(id).name, hint: "Agent", path: "/evidence?agent=" + id, logo: agentById(id).logo }))
      : AGENTS.map((a) => ({ label: a.name, hint: CATEGORIES.find((c) => c.id === a.category)!.name, path: "/agents/" + a.id, logo: a.logo }));
    const devices = fabric ? fleet.map((d) => ({ label: d.hostname, hint: "Device", path: "/fleet/" + d.id, logo: d.osLogo })) : [];
    const flows = labs ? Object.values(SCENARIOS).map((s) => ({ label: s.title, hint: "Happy flow", path: "/flows/" + s.id, logo: undefined })) : [];
    const rs = rules.map((r) => ({ label: `${r.id} — ${r.title}`, hint: "Rule", path: "/contract", logo: undefined }));
    const ps = members.map((m) => ({ label: m.id, hint: "Person", path: fabric ? "/" : "/team", logo: undefined }));
    const all = [...pages, ...devices, ...agents, ...flows, ...rs, ...ps];
    const f = q.trim().toLowerCase();
    return (f ? all.filter((x) => (x.label + " " + x.hint).toLowerCase().includes(f)) : all).slice(0, 12);
  }, [q, rules, members, labs, fabric, fleet]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setState({ palette: !getState().palette });
      }
      if (e.key === "Escape") setState({ palette: false });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => setSel(0), [q]);
  const choose = (p: string) => {
    go(p);
    setState({ palette: false });
    setQ("");
  };
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setState({ palette: false })} className="absolute inset-0 bg-[#070b16]/35 backdrop-blur-[2px]" />
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="relative w-full max-w-[600px] rounded-2xl border border-line bg-surface shadow-float overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-13 border-b border-line">
              <Search className="size-4 text-fg-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, items.length - 1));
                  if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
                  if (e.key === "Enter" && items[sel]) choose(items[sel].path);
                }}
                placeholder="Jump to an agent, rule, flow, person or page…"
                className="flex-1 bg-transparent outline-none text-[14.5px] placeholder:text-fg-3"
              />
              <Kbd>esc</Kbd>
            </div>
            <div className="max-h-[380px] overflow-y-auto scroll-thin p-1.5">
              {items.map((it, i) => (
                <button key={it.path + it.label} onMouseEnter={() => setSel(i)} onClick={() => choose(it.path)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 h-10 text-left text-[13.5px]", i === sel ? "bg-surface-2" : "")}>
                  {it.logo ? (
                    <Logo name={it.logo} size={22} rounded="rounded-md" />
                  ) : (
                    <span className="grid size-[22px] place-items-center rounded-md bg-surface-3 text-fg-3">
                      <CircleCheck className="size-3.5" />
                    </span>
                  )}
                  <span className="flex-1 truncate">{it.label}</span>
                  <span className="text-[12px] text-fg-3">{it.hint}</span>
                </button>
              ))}
              {!items.length && <div className="px-3 py-6 text-center text-fg-3 text-[13px]">No matches for “{q}”.</div>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ y: 16, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 8, opacity: 0 }} className="pointer-events-auto flex items-start gap-2.5 rounded-xl bg-[#111113] text-white px-4 py-2.5 shadow-float max-w-[460px] ring-1 ring-white/10">
            <span className={cn("mt-1.5 size-2 rounded-full shrink-0", t.tone === "allow" ? "bg-[#3fd49b]" : t.tone === "block" ? "bg-[#ff6e8a]" : t.tone === "review" ? "bg-[#f4b453]" : "bg-[#9db4ff]")} />
            <div>
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.body && <div className="text-[12px] opacity-70 mt-0.5">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TourCard() {
  const step = useStore((s) => s.tour);
  const workspace = useStore((s) => s.workspace);
  const TOUR = tourFor(workspace);
  if (step === null || !TOUR[step]) return null;
  const t = TOUR[step];
  const goStep = (i: number) => {
    const n = TOUR[i];
    setState({ tour: i, role: n.role ?? "admin" });
    go(n.path);
  };
  return (
    <motion.div key={step} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="fixed bottom-4 right-4 z-[55] w-[min(360px,calc(100vw-32px))] rounded-2xl bg-[#111113] text-white p-4 shadow-float ring-1 ring-white/10">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono opacity-60">
          Guided tour · {step + 1}/{TOUR.length}
        </span>
        <button onClick={() => setState({ tour: null })} className="opacity-60 hover:opacity-100" aria-label="End tour">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-2 text-[15px] font-semibold leading-snug">{t.title}</div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed opacity-75">{t.body}</p>
      <div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full brand-grad transition-all" style={{ width: `${((step + 1) / TOUR.length) * 100}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button disabled={step === 0} onClick={() => goStep(step - 1)} className="text-[12.5px] opacity-70 hover:opacity-100 disabled:opacity-25">
          Back
        </button>
        {step < TOUR.length - 1 ? (
          <button onClick={() => goStep(step + 1)} className="rounded-full bg-white text-[#0f1b35] px-3.5 h-8 text-[12.5px] font-semibold">
            Next
          </button>
        ) : (
          <button onClick={() => setState({ tour: null })} className="rounded-full bg-white text-[#0f1b35] px-3.5 h-8 text-[12.5px] font-semibold">
            Finish tour
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function Shell({ current, children, focus }: { current: string; children: ReactNode; focus?: boolean }) {
  const [menu, setMenu] = useState(false);
  const workspace = useStore((s) => s.workspace);
  // Feed the scroll offset to CSS (--sy) for the parallax page headers.
  useEffect(() => {
    const el = document.getElementById("main-scroll");
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => el.style.setProperty("--sy", String(el.scrollTop)));
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => {
      el.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <Topbar onMenu={() => setMenu(true)} />
      {workspace === "fresh" && (
        <div className="fresh-bar flex items-center justify-center gap-2.5 h-9 text-[12px]">
          <span className="prism-swatch size-1.5 rounded-full" />
          Fresh workspace — every number, decision and person here comes from what you do.
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        {!focus && (
          <aside className="relative z-10 hidden lg:block w-[252px] shrink-0 border-r border-[color-mix(in_oklab,var(--fg)_11%,transparent)] bg-surface">
            <Sidebar current={current} />
          </aside>
        )}
        <AnimatePresence>
          {menu && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(false)} className="lg:hidden fixed inset-0 z-40 bg-black/30" />
              <motion.aside initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }} className="lg:hidden fixed left-0 top-[68px] bottom-0 z-50 w-[260px] bg-bg border-r border-line shadow-float">
                <Sidebar current={current} onNavigate={() => setMenu(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
        <main id="main-scroll" className="flex-1 min-w-0 overflow-y-auto scroll-thin">
          {children}
        </main>
      </div>
      <Palette />
      <Toasts />
      <TourCard />
      <PasskeyModal />
    </div>
  );
}
