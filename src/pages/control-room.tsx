// Control Room — executive/operations dashboard. Every number derives from
// the event store; every tile is a real page link and every figure is
// computed from live state (never typed in). Layout: the overview band on top,
// then one Framer-style feature grid whose tiles ARE the sections, then the
// live decision stream.
import { useMemo } from "react";
import { useAppState, metrics } from "../state/store";
import { PageHead, MetricBar, StatusChip, SimNote, SectionHead, AgentMark, CountUp, timeAgo } from "../ui/kit";
import { EventStream } from "../ui/event-stream";
import { describe } from "../ui/describe";
import { AGENTS, DEVICES, agentById } from "../model/org";
import { CAPABILITIES } from "../model/registries";
import { buildCoverageMatrix } from "../engine/coverage";
import type { CoverageStatus, Decision } from "../model/types";
import { ShieldCheck, Network, Server, ArrowRight, Link2, Globe, Cloud, OctagonX } from "lucide-react";
import { AGENT_LOGOS } from "../ui/logos";
import { DESKTOP_SHELL } from "../ui/shell";

const DECISIONS = [
  { key: "ALLOW", label: "Allowed", tone: "allow", route: "live", note: "flowed automatically" },
  { key: "CONSTRAIN", label: "Constrained", tone: "constrain", route: "live", note: "transformed in-flight" },
  { key: "REVIEW", label: "Reviewed", tone: "review", route: "reviews", note: "escalated to a human" },
  { key: "BLOCK", label: "Blocked", tone: "block", route: "live", note: "stopped before execution" },
] as const;

// Same tones the Coverage Map uses for these statuses, so both pages read as one language.
const COVERAGE_ROWS: { key: CoverageStatus; label: string; tone: string; note: string }[] = [
  { key: "ENFORCED", label: "Enforced", tone: "allow", note: "can see it and stop it" },
  { key: "DEGRADED", label: "Degraded", tone: "review", note: "can stop it, not perfectly" },
  { key: "UNDERSTOOD_ONLY", label: "Understood", tone: "accent", note: "can see it, can't stop it yet" },
];

const PLANES = [
  { key: "ENDPOINT", label: "Endpoint", icon: <Server size={15} strokeWidth={1.75} />, blurb: "file · process · secrets" },
  { key: "NETWORK", label: "Network", icon: <Network size={15} strokeWidth={1.75} />, blurb: "HTTPS · uploads · AI destinations" },
  { key: "GATEWAY", label: "Gateway", icon: <ShieldCheck size={15} strokeWidth={1.75} />, blurb: "GitHub · SQL · cloud · MCP" },
  { key: "BROWSER", label: "Browser", icon: <Globe size={15} strokeWidth={1.75} />, blurb: "browser agents in managed Chrome / Edge" },
  { key: "HOSTED", label: "Hosted", icon: <Cloud size={15} strokeWidth={1.75} />, blurb: "AWS AgentCore · Google (pending)" },
] as const;

const toneOf = (d: Decision) => DECISIONS.find((x) => x.key === d)?.tone ?? "allow";

export function ControlRoom({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const m = metrics(s);
  const activeAgents = AGENTS.filter((a) => !a.discovered).length;
  const discovered = AGENTS.filter((a) => a.discovered).length;
  const parked = s.events.filter((e) => e.status === "parked").length;
  const totalDecided = DECISIONS.reduce((n, d) => n + m.counts[d.key], 0);

  // Hero: the share of actions that did NOT simply flow — blocked, transformed
  // or held for a human before anything ran. Same counts as the decision bar.
  const intercepted = m.counts.BLOCK + m.counts.CONSTRAIN + m.counts.REVIEW;
  const interceptedPct = totalDecided > 0 ? ((intercepted / totalDecided) * 100).toFixed(1) : null;

  // Reviews: the same predicate the sidebar badge and the metric band use.
  const pending = s.events.filter((e) => e.reviewState?.status === "pending");
  const newestPending = pending.reduce<typeof pending[number] | undefined>((best, e) => (!best || e.timestamp > best.timestamp ? e : best), undefined);

  // Coverage: the Coverage Map's own live calculation, not a second tally.
  const coverage = useMemo(() => buildCoverageMatrix(s.contracts, s.kernel), [s.contracts, s.kernel]);
  const coverageTotal = (Object.keys(coverage.counts) as CoverageStatus[]).reduce((n, k) => n + coverage.counts[k], 0);
  const coverageOther = coverageTotal - COVERAGE_ROWS.reduce((n, r) => n + coverage.counts[r.key], 0); // PENDING + UNINSPECTABLE

  const planeStatus = (plane: string) => {
    const caps = CAPABILITIES.filter((c) => c.plane === plane);
    return { enforced: caps.filter((c) => c.status === "ENFORCED").length, total: caps.length };
  };

  // Evidence: the hash chain, newest last. The mini chain shows the last 16 seals coloured by decision.
  const chainTail = s.events.slice(-16);
  const latest = s.events[s.events.length - 1];
  const governed = AGENTS.filter((a) => !a.discovered);
  const stoppedNow = s.stops.filter((x) => x.active);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Overview"
        title="Control Room"
        sub={`${s.org.company} · ${activeAgents} registered agents · ${DEVICES.length} protected devices. Every figure below is computed from live event state — select any tile to inspect its source.`}
        right={<SimNote />}
      />

      <div className="card overview-card">
        <MetricBar band items={[
          { label: "Active agents", value: activeAgents, note: discovered > 0 ? `+${discovered} discovered, unregistered` : "all registered", onClick: () => nav("agents") },
          { label: "Pending reviews", value: m.pendingReviews, tone: m.pendingReviews > 0 ? "warn" : "good", note: parked > 0 ? `${parked} task step(s) parked` : "no parked steps", onClick: () => nav("reviews") },
          { label: "Secrets protected", value: m.secretsProtected, tone: "good", note: "credential exfiltration blocked", onClick: () => nav("evidence") },
          { label: "High-risk events", value: m.highRisk, tone: m.highRisk > 0 ? "bad" : "good", note: "risk ≥ high, all planes", onClick: () => nav("evidence") },
        ]} />
        <div className="overview-sep" />
        <div className="overview-decision">
          <div className="row spread" style={{ marginBottom: 12 }}>
            <span className="eyebrow">Decision mix · {totalDecided} actions</span>
            <button className="btn btn-ghost btn-sm" onClick={() => nav("live")}>Live Actions <ArrowRight size={13} /></button>
          </div>
          <div className="decision-track">
            {DECISIONS.map((d) => {
              const c = m.counts[d.key];
              if (c === 0) return null;
              return (
                <div key={d.key} className="decision-seg" style={{ flex: c, background: `var(--${d.tone})` }} onClick={() => nav(d.route)} title={`${d.label}: ${c}`}>
                  {c / (totalDecided || 1) > 0.06 && <span>{c}</span>}
                </div>
              );
            })}
          </div>
          <div className="decision-legend">
            {DECISIONS.map((d) => (
              <div key={d.key} className="decision-leg" onClick={() => nav(d.route)}>
                <span className="dot" style={{ background: `var(--${d.tone})` }} />
                <span className="n" style={{ color: `var(--${d.tone})` }}>{m.counts[d.key]}</span>
                <span className="lbl">{d.label} · {d.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          Platform grid — each tile is a section AND a link to its page.
          ------------------------------------------------------------------ */}
      <div className="section">
        {/* At the 2-column breakpoint the two span-2 tiles leave one single tile alone on the last row; let it take the row. */}
        <style>{`@media (max-width: 1000px) and (min-width: 681px) { .cr-grid > .ftile:last-child { grid-column: 1 / -1; } }`}</style>
        <div className="fgrid cols-3 cr-grid">

          {/* Hero — how much never simply flowed. Same four counts as the decision bar above. */}
          <button className="ftile span-2" style={{ overflow: "hidden", minHeight: 320 }} onClick={() => nav("live")} aria-label="Live Actions">
            <div className="ft-body" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, paddingBottom: 12 }}>
              {interceptedPct !== null ? (
                <>
                  <div className="bigstat">{interceptedPct}%</div>
                  <div className="bigstat-sub">of actions stopped, transformed or held before execution · {totalDecided} decisions</div>
                </>
              ) : (
                <>
                  <div className="bigstat">—</div>
                  <div className="bigstat-sub">No decisions yet — nothing has been intercepted in this workspace</div>
                </>
              )}
            </div>
            <span className="ft-title" style={{ position: "relative", zIndex: 1 }}>Live Actions <ArrowRight size={18} /></span>
            <div className="ft-sub" style={{ position: "relative", zIndex: 1 }}>
              {m.counts.BLOCK} blocked · {m.counts.CONSTRAIN} constrained · {m.counts.REVIEW} held for review · {m.counts.ALLOW} flowed
            </div>
            <div className="arc" />
          </button>

          {/* Decisions — the four counts as big numbers + a thin mix bar. */}
          <button className="ftile" onClick={() => nav("live")} aria-label="Decisions">
            <div className="ft-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 12px" }}>
                {DECISIONS.map((d) => (
                  <div key={d.key} style={{ minWidth: 0 }}>
                    <div className="tnum" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05, color: `var(--${d.tone})` }}>
                      <CountUp value={m.counts[d.key]} />
                    </div>
                    <div className="small faint" style={{ marginTop: 3 }}>{d.label}</div>
                  </div>
                ))}
              </div>
              <div className="decision-track" style={{ height: 8, marginTop: 20, borderRadius: 4 }} aria-hidden="true">
                {DECISIONS.map((d) => {
                  const c = m.counts[d.key];
                  return c === 0 ? null : <div key={d.key} className="decision-seg" style={{ flex: c, background: `var(--${d.tone})`, cursor: "inherit" }} />;
                })}
              </div>
            </div>
            <span className="ft-title">Decisions <ArrowRight size={18} /></span>
            <div className="ft-sub">
              {totalDecided > 0 ? `${totalDecided} actions · ${Math.round((m.counts.ALLOW / totalDecided) * 100)}% flowed without intervention` : "No actions decided yet"}
            </div>
          </button>

          {/* Reviews — what is waiting on a human right now. */}
          <button className="ftile" onClick={() => nav("reviews")} aria-label="Reviews">
            <div className="ft-body">
              <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                <span className="tnum" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1, color: pending.length > 0 ? "var(--review)" : "var(--fg)" }}>
                  <CountUp value={pending.length} />
                </span>
                <span className="small faint">{pending.length === 1 ? "request waiting" : "requests waiting"}</span>
              </div>
              {newestPending ? (
                <div style={{ marginTop: 18, borderLeft: "2px solid var(--review)", paddingLeft: 12 }}>
                  <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--fg)" }}>{describe(newestPending)}</div>
                  <div className="small faint" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <AgentMark agentId={newestPending.agent} size={14} />
                    {agentById(newestPending.agent)?.name ?? newestPending.agent} · {timeAgo(newestPending.timestamp)}
                  </div>
                </div>
              ) : (
                <div className="small faint" style={{ marginTop: 18 }}>Nothing is waiting on a human. Every held action has been decided.</div>
              )}
            </div>
            <span className="ft-title">Reviews <ArrowRight size={18} /></span>
            <div className="ft-sub">{parked > 0 ? `${parked} task step(s) parked until approval` : "No task steps parked"}</div>
          </button>

          {/* Agents — who is governed, and how many showed up uninvited. */}
          <button className="ftile" onClick={() => nav("agents")} aria-label="Agents">
            <div className="ft-body">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {governed.map((a) => (
                  <span key={a.id} title={`${a.name} · ${a.provider}`} style={{ width: 40, height: 40, borderRadius: 11, background: "var(--surface-2)", border: "1px solid var(--line)", display: "grid", placeItems: "center" }}>
                    {DESKTOP_SHELL && !AGENT_LOGOS[a.id]
                      ? <span className="agent-mono">{a.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                      : <AgentMark agentId={a.id} size={20} />}
                  </span>
                ))}
                {discovered > 0 && (
                  <span title={`${discovered} discovered, unregistered`} className="tnum" style={{ width: 40, height: 40, borderRadius: 11, border: "1px dashed var(--block)", color: "var(--block)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }}>
                    +{discovered}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 18, display: "flex", gap: 22 }}>
                <div>
                  <div className="tnum" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05 }}><CountUp value={activeAgents} /></div>
                  <div className="small faint" style={{ marginTop: 3 }}>registered</div>
                </div>
                <div>
                  <div className="tnum" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05, color: discovered > 0 ? "var(--block)" : "var(--fg)" }}><CountUp value={discovered} /></div>
                  <div className="small faint" style={{ marginTop: 3 }}>discovered</div>
                </div>
                <div>
                  <div className="tnum" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05 }}><CountUp value={DEVICES.length} /></div>
                  <div className="small faint" style={{ marginTop: 3 }}>devices</div>
                </div>
              </div>
            </div>
            <span className="ft-title">Agents <ArrowRight size={18} /></span>
            <div className="ft-sub">{discovered > 0 ? `${discovered} unregistered agent${discovered === 1 ? "" : "s"} seen on protected devices` : "Every agent seen is registered"}</div>
          </button>

          {/* Coverage — can Wrapbox keep each live promise? Same counts as the Coverage Map. */}
          <button className="ftile" onClick={() => nav("coverage")} aria-label="Coverage">
            <div className="ft-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {COVERAGE_ROWS.map((r) => {
                const c = coverage.counts[r.key];
                const w = coverageTotal > 0 ? (c / coverageTotal) * 100 : 0;
                return (
                  <div key={r.key}>
                    <div className="row spread" style={{ marginBottom: 6 }}>
                      <span className="small" style={{ color: "var(--fg-2)" }}>{r.label} <span className="faint">· {r.note}</span></span>
                      <span className="tnum small" style={{ fontWeight: 600, color: `var(--${r.tone})` }}>{c}</span>
                    </div>
                    <div className="meter" style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }} aria-hidden="true">
                      <div className="meter-fill" style={{ width: `${w}%`, height: "100%", background: `var(--${r.tone})`, borderRadius: 3, transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="ft-title">Coverage <ArrowRight size={18} /></span>
            <div className="ft-sub">
              {coverageTotal} live promises · {coverage.gaps.length} known gap{coverage.gaps.length === 1 ? "" : "s"}
              {coverageOther > 0 && ` · ${coverageOther} pending or uninspectable`}
            </div>
          </button>

          {/* Evidence — the tamper-evident chain: length + the latest seal. */}
          <button className="ftile span-2" onClick={() => nav("evidence")} aria-label="Evidence">
            <div className="ft-body">
              <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div className="tnum" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1 }}><CountUp value={s.events.length} /></div>
                  <div className="small faint" style={{ marginTop: 5 }}>decision records</div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Link2 size={12} /> Latest seal</div>
                  <div className="mono" style={{ fontSize: 15, letterSpacing: "0.02em", marginTop: 6, color: "var(--fg)", overflowWrap: "anywhere" }}>{s.lastHash}</div>
                  {latest && <div className="mono small faint" style={{ marginTop: 4, overflowWrap: "anywhere" }}>← {latest.evidence.prevHash}</div>}
                </div>
              </div>
              {chainTail.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 20 }} aria-hidden="true">
                  {chainTail.map((e, i) => (
                    <span key={e.id} title={`${e.evidence.hash} · ${e.decision}`} style={{ display: "flex", alignItems: "center", gap: 3, flex: 1, minWidth: 0 }}>
                      <span style={{ flex: 1, height: 10, borderRadius: 3, background: `var(--${toneOf(e.decision)})`, opacity: 0.45 + (0.55 * (i + 1)) / chainTail.length }} />
                      {i < chainTail.length - 1 && <span style={{ width: 3, height: 1, background: "var(--line-strong)", flexShrink: 0 }} />}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className="ft-title">Evidence <ArrowRight size={18} /></span>
            <div className="ft-sub">{m.highRisk} high-risk · {m.secretsProtected} secrets protected · one complete record per decision — user, agent, action, data, policy, approver, outcome · hash-linked (chain simulated)</div>
          </button>

          {/* Enforcement planes — one Core Brain, three arms; skills enforced per plane. */}
          <button className="ftile" onClick={() => nav("coverage")} aria-label="Enforcement planes">
            <div className="ft-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PLANES.map((p) => {
                const st = planeStatus(p.key);
                return (
                  <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="plane-icon">{p.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 550 }}>{p.label} <span className="small faint" style={{ fontWeight: 400 }}>· {st.enforced} of {st.total} skills</span></div>
                      <div className="small faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.blurb}</div>
                    </div>
                    <StatusChip s={st.enforced === st.total ? "ENFORCED" : "DEGRADED"} />
                  </div>
                );
              })}
            </div>
            {stoppedNow.length > 0 && (
              <div className="small" style={{ color: "var(--bad)", display: "flex", gap: 6, alignItems: "center" }}>
                <OctagonX size={14} /> {stoppedNow.length} agent{stoppedNow.length === 1 ? "" : "s"} stopped everywhere: {stoppedNow.map((x) => AGENTS.find((a) => a.id === x.agent)?.name ?? x.agent).join(", ")}
              </div>
            )}
            <span className="ft-title">Enforcement planes <ArrowRight size={18} /></span>
            <div className="ft-sub">{CAPABILITIES.filter((c) => c.status === "ENFORCED").length} of {CAPABILITIES.length} skills fully enforced across all planes</div>
          </button>
        </div>
      </div>

      <div className="section">
        <SectionHead title="Recent activity" sub="The live decision stream, newest first" right={<button className="btn btn-sm" onClick={() => nav("live")}>Live Actions <ArrowRight size={13} /></button>} />
        <EventStream events={s.events} nav={nav} compact limit={6} filters={false} bare />
      </div>
    </div>
  );
}
