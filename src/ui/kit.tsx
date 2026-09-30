// Shared UI kit — decision chips, cards, tables, drawer, payload views.
import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import type { Decision, SimulationEvent } from "../model/types";
import { agentById, resourceById, userById } from "../model/org";
import { destById } from "../model/registries";
import { AGENT_LOGOS, DEST_LOGOS, logoUrl, photoOf } from "./logos";
import { DESKTOP_SHELL } from "./shell";
import { Breadcrumb, PageIcon, currentPage } from "./page-meta";

const AVATAR_COLORS = ["#1848ff", "#6b45e0", "#0a8a5c", "#b26500"];
export function Avatar({ userId, size = 22 }: { userId: string; size?: number }) {
  const u = userById(userId);
  const photo = photoOf(userId);
  if (photo) {
    return <img src={photo} alt={u?.name ?? userId} className="avatar" style={{ width: size, height: size, objectFit: "cover" }} />;
  }
  const initials = (u?.name ?? "?").split(" ").map((x) => x[0]).slice(0, 2).join("");
  const color = AVATAR_COLORS[(userId.charCodeAt(2) || 0) % AVATAR_COLORS.length];
  return <span className="avatar" style={{ width: size, height: size, background: color }}>{initials}</span>;
}

export function AgentMark({ agentId, size = 16 }: { agentId: string; size?: number }) {
  const mark = AGENT_LOGOS[agentId];
  if (!mark) return null;
  return <img src={logoUrl(mark)} alt="" className="logo-img" style={{ width: size, height: size }} />;
}

export function DestMark({ destId, size = 16 }: { destId: string; size?: number }) {
  const mark = DEST_LOGOS[destId];
  if (!mark) return null;
  return <img src={logoUrl(mark)} alt="" className="logo-img" style={{ width: size, height: size }} />;
}

export function DecisionChip({ d, small }: { d: Decision | string; small?: boolean }) {
  const cls =
    d === "ALLOW" ? "c-allow" : d === "CONSTRAIN" ? "c-constrain" :
    d === "REVIEW" ? "c-review" : d === "BLOCK" ? "c-block" : "c-neutral";
  return (
    <span className={`chip ${cls}`} style={small ? { fontSize: 9.5 } : undefined}>
      <span className="chip-dot" />
      {d}
    </span>
  );
}

export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`chip c-${tone}`}>{children}</span>;
}

export function StatusChip({ s }: { s: string }) {
  return <span className={`chip c-${s.toLowerCase()}`}>{s.replaceAll("_", " ")}</span>;
}

export function Stat({
  label, value, note, tone, onClick, icon,
}: { label: string; value: React.ReactNode; note?: string; tone?: string; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <div className={`card stat ${onClick ? "clickable" : ""}`} onClick={onClick}>
      {icon ? (
        <div className="stat-top">
          <div className="stat-label">{label}</div>
          <div className="stat-icon" style={tone ? { color: `var(--${tone})`, background: `var(--${tone}-soft)` } : undefined}>{icon}</div>
        </div>
      ) : (
        <div className="stat-label">{label}</div>
      )}
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{shownValue(value)}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** Integer that counts up to its value on first paint and eases between later values. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export function CountUp({ value }: { value: number }) {
  const animate = Number.isInteger(value) && !prefersReducedMotion();
  const [shown, setShown] = React.useState(animate ? 0 : value);
  const from = React.useRef(animate ? 0 : value);
  React.useEffect(() => {
    // Hidden tabs pause animation frames — show the real value straight away there.
    if (!animate || document.hidden) { setShown(value); from.current = value; return; }
    const a = from.current, b = value, start = performance.now(), dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      // A frame can be stamped slightly before `start`; never run the easing backwards (no "-1").
      const k = Math.min(1, Math.max(0, (t - start) / dur));
      setShown(Math.round(a + (b - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const settle = setTimeout(() => setShown(b), dur + 150); // always land on the true value
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); from.current = b; };
  }, [value, animate]);
  return <>{Number.isInteger(shown) ? shown.toLocaleString("en-US") : shown}</>;
}
const shownValue = (v: React.ReactNode) => (typeof v === "number" ? <CountUp value={v} /> : v);

export interface MetricItem { label: string; value: React.ReactNode; note?: string; tone?: string; onClick?: () => void }
/** Inline KPIs. `band` = borderless straight on the canvas; default = one carded strip. */
export function MetricBar({ items, band }: { items: MetricItem[]; band?: boolean }) {
  return (
    <div className={band ? "metricband" : "metricbar"}>
      {items.map((it, i) => (
        <div key={i} className={`metric ${it.onClick ? "clickable" : ""}`} onClick={it.onClick}>
          <div className="metric-top">
            <span className="metric-label">{it.label}</span>
            {it.tone && <span className="metric-dot" style={{ background: `var(--${it.tone})` }} />}
          </div>
          <span className="metric-value">{shownValue(it.value)}</span>
          {it.note && <span className="metric-note">{it.note}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Page-level tabs — one section at a time instead of a long scroll. Only the
 * active tab's content mounts; page state lives in the page component, so it
 * survives tab switches. `storageKey` remembers the last tab for the session.
 */
export interface PageTab { id: string; label: string; count?: React.ReactNode; content: React.ReactNode }
export function PageTabs({ tabs, storageKey }: { tabs: PageTab[]; storageKey?: string }) {
  const [active, setActive] = React.useState<string>(() => {
    try {
      const saved = storageKey ? sessionStorage.getItem(`tab:${storageKey}`) : null;
      if (saved && tabs.some((t) => t.id === saved)) return saved;
    } catch { /* storage unavailable — default to the first tab */ }
    return tabs[0]?.id ?? "";
  });
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const pick = (id: string) => {
    setActive(id);
    try { if (storageKey) sessionStorage.setItem(`tab:${storageKey}`, id); } catch { /* ignore */ }
  };
  return (
    <div className="section page-tabs">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current?.id} className={`tab ${t.id === current?.id ? "active" : ""}`} onClick={() => pick(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" key={current?.id} className="tabpanel-anim">{current?.content}</div>
    </div>
  );
}

/** Client-side pagination for long lists; `resetKey` jumps back to page 1 when filters change. */
export function usePaged<T>(items: T[], size = 12, resetKey = "") {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => { setPage(0); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(page, pages - 1);
  return { rows: items.slice(p * size, p * size + size), page: p, pages, setPage, total: items.length, size };
}
export function Pager({ page, pages, setPage, total, size }: { page: number; pages: number; setPage: (p: number) => void; total: number; size: number }) {
  if (pages <= 1) return null;
  const start = page * size + 1;
  const end = Math.min(total, start + size - 1);
  return (
    <div className="pager">
      <span className="small faint tnum">{start}–{end} of {total}</span>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
        <span className="small dim tnum">Page {page + 1} of {pages}</span>
        <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}

/**
 * Progress bar — the one component used everywhere. Prism fill by default;
 * pass a tone ("allow" | "review" | "block") when the colour carries meaning.
 */
export function Progress({
  value, max = 1, label, detail, tone, size = "md", showPct,
}: {
  value: number; max?: number; label?: React.ReactNode; detail?: React.ReactNode;
  tone?: "allow" | "review" | "block"; size?: "sm" | "md" | "lg"; showPct?: boolean;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const pct = Math.round(ratio * 100);
  const right = detail ?? (showPct ? `${pct}%` : null);
  return (
    <div className={`progress ${size} ${tone ? `tone-${tone}` : ""}`}>
      {(label || right) && (
        <div className="progress-head">
          {label ? <span className="lbl">{label}</span> : <span />}
          {right !== null && <span className="val">{right}</span>}
        </div>
      )}
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ==========================================================================
   EntityCard — the ONE card used for every list/record on every page (replaces
   tables). Icon + eyebrow + title + action on top, then label/value fields.
   ========================================================================== */
export interface CardField { label: string; value: React.ReactNode }
export function EntityCard({
  icon, eyebrow, title, action, status, fields, children, onClick, selected, tone,
}: {
  icon?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;           // e.g. a button — clicks don't trigger onClick
  status?: React.ReactNode;           // e.g. a chip, shown next to the action
  fields?: CardField[];
  children?: React.ReactNode;         // optional extra body under the fields
  onClick?: () => void;               // whole card opens something (drawer / page)
  selected?: boolean;
  tone?: "allow" | "review" | "block" | "constrain";
}) {
  return (
    <div
      className={`card ecard ${onClick ? "clickable-card" : ""} ${selected ? "selected" : ""}`}
      data-tone={tone}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="ecard-head">
        {icon && <span className="ecard-icon">{icon}</span>}
        <div className="ecard-titles">
          {eyebrow && <div className="ecard-eyebrow">{eyebrow}</div>}
          <div className="ecard-title">{title}</div>
        </div>
        {(status || action) && (
          <div className="ecard-actions" onClick={(e) => e.stopPropagation()}>{status}{action}</div>
        )}
      </div>
      {fields && fields.length > 0 && (
        <dl className="ecard-fields">
          {fields.map((f) => (
            <React.Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></React.Fragment>
          ))}
        </dl>
      )}
      {children && <div className="ecard-body">{children}</div>}
    </div>
  );
}

/** Equal-height grid for EntityCards (2 columns, 1 on narrow screens). */
export function CardGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={`ecard-grid cols-${cols}`}>{children}</div>;
}

/* ==========================================================================
   Standard inputs + filter bar
   ========================================================================== */
export interface FilterOption { value: string; label: string }
export function Select({ label, value, onChange, options, allLabel = "All" }: {
  label?: string; value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel?: string | null;
}) {
  return (
    <label className="fselect">
      {label && <span className="fselect-label">{label}</span>}
      <span className="fselect-box">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {allLabel !== null && <option value="">{allLabel}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} className="fselect-chev" aria-hidden="true" />
      </span>
    </label>
  );
}
export function SearchInput({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="fsearch">
      <Search size={14} aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" className="fsearch-clear" onClick={() => onChange("")} aria-label="Clear search"><X size={13} /></button>}
    </label>
  );
}

export interface FilterSpec<T> {
  id: string;
  label: string;
  get: (item: T) => string | string[] | undefined;
  options?: FilterOption[];             // default: derived from the items
  format?: (value: string) => string;   // label for derived options
}
/** Search + dropdown filters over any list; options come from the data itself. */
export function useCardFilters<T>(items: T[], opts: { search?: (item: T) => string; filters?: FilterSpec<T>[] }) {
  const [query, setQuery] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const specs = opts.filters ?? [];
  const withOptions = specs.map((f) => {
    if (f.options) return { ...f, options: f.options };
    const seen = new Set<string>();
    for (const it of items) { const v = f.get(it); (Array.isArray(v) ? v : v ? [v] : []).forEach((x) => seen.add(x)); }
    return { ...f, options: [...seen].sort().map((v) => ({ value: v, label: f.format ? f.format(v) : v })) };
  });
  const q = query.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (q && opts.search && !opts.search(it).toLowerCase().includes(q)) return false;
    return specs.every((f) => {
      const want = values[f.id];
      if (!want) return true;
      const v = f.get(it);
      return Array.isArray(v) ? v.includes(want) : v === want;
    });
  });
  const active = !!q || Object.values(values).some(Boolean);
  return {
    filtered,
    resetKey: q + "|" + JSON.stringify(values),
    bar: {
      query: opts.search ? query : undefined,
      onQuery: opts.search ? setQuery : undefined,
      filters: withOptions.map((f) => ({ id: f.id, label: f.label, options: f.options })),
      values,
      onChange: (id: string, v: string) => setValues((cur) => ({ ...cur, [id]: v })),
      count: filtered.length,
      total: items.length,
      onClear: active ? () => { setQuery(""); setValues({}); } : undefined,
    },
  };
}
export function FilterBar({
  query, onQuery, placeholder, filters = [], values = {}, onChange, count, total, onClear, right,
}: {
  query?: string; onQuery?: (v: string) => void; placeholder?: string;
  filters?: { id: string; label: string; options: FilterOption[] }[];
  values?: Record<string, string>; onChange?: (id: string, v: string) => void;
  count?: number; total?: number; onClear?: () => void; right?: React.ReactNode;
}) {
  return (
    <div className="fbar">
      {onQuery && <SearchInput value={query ?? ""} onChange={onQuery} placeholder={placeholder} />}
      {filters.map((f) => (
        <Select key={f.id} label={f.label} value={values[f.id] ?? ""} onChange={(v) => onChange?.(f.id, v)} options={f.options} />
      ))}
      <span className="fbar-meta">
        {count !== undefined && total !== undefined && <span className="fcount">Showing <b>{count}</b> of {total}</span>}
        {onClear && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear filters</button>}
        {right}
      </span>
    </div>
  );
}

export function PageHead({ title, sub, right, eyebrow }: { title: string; sub?: string; right?: React.ReactNode; eyebrow?: string }) {
  const meta = DESKTOP_SHELL ? currentPage() : undefined;
  if (meta) {
    // Live prototype: breadcrumb, then the page's gradient icon beside its title — no description.
    return (
      <div className="page-head page-head-ds">
        <div style={{ minWidth: 0 }}>
          <Breadcrumb meta={meta} title={title} />
          <div className="page-title-row">
            <PageIcon meta={meta} />
            <h1 className="page-title">{title}</h1>
          </div>
        </div>
        {right && <div className="row" style={{ flexShrink: 0 }}>{right}</div>}
      </div>
    );
  }
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {right && <div className="row" style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

/** A titled section with optional action on the right. */
export function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <div className="section-title">{title}</div>
        {sub && <div className="section-sub">{sub}</div>}
      </div>
      {right && <div className="row">{right}</div>}
    </div>
  );
}

/** Side panel. Rendered at the document root so it always sits above the sticky
 *  top bars (inside the page it was trapped under them by the page's stacking context). */
export function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="drawer" role="dialog">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ Close</button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function SimNote({ children }: { children?: React.ReactNode }) {
  return <span className="sim-note">◇ {children ?? "Simulation — prototype data"}</span>;
}

export function names(e: SimulationEvent) {
  return {
    user: userById(e.user)?.name ?? e.user,
    agent: agentById(e.agent)?.name ?? e.agent,
    resource: resourceById(e.resource)?.name ?? e.resource,
    destination: e.destination ? destById(e.destination)?.label ?? e.destination : undefined,
  };
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

// Payload view highlighting tokens/redactions.
export function Payload({ title, text, highlight }: { title: string; text: string; highlight?: "tokens" | "sensitive" }) {
  let content: React.ReactNode = text;
  if (highlight === "tokens") {
    const parts = text.split(/((?:[A-Z]+_TOKEN_\d{3})|(?:\[REDACTED:[A-Z_]+\]))/g);
    content = parts.map((p, i) =>
      /^[A-Z]+_TOKEN_\d{3}$|^\[REDACTED:/.test(p) ? <span key={i} className="hl-tok">{p}</span> : p
    );
  } else if (highlight === "sensitive") {
    const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+1 \d{3} \d{3} \d{4}|sk_live_\w+|-----BEGIN [A-Z ]+-----|VRD-CUST-\d{4}|ACCT-\d{8}|DB_PASSWORD=\S+)/g;
    const parts = text.split(re);
    content = parts.map((p, i) => (re.test(p) && i % 2 === 1 ? <span key={i} className="hl-red">{p}</span> : p));
  }
  return (
    <div>
      <div className="payload-title dim">{title}</div>
      <div className="payload">{content}</div>
    </div>
  );
}

export function EvidenceChain({ e }: { e: SimulationEvent }) {
  return (
    <div className="pipe">
      {e.evidence.chain.map((c, i) => (
        <div className="pipe-stage" key={i} style={{ animationDelay: `${i * 0.03}s` }}>
          <div className="pipe-rail">
            <div className={`pipe-dot ${c.label === "Decision" ? (e.decision === "ALLOW" ? "t-good" : e.decision === "BLOCK" ? "t-bad" : e.decision === "REVIEW" ? "t-warn" : "t-info") : "t-neutral"}`} />
            {i < e.evidence.chain.length - 1 && <div className="pipe-line" />}
          </div>
          <div className="pipe-body">
            <div className="pipe-label">{c.label}</div>
            <div className="pipe-detail">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiskChip({ r }: { r: string }) {
  return <span className={`chip c-${r}`}>{r.toUpperCase()}</span>;
}
