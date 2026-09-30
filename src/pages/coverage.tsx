// Coverage Map — "can Wrapbox really keep each promise?" Every row is derived
// live from the switched-on contracts, the always-on Safety Kernel and the
// Capability Registry (engine/coverage.ts). Nothing on this page is typed in.
// Deliberately not all-green: gaps are the product being honest.
import { useMemo, useState } from "react";
import { useAppState } from "../state/store";
import { PageHead, StatusChip, SimNote, Chip, MetricBar, usePaged, Pager, EntityCard, CardGrid, FilterBar, useCardFilters } from "../ui/kit";
import { logoUrl, INTEGRATION_LOGOS } from "../ui/logos";
import { CAPABILITIES, DATA_TYPES } from "../model/registries";
import { buildCoverageMatrix, type CoverageRow } from "../engine/coverage";
import type { CoverageStatus } from "../model/types";
import type { ReactNode } from "react";
import { ShieldCheck, ShieldAlert, Eye, Clock, Lock, ArrowRight, X, Laptop, Network, DoorOpen, Cpu, Fingerprint, Globe, Cloud } from "lucide-react";

const STATUS_META: Record<CoverageStatus, { icon: ReactNode; tone?: string; note: string }> = {
  ENFORCED: { icon: <ShieldCheck size={17} />, tone: "good", note: "can see it and stop it" },
  DEGRADED: { icon: <ShieldAlert size={17} />, tone: "warn", note: "can stop it, not perfectly" },
  UNDERSTOOD_ONLY: { icon: <Eye size={17} />, tone: "info", note: "can see it, can't stop it yet" },
  PENDING: { icon: <Clock size={17} />, tone: undefined, note: "skill not built yet" },
  UNINSPECTABLE: { icon: <Lock size={17} />, tone: "bad", note: "locked content — blocked to be safe" },
};

// One tone per status, aligned to the StatusChip colours so the posture bar,
// the metric dots and every chip in the tables read as one language.
const STATUS_TONE: Record<CoverageStatus, string> = {
  ENFORCED: "allow",
  DEGRADED: "review",
  UNDERSTOOD_ONLY: "accent",
  PENDING: "fg-4",
  UNINSPECTABLE: "block",
};

// A crisp glyph per plane, with a real vendor mark where a skill governs a
// specific integration (GitHub / AWS / SQL / MCP gateways).
const PLANE_ICON: Record<string, ReactNode> = {
  ENDPOINT: <Laptop size={15} />,
  NETWORK: <Network size={15} />,
  GATEWAY: <DoorOpen size={15} />,
  BROWSER: <Globe size={15} />,
  HOSTED: <Cloud size={15} />,
  BRAIN: <Cpu size={15} />,
};
const CAP_LOGO: Record<string, string> = {
  "cap-gw-github": INTEGRATION_LOGOS.GitHub,
  "cap-gw-cloud": INTEGRATION_LOGOS.AWS,
  "cap-gw-sql": INTEGRATION_LOGOS.PostgreSQL,
  "cap-gw-mcp": INTEGRATION_LOGOS.MCP,
  "cap-ep-mcp-stdio": INTEGRATION_LOGOS.MCP,
  "cap-br-extension": "chrome",
  "cap-hosted-agentcore": INTEGRATION_LOGOS.AWS,
  "cap-hosted-google": "google",
};

type Tab = "rules" | "safety" | "gaps" | "inactive" | "skills" | "data";

const TAB_HINT: Record<Tab, string> = {
  rules: "The rules your company wrote that are switched on — and whether Wrapbox has the skills to keep each one.",
  safety: "Built-in protections that are always on, even if nobody wrote a rule. They can't be switched off.",
  gaps: "Skills that aren't fully ready yet — the build list. Sorted so the skill holding back the most promises is first.",
  inactive: "Rules that are written but switched off (drafts or turned off). They protect nothing right now.",
  skills: "Every skill Wrapbox has, per plane. Every status on this page comes from here.",
  data: "Every kind of sensitive data Wrapbox recognizes, and how dangerous it is if it leaks.",
};

const CARD_TONE: Record<CoverageStatus, "allow" | "review" | "block" | "constrain"> = {
  ENFORCED: "allow",
  DEGRADED: "review",
  UNDERSTOOD_ONLY: "constrain",
  PENDING: "block",
  UNINSPECTABLE: "block",
};
const fmtStatus = (v: string) => v.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function StatusIcon({ s }: { s: CoverageStatus }) {
  // Monochrome on cards — the status chip carries the colour.
  return <span style={{ color: "var(--fg)", display: "inline-flex" }} title={fmtStatus(s)}>{STATUS_META[s].icon}</span>;
}

function RuleCards({ rows, showReason, what }: { rows: CoverageRow[]; showReason?: boolean; what: string }) {
  const f = useCardFilters(rows, {
    search: (r) => [r.title, r.source, r.destination, ...r.dataClasses, ...r.needs.map((n) => n.label)].join(" "),
    filters: [
      { id: "status", label: showReason ? "Would be" : "Status", get: (r) => r.status, format: fmtStatus },
      { id: "plane", label: "Plane", get: (r) => r.planes },
      { id: "data", label: "Data", get: (r) => r.dataClasses },
      { id: "source", label: "Source", get: (r) => r.source },
    ],
  });
  const paged = usePaged(f.filtered, 8, f.resetKey + "#" + rows.map((r) => r.id).join("|"));
  return (
    <>
      <FilterBar {...f.bar} placeholder={`Search ${what}…`} />
      {f.filtered.length === 0 ? (
        <div className="card empty">No {what} match these filters.</div>
      ) : (
        <CardGrid>
          {paged.rows.map((r) => (
            <EntityCard
              key={r.id}
              tone={CARD_TONE[r.status]}
              icon={<StatusIcon s={r.status} />}
              eyebrow={r.source}
              title={r.title}
              status={showReason
                ? <span className="row" style={{ gap: 6 }}><span className="small faint">would be</span><StatusChip s={r.status} /></span>
                : <StatusChip s={r.status} />}
              fields={[
                ...(showReason && r.inactiveReason ? [{ label: "Why off", value: <span className="small dim">{r.inactiveReason}</span> }] : []),
                {
                  label: "Data",
                  value: r.dataClasses.length === 0
                    ? <span className="small faint">any data</span>
                    : <div className="row" style={{ gap: 4 }}>{r.dataClasses.map((d) => <Chip key={d} tone="violet">{d}</Chip>)}</div>,
                },
                { label: "Where to", value: <span className="small dim">{r.destination}</span> },
                { label: "Plane", value: <div className="row" style={{ gap: 4 }}>{r.planes.map((p) => <Chip key={p} tone="neutral">{p}</Chip>)}</div> },
                {
                  label: "Needs these skills",
                  value: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {r.needs.map((n) => (
                        <div key={n.id} className="spread small" style={{ gap: 12, flexWrap: "nowrap" }}>
                          <span className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                          <StatusChip s={n.status} />
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          ))}
        </CardGrid>
      )}
      <Pager {...paged} />
    </>
  );
}

function GapCards({ gaps, jump }: { gaps: CoverageRow[]; jump: (t: Tab, g: CoverageRow) => void }) {
  const f = useCardFilters(gaps, {
    search: (g) => [g.title, g.source, ...g.planes].join(" "),
    filters: [
      { id: "plane", label: "Plane", get: (g) => g.planes },
      { id: "status", label: "Status", get: (g) => g.status, format: fmtStatus },
    ],
  });
  const paged = usePaged(f.filtered, 8, f.resetKey + "#" + gaps.map((g) => g.id).join("|"));
  return (
    <>
      <FilterBar {...f.bar} placeholder="Search gaps…" />
      {f.filtered.length === 0 ? (
        <div className="card empty">No gaps match these filters.</div>
      ) : (
        <CardGrid>
          {paged.rows.map((g) => {
            const nr = g.affects?.rules.length ?? 0;
            const ns = g.affects?.safety.length ?? 0;
            return (
              <EntityCard
                key={g.id}
                tone={CARD_TONE[g.status]}
                icon={PLANE_ICON[g.planes[0]] ?? <StatusIcon s={g.status} />}
                eyebrow={g.planes[0]}
                title={g.title}
                status={<StatusChip s={g.status} />}
                fields={[
                  {
                    label: "Affects",
                    value: nr + ns === 0 ? (
                      <span className="small faint">no promise yet</span>
                    ) : (
                      <div className="row small" style={{ gap: 10 }}>
                        {nr > 0 && <a onClick={() => jump("rules", g)}>{nr} {nr === 1 ? "rule" : "rules"}</a>}
                        {ns > 0 && <a onClick={() => jump("safety", g)}>{ns} safety</a>}
                      </div>
                    ),
                  },
                  { label: "Why", value: <span className="small dim">{g.source}</span> },
                ]}
              />
            );
          })}
        </CardGrid>
      )}
      <Pager {...paged} />
    </>
  );
}

function SkillCards() {
  const f = useCardFilters(CAPABILITIES, {
    search: (c) => [c.label, c.id, c.plane, c.note ?? ""].join(" "),
    filters: [
      { id: "plane", label: "Plane", get: (c) => c.plane },
      { id: "status", label: "Status", get: (c) => c.status, format: fmtStatus },
    ],
  });
  const paged = usePaged(f.filtered, 8, f.resetKey);
  return (
    <>
      <FilterBar {...f.bar} placeholder="Search skills…" />
      {f.filtered.length === 0 ? (
        <div className="card empty">No skills match these filters.</div>
      ) : (
        <CardGrid>
          {paged.rows.map((c) => {
            const lg = CAP_LOGO[c.id];
            return (
              <EntityCard
                key={c.id}
                tone={CARD_TONE[c.status]}
                icon={lg ? <img src={logoUrl(lg)} alt="" className="logo-img" width={26} height={26} /> : PLANE_ICON[c.plane]}
                eyebrow={c.plane}
                title={c.label}
                status={<StatusChip s={c.status} />}
                fields={[
                  { label: "Id", value: <span className="mono small faint">{c.id}</span> },
                  { label: "Note", value: <span className="small dim">{c.note}</span> },
                ]}
              />
            );
          })}
        </CardGrid>
      )}
      <Pager {...paged} />
    </>
  );
}

const SEVERITY_ORDER = ["critical", "high", "moderate", "low"];

function DataTypeCards() {
  const f = useCardFilters(DATA_TYPES, {
    search: (d) => [d.id, d.family, d.example].join(" "),
    filters: [
      { id: "family", label: "Family", get: (d) => d.family },
      {
        id: "severity", label: "Severity", get: (d) => d.severity,
        options: SEVERITY_ORDER.filter((v) => DATA_TYPES.some((d) => d.severity === v)).map((v) => ({ value: v, label: fmtStatus(v) })),
      },
    ],
  });
  const paged = usePaged(f.filtered, 8, f.resetKey);
  return (
    <>
      <FilterBar {...f.bar} placeholder="Search data types…" />
      {f.filtered.length === 0 ? (
        <div className="card empty">No data types match these filters.</div>
      ) : (
        <CardGrid>
          {paged.rows.map((d) => (
            <EntityCard
              key={d.id}
              tone={d.severity === "critical" ? "block" : d.severity === "high" ? "review" : undefined}
              icon={<Fingerprint size={18} />}
              eyebrow={d.family}
              title={<span className="mono">{d.id}</span>}
              status={<Chip tone={d.severity}>{d.severity}</Chip>}
              fields={[{ label: "Example", value: <span className="mono small dim">{d.example}</span> }]}
            />
          ))}
        </CardGrid>
      )}
      <Pager {...paged} />
    </>
  );
}

export function CoverageMap({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const m = useMemo(() => buildCoverageMatrix(s.contracts, s.kernel), [s.contracts, s.kernel]);
  const [tab, setTab] = useState<Tab>("rules");
  // "Show me the promises this weak skill is holding back" (from Known gaps).
  const [skill, setSkill] = useState<{ id: string; label: string } | null>(null);
  const order: CoverageStatus[] = ["ENFORCED", "DEGRADED", "UNDERSTOOD_ONLY", "PENDING", "UNINSPECTABLE"];

  const bySkill = (rows: CoverageRow[]) => (skill ? rows.filter((r) => r.needs.some((n) => n.id === skill.id)) : rows);
  const go = (t: Tab) => { setTab(t); if (t !== "rules" && t !== "safety") setSkill(null); };
  const jump = (t: Tab, g: CoverageRow) => { setSkill({ id: g.id, label: g.title }); setTab(t); };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "rules", label: "Your rules", count: m.rules.length },
    { id: "safety", label: "Always-on safety", count: m.safety.length },
    { id: "gaps", label: "Known gaps", count: m.gaps.length },
    { id: "inactive", label: "Not switched on", count: m.inactive.length },
    { id: "skills", label: "Skills", count: CAPABILITIES.length },
    { id: "data", label: "Data types", count: DATA_TYPES.length },
  ];

  // Presentation-only aggregates over the same live counts (no new state).
  const total = order.reduce((sum, st) => sum + m.counts[st], 0);
  const kpi = order.map((st) => ({
    label: st.replaceAll("_", " "),
    value: m.counts[st],
    note: STATUS_META[st].note,
    tone: STATUS_TONE[st],
  }));

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Visibility"
        title="Coverage Map"
        sub="Can Wrapbox really keep each promise? Every row is calculated live from your switched-on rules and Wrapbox's skills — switch a rule on or off and this page changes by itself."
        right={<SimNote>Skill states are demo data; the calculation is live</SimNote>}
      />

      {/* Coverage posture — one proportional bar + a refined KPI legend, in a single panel. */}
      <div className="card">
        <div className="section-head" style={{ marginBottom: 16, alignItems: "flex-start" }}>
          <div>
            <div className="section-title">Coverage posture</div>
            <div className="section-sub">
              Every live promise — your switched-on rules, always-on safety and known skill gaps — by what Wrapbox can actually deliver.
            </div>
          </div>
        </div>

        <div className="decision-track" style={{ height: 30 }} role="img" aria-label="Coverage posture by status">
          {order.map((st) => {
            const n = m.counts[st];
            if (!n) return null;
            return (
              <div
                key={st}
                title={`${n} ${st.replaceAll("_", " ").toLowerCase()}`}
                style={{ flex: `${n} 0 0`, minWidth: 2, background: `var(--${STATUS_TONE[st]})` }}
              />
            );
          })}
          {total === 0 && <div style={{ flex: 1, background: "var(--surface-2)" }} />}
        </div>

        <div style={{ marginTop: 18 }}>
          <MetricBar band items={kpi} />
        </div>
      </div>

      <div className="section">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => go(t.id)}>
              {t.label}<span className="tab-count">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="spread" style={{ marginBottom: 14 }}>
          <div className="small dim" style={{ maxWidth: 720 }}>{TAB_HINT[tab]}</div>
          {tab === "rules" && (
            <button className="btn btn-sm" onClick={() => nav("intent")}>Intent Studio <ArrowRight size={13} /></button>
          )}
        </div>

        {skill && (tab === "rules" || tab === "safety") && (
          <div className="filter-bar">
            Showing only promises that need <b>{skill.label}</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setSkill(null)}><X size={13} /> Clear</button>
          </div>
        )}

        {tab === "rules" && (
          m.rules.length === 0
            ? <div className="card empty">No rules are switched on. Write and activate one in Intent Studio.</div>
            : bySkill(m.rules).length === 0
              ? <div className="card empty">No switched-on rule needs this skill.</div>
              : <RuleCards key="rules" rows={bySkill(m.rules)} what="rules" />
        )}

        {tab === "safety" && (
          bySkill(m.safety).length === 0
            ? <div className="card empty">No always-on safety rule needs this skill.</div>
            : <RuleCards key="safety" rows={bySkill(m.safety)} what="safety rules" />
        )}

        {tab === "gaps" && (
          m.gaps.length === 0
            ? <div className="card empty">No gaps — every skill your switched-on rules rely on is fully enforced.</div>
            : <GapCards gaps={m.gaps} jump={jump} />
        )}

        {tab === "inactive" && (
          m.inactive.length === 0
            ? <div className="card empty">Every written rule is switched on.</div>
            : <RuleCards key="inactive" rows={m.inactive} showReason what="switched-off rules" />
        )}

        {tab === "skills" && (
          CAPABILITIES.length === 0
            ? <div className="card empty">No skills registered yet.</div>
            : <SkillCards />
        )}

        {tab === "data" && (
          DATA_TYPES.length === 0
            ? <div className="card empty">No data classes registered yet.</div>
            : <DataTypeCards />
        )}
      </div>
    </div>
  );
}
