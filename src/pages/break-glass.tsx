// Break Glass — explicit, time-limited, heavily evidenced emergency override.
import { useEffect, useState } from "react";
import { useAppState, startBreakGlass, endBreakGlass } from "../state/store";
import { PageHead, SectionHead, MetricBar, Chip, DecisionChip, Avatar, AgentMark, DestMark, SimNote, timeAgo, EntityCard, CardGrid, Select, FilterBar, Pager, useCardFilters, usePaged } from "../ui/kit";
import { USERS, userById } from "../model/org";
import { describe } from "../ui/describe";
import type { BreakGlassSession, Environment } from "../model/types";
import { Siren, Timer, TriangleAlert, ShieldAlert, BellRing, ShieldCheck, Clock } from "lucide-react";

// What an emergency override can cover: exactly one system in one environment.
const SCOPES: { resource: string; environment: Environment; label: string }[] = [
  { resource: "r-checkout", environment: "production", label: "checkout-service — production branch (main)" },
  { resource: "r-aws-prod", environment: "production", label: "AWS Production" },
  { resource: "r-customer-db", environment: "production", label: "customer-db (production)" },
  { resource: "r-payments-prod", environment: "production", label: "payments-prod database" },
];

export function BreakGlassPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [reason, setReason] = useState("");
  const [scopeIdx, setScopeIdx] = useState(0);
  const [duration, setDuration] = useState(20);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const active = s.breakGlass.find((b) => b.active && b.startedAt + b.durationMin * 60000 > Date.now());
  const remaining = active ? Math.max(0, active.startedAt + active.durationMin * 60000 - Date.now()) : 0;
  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  const activeNow = s.breakGlass.filter((b) => b.active && b.startedAt + b.durationMin * 60000 > Date.now()).length;
  const lifetime = s.breakGlass.length;
  const expired = lifetime - activeNow;
  // The actions a session actually overrode (stamped only when it changed the outcome).
  const overriddenBy = (b: BreakGlassSession) =>
    s.events.filter((e) => e.breakGlass && e.timestamp >= b.startedAt && e.timestamp <= b.startedAt + b.durationMin * 60000
      && e.resource === b.scopeResource && e.environment === b.scopeEnvironment);

  // Presentation only: the same status label the history cards show, reused for filtering.
  const isLive = (b: BreakGlassSession) => b.active && b.startedAt + b.durationMin * 60000 > Date.now();
  const statusLabel = (b: BreakGlassSession) => (isLive(b) ? "ACTIVE" : b.active ? "expired" : "ended");
  const history = [...s.breakGlass].reverse();
  const hf = useCardFilters(history, {
    search: (b) => `${b.reason} ${b.scope} ${USERS.find((u) => u.id === b.requester)?.name ?? ""}`,
    filters: [{ id: "status", label: "Status", get: statusLabel }],
  });
  const hPaged = usePaged(hf.filtered, 8, hf.resetKey);

  return (
    <div className="page">
      <PageHead
        eyebrow="Authorization"
        title="Break Glass"
        sub="An emergency override for a real incident. It covers exactly one system, lasts at most 60 minutes, is recorded loudly, and never overrides the Safety Kernel."
        right={<SimNote />}
      />

      {/* ── Console: the live override hero, or the emergency request form ────── */}
      {active ? (
        <section
          className="card"
          style={{
            borderColor: "var(--block)",
            background: "linear-gradient(180deg, var(--surface) 0%, var(--block-soft) 260%)",
            padding: "22px 24px",
          }}
        >
          <div className="spread" style={{ alignItems: "flex-start", gap: 16 }}>
            <div className="row" style={{ gap: 11, alignItems: "center", minWidth: 0 }}>
              <span
                style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  display: "grid", placeItems: "center",
                  background: "var(--block-soft)", color: "var(--block)",
                  boxShadow: "0 0 0 4px color-mix(in oklab, var(--block) 12%, transparent)",
                }}
              >
                <Siren size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--block)", fontWeight: 700, letterSpacing: "0.04em", fontSize: 13.5 }}>
                  BREAK-GLASS ACTIVE
                </div>
                <div className="small dim">Emergency authority in effect · ends by itself</div>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="row" style={{ gap: 7, justifyContent: "flex-end", color: "var(--block)" }}>
                <Clock size={17} style={{ marginTop: 2 }} />
                <span className="mono tnum" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>{mm}:{ss}</span>
              </div>
              <div className="small faint" style={{ marginTop: 5 }}>remaining of {active.durationMin} min · cannot be extended</div>
            </div>
          </div>

          {/* Incident reason */}
          <div style={{ marginTop: 18, padding: "13px 15px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
            <div className="field-label">Incident reason</div>
            <div style={{ marginTop: 5, fontWeight: 500, lineHeight: 1.5 }}>{active.reason}</div>
          </div>

          {/* Scope · Requester · Notified */}
          <div className="grid g3" style={{ marginTop: 16 }}>
            <div>
              <div className="field-label">Covers only</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                {active.scopeEnvironment && <Chip tone="block">{active.scopeEnvironment}</Chip>}
                <span style={{ fontWeight: 600 }}>{active.scope}</span>
              </div>
            </div>
            <div>
              <div className="field-label">Requested by</div>
              <div className="row" style={{ gap: 9, marginTop: 8 }}>
                <Avatar userId={active.requester} size={26} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{USERS.find((u) => u.id === active.requester)?.name}</div>
                  <div className="small faint">{userById(active.requester)?.role}</div>
                </div>
              </div>
            </div>
            <div>
              <div className="field-label"><BellRing size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />Notified</div>
              <div className="row" style={{ gap: 7, marginTop: 8 }}>
                {(active.notified ?? []).length > 0 ? (active.notified ?? []).map((u) => (
                  <span
                    key={u}
                    className="row"
                    title={`${userById(u)?.name} (${userById(u)?.role})`}
                    style={{ gap: 6, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px 3px 3px" }}
                  >
                    <Avatar userId={u} size={18} />
                    <span className="small" style={{ fontWeight: 600 }}>{userById(u)?.name}</span>
                  </span>
                )) : <span className="dim">—</span>}
              </div>
            </div>
          </div>

          <div className="small dim" style={{ margin: "18px 0 4px", lineHeight: 1.6 }}>
            While this is on, actions on <b>{active.scope}</b> that would need a yes (or are blocked by a company rule) go through —
            and each one is stamped BREAK-GLASS in Evidence. Everything else is unchanged.
          </div>
          <div className="row" style={{ gap: 7, color: "var(--allow)", marginBottom: overriddenBy(active).length > 0 ? 18 : 4 }}>
            <ShieldCheck size={14} />
            <span className="small" style={{ fontWeight: 500 }}>The Safety Kernel still applies — it never yields to break-glass.</span>
          </div>

          {/* Actions taken under this override */}
          {overriddenBy(active).length > 0 && (
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>
                Overridden under this session · {overriddenBy(active).length}
              </div>
              <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r)", overflow: "hidden", background: "var(--surface)" }}>
                {overriddenBy(active).map((e, i) => (
                  <div
                    key={e.id}
                    className="spread"
                    style={{ padding: "11px 14px", gap: 12, borderTop: i ? "1px solid var(--line)" : "none" }}
                  >
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <AgentMark agentId={e.agent} size={18} />
                      <Avatar userId={e.user} size={18} />
                      <span style={{ fontWeight: 500, minWidth: 0 }}>{describe(e)}</span>
                    </div>
                    <div className="row" style={{ gap: 9, flexShrink: 0 }}>
                      {e.destination && <DestMark destId={e.destination} size={16} />}
                      <span className="small faint mono">{timeAgo(e.timestamp)}</span>
                      <DecisionChip d={e.decision} small />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 12, marginTop: 18 }}>
            <button className="btn btn-danger btn-sm" onClick={() => endBreakGlass(active.id)}>End override now</button>
            {overriddenBy(active).length > 0 && (
              <span className="small dim">
                Fixed? End it now — until then, {active.scope} keeps skipping approvals.
              </span>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <SectionHead title="Request emergency override" sub="Scoped, time-boxed and loud by design" />
          <div className="field">
            <label className="field-label">Reason (required)</label>
            <input className="input" placeholder="e.g. SEV-1: checkout down, revenue impacting" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="grid g2" style={{ marginTop: 16 }}>
            <div className="field">
              <label className="field-label">Covers only (one system)</label>
              <Select
                value={String(scopeIdx)}
                onChange={(v) => setScopeIdx(Number(v))}
                options={SCOPES.map((sc, i) => ({ value: String(i), label: sc.label }))}
                allLabel={null}
              />
              <span className="row" style={{ gap: 6, marginTop: 2 }}>
                <Chip tone="block">{SCOPES[scopeIdx].environment}</Chip>
                <span className="small faint">emergency authority is limited to this one system</span>
              </span>
            </div>
            <div className="field">
              <label className="field-label">Duration (minutes, max 60)</label>
              <input className="input" type="number" min={5} max={60} value={duration} onChange={(e) => setDuration(Math.min(60, Number(e.target.value)))} />
              <span className="small faint" style={{ marginTop: 2 }}>ends automatically · cannot be extended</span>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16, borderColor: "var(--warn)", background: "var(--warn-soft)" }}>
            <div className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
              <TriangleAlert size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 2 }} />
              <div>
                <b className="small" style={{ color: "var(--warn)" }}>Strong warning:</b>{" "}
                <span className="small dim">
                  for the next {duration} minutes, actions on the chosen system that would need a yes or hit a company block go through. Security and engineering
                  leadership are notified, every action it overrides is flagged in Evidence, it can't be extended, and the
                  Safety Kernel still applies.
                </span>
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: "center", marginTop: 18 }}>
            <button className="btn btn-danger" disabled={reason.trim().length < 8} onClick={() => startBreakGlass("u-priya", reason, SCOPES[scopeIdx].resource, SCOPES[scopeIdx].environment, SCOPES[scopeIdx].label, duration)}>
              <ShieldAlert size={13} /> Activate break-glass ({duration} min)
            </button>
            {reason.trim().length < 8 && <span className="small faint">A meaningful reason is required.</span>}
          </div>
        </section>
      )}

      {/* ── Posture strip ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 24 }}>
        <MetricBar
          band
          items={[
            { label: "Active overrides", value: activeNow, tone: activeNow > 0 ? "block" : "allow", note: activeNow > 0 ? "emergency authority in effect" : "no override in effect" },
            { label: "Lifetime activations", value: lifetime, note: "every activation is retained" },
            { label: "Expired / ended", value: expired, tone: "allow", note: "no longer in effect" },
          ]}
        />
      </div>

      {/* ── History ───────────────────────────────────────────────────────────── */}
      {s.breakGlass.length > 0 ? (
        <div className="section">
          <SectionHead
            title="History"
            sub="Every activation is retained and reflected in Evidence"
            right={<button className="btn btn-sm" onClick={() => nav("evidence")}>View in Evidence</button>}
          />
          <FilterBar {...hf.bar} placeholder="Search reason, system or requester…" />
          {hf.filtered.length === 0 ? (
            <div className="card empty">No activations match these filters.</div>
          ) : (
            <CardGrid>
              {hPaged.rows.map((b) => {
                const isActive = isLive(b);
                const n = overriddenBy(b).length;
                return (
                  <EntityCard
                    key={b.id}
                    tone={isActive ? "block" : undefined}
                    icon={<Avatar userId={b.requester} size={26} />}
                    eyebrow={USERS.find((u) => u.id === b.requester)?.name ?? b.requester}
                    title={b.reason}
                    status={<Chip tone={isActive ? "block" : "neutral"}>{statusLabel(b)}</Chip>}
                    fields={[
                      { label: "Started", value: <span className="mono tnum">{new Date(b.startedAt).toLocaleString()}</span> },
                      { label: "Covered", value: <>{b.scopeEnvironment && <Chip tone="neutral">{b.scopeEnvironment}</Chip>} {b.scope}</> },
                      { label: "Duration", value: <span className="tnum">{b.durationMin}m</span> },
                      { label: "Overrode", value: <span className="tnum">{n} action{n === 1 ? "" : "s"}</span> },
                    ]}
                  />
                );
              })}
            </CardGrid>
          )}
          <Pager {...hPaged} />
        </div>
      ) : (
        <div className="section">
          <div className="card empty">
            <Timer size={26} className="dim" />
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>No break-glass has ever been activated.</div>
            <div className="small faint" style={{ maxWidth: 460, margin: "6px auto 0", lineHeight: 1.55 }}>Activations appear here and are flagged in <a onClick={() => nav("evidence")}>Evidence</a>.</div>
          </div>
        </div>
      )}
    </div>
  );
}
