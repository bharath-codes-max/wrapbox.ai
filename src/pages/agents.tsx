// Agent Inventory — every detected agent with identity, tools, destinations,
// risk and per-agent activity derived from the shared event store.
import { useState } from "react";
import { useAppState, stopAgent, resumeAgent, stopOf, taintOf } from "../state/store";
import { PageHead, SectionHead, MetricBar, Chip, RiskChip, SimNote, Drawer, DecisionChip, timeAgo, AgentMark, DestMark, Avatar, PageTabs, usePaged, Pager, EntityCard, CardGrid, FilterBar, useCardFilters } from "../ui/kit";
import { EventStream } from "../ui/event-stream";
import { describe } from "../ui/describe";
import { ORG, AGENTS, SUPPLIERS, deviceById, resourceById, supplierActive, supplierById, userById, type OrgAgent } from "../model/org";
import { destById } from "../model/registries";
import { ShieldAlert, ShieldCheck, Activity, ArrowRight, OctagonX, Play, Eye, Building2 } from "lucide-react";

/** People who may stop or resume an agent in this workspace. */
const STOPPERS = ["u-priya", "u-maya", "u-alex"];

/** Stop one agent everywhere — or resume it — with who and why on record. */
function KillSwitch({ agent }: { agent: OrgAgent }) {
  const s = useAppState();
  const cur = stopOf(agent.id, s);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [by, setBy] = useState(STOPPERS[0]);
  const history = s.stops.filter((x) => x.agent === agent.id).slice().reverse();
  const held = s.events.filter((e) => e.agent === agent.id && e.reviewState?.status === "pending").length;
  const running = s.tasks.filter((t) => t.agent === agent.id && (t.status === "active" || t.status === "parked")).length;
  return (
    <div className="card killswitch" style={{ marginBottom: 14, borderColor: cur ? "var(--bad)" : "var(--line)", background: cur ? "var(--bad-soft)" : undefined }}>
      {cur ? (
        <>
          <div className="row" style={{ gap: 8 }}><OctagonX size={16} style={{ color: "var(--bad)" }} /><b className="small">Stopped everywhere</b></div>
          <div className="small dim" style={{ marginTop: 6, lineHeight: 1.55 }}>
            By {userById(cur.by)?.name} · {timeAgo(cur.at)} · “{cur.reason}”. Every action by {agent.name} is refused on every plane, and its held requests were cancelled. Nothing else can lift this — not an approval, not break-glass.
          </div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <select className="select" style={{ width: "auto" }} value={by} onChange={(e) => setBy(e.target.value)} aria-label="Resumed by">
              {STOPPERS.map((u) => <option key={u} value={u}>{userById(u)?.name}</option>)}
            </select>
            <button className="btn btn-sm" onClick={() => resumeAgent(agent.id, by)}><Play size={13} /> Resume agent</button>
          </div>
        </>
      ) : open ? (
        <>
          <b className="small">Stop {agent.name} everywhere</b>
          <div className="small dim" style={{ marginTop: 4, lineHeight: 1.55 }}>
            Refuses every action on the laptop, network, gateways, browser and hosted planes at once. {held > 0 ? `${held} held request${held === 1 ? "" : "s"} will be cancelled. ` : ""}{running > 0 ? `${running} running job${running === 1 ? "" : "s"} will stop. ` : ""}Recorded with your name and reason.
          </div>
          <input className="input" style={{ marginTop: 10, width: "100%" }} placeholder="Why — e.g. suspicious pushes to main, investigating" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for stopping" />
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <select className="select" style={{ width: "auto" }} value={by} onChange={(e) => setBy(e.target.value)} aria-label="Stopped by">
              {STOPPERS.map((u) => <option key={u} value={u}>{userById(u)?.name}</option>)}
            </select>
            <button className="btn btn-danger btn-sm" disabled={reason.trim().length < 3} onClick={() => { stopAgent(agent.id, by, reason.trim()); setOpen(false); setReason(""); }}><OctagonX size={13} /> Stop everywhere</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="spread" style={{ gap: 10 }}>
          <span className="small dim">Kill switch — one step stops this agent on every plane.</span>
          <button className="btn btn-danger btn-sm" onClick={() => setOpen(true)}><OctagonX size={13} /> Stop this agent everywhere</button>
        </div>
      )}
      {history.filter((x) => !x.active).length > 0 && (
        <div className="small faint" style={{ marginTop: 10 }}>
          {history.filter((x) => !x.active).map((x) => (
            <div key={x.id}>Stopped by {userById(x.by)?.name} ({timeAgo(x.at)}, “{x.reason}”) · resumed by {userById(x.resumedBy ?? "")?.name ?? "—"}{x.resumedAt ? ` ${timeAgo(x.resumedAt)}` : ""}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentsPage({ nav }: { nav: (r: string) => void; route: string }) {
  const s = useAppState();
  const [open, setOpen] = useState<OrgAgent | null>(null);

  const lastActivity = (id: string) => {
    const evs = s.events.filter((e) => e.agent === id);
    return evs.length ? evs[evs.length - 1].timestamp : undefined;
  };
  const agentFilters = useCardFilters(AGENTS, {
    search: (a) => `${a.name} ${a.provider} ${a.kind} ${a.tools.join(" ")}`,
    filters: [
      { id: "kind", label: "Kind", get: (a) => a.kind },
      { id: "trust", label: "Trust", get: (a) => a.trust },
      { id: "risk", label: "Risk", get: (a) => a.risk },
    ],
  });
  const pagedAgents = usePaged(agentFilters.filtered, 8, agentFilters.resetKey);
  const decisionsFor = (id: string) => {
    const evs = s.events.filter((e) => e.agent === id);
    return {
      total: evs.length,
      blocked: evs.filter((e) => e.decision === "BLOCK").length,
      reviewed: evs.filter((e) => e.decision === "REVIEW").length,
    };
  };

  // Who actually used each agent, and on which laptop — derived from events.
  const usersOf = (id: string) => {
    const seen = new Map<string, string>();
    for (const e of s.events) if (e.agent === id && !seen.has(e.user)) seen.set(e.user, e.device);
    return [...seen.entries()].map(([user, device]) => ({ user, device }));
  };

  const registered = AGENTS.filter((a) => !a.discovered).length;
  const stoppedNow = AGENTS.filter((a) => stopOf(a.id, s)).length;
  const discovered = AGENTS.filter((a) => a.discovered).length;
  const trusted = AGENTS.filter((a) => a.trust === "trusted").length;
  const totalEvents = s.events.length;

  const shadow = AGENTS.filter((a) => a.discovered);
  const trustTone = (t: OrgAgent["trust"]) =>
    t === "trusted" ? "allow" : t === "conditional" ? "constrain" : t === "unknown" ? "critical" : "block";

  // The activity tab embeds a preview slice of the stream; its tab count is
  // exactly the number of rows that preview renders (no filters are applied).
  const streamLimit = 10;
  const streamShown = Math.min(s.events.length, streamLimit);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Activity"
        title="Agent Inventory"
        sub="Agents observed at runtime and drawn from the identity, MDM and inventory systems you already run — including shadow agents nobody registered. Identity: user + device + agent + tool feeds every decision."
        right={<SimNote>Discovery simulated · inventory model real</SimNote>}
      />

      {/* Lead with the alarming thing: agents observed but never registered. */}
      {shadow.map((a) => (
        <div
          key={a.id}
          className="card clickable-card"
          onClick={() => setOpen(a)}
          style={{ borderColor: "var(--bad)", background: "linear-gradient(180deg, var(--surface) 0%, color-mix(in oklab, var(--bad-soft) 55%, var(--surface)) 100%)" }}
        >
          <div className="spread" style={{ alignItems: "flex-start", gap: 14 }}>
            <div className="row" style={{ gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <span className="plane-icon" style={{ background: "var(--bad-soft)", color: "var(--bad)", width: 38, height: 38, borderRadius: 10 }}>
                <ShieldAlert size={19} strokeWidth={1.9} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ color: "var(--bad)" }}>Shadow agent discovered</div>
                <div className="row" style={{ gap: 8, marginTop: 5 }}>
                  <AgentMark agentId={a.id} size={18} />
                  <b style={{ fontSize: 16, letterSpacing: "-0.01em" }}>{a.name}</b>
                  <span className="small faint">{a.provider}</span>
                </div>
                <div className="small dim" style={{ marginTop: 8, maxWidth: 640, lineHeight: 1.55 }}>
                  Observed on {a.device ? deviceById(a.device)?.name : "an unmanaged device"} initiating external transfers via {a.tools.join(", ")}. No registered owner and no granted permissions —
                  its destinations resolve to <span className="mono">UNKNOWN_EXTERNAL</span> and fail safe.
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <Chip tone={trustTone(a.trust)}>{a.trust}</Chip>
              <RiskChip r={a.risk} />
            </div>
          </div>
          <div className="spread" style={{ marginTop: 14, gap: 10 }}>
            <div className="row" style={{ gap: 7 }}>
              {a.destinations.map((x) => (
                <span key={x} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <DestMark destId={x} size={14} /><span className="small dim">{destById(x)?.label ?? x}</span>
                </span>
              ))}
            </div>
            <span className="row small" style={{ gap: 5, color: "var(--accent)", fontWeight: 600 }}>Inspect agent <ArrowRight size={13} /></span>
          </div>
        </div>
      ))}

      {/* Refined KPI strip — small numbers in one carded band, not big boxes. */}
      <div className="card" style={{ marginTop: shadow.length ? 16 : 0 }}>
        <MetricBar band items={[
          { label: "Agents detected", value: AGENTS.length, note: `${registered} registered${stoppedNow > 0 ? ` · ${stoppedNow} stopped` : ""}` },
          { label: "Shadow agents", value: discovered, tone: discovered > 0 ? "bad" : "good", note: discovered > 0 ? "discovered, unregistered" : "none observed" },
          { label: "Trusted", value: trusted, tone: "good", note: "full trust posture" },
          { label: "Decisions evaluated", value: totalEvents, note: "across every plane", onClick: () => nav("live") },
        ]} />
      </div>

      <PageTabs storageKey="agents" tabs={[
        {
          id: "inventory",
          label: "Inventory",
          count: AGENTS.length,
          content: AGENTS.length === 0 ? (
            <div className="card empty">No agents detected yet.</div>
          ) : (
            <>
              <SectionHead title="Inventory" sub="Every agent Wrapbox has identified, with owner, reach and current risk posture" />
              <FilterBar {...agentFilters.bar} placeholder="Search agent, provider, tool…" />
              {agentFilters.filtered.length === 0 ? (
                <div className="card empty">No agents match the current filters.</div>
              ) : (
              <CardGrid>
                {pagedAgents.rows.map((a) => {
                  const d = decisionsFor(a.id);
                  const last = lastActivity(a.id);
                  const seen = usersOf(a.id);
                  const TrustIcon = a.trust === "trusted" ? ShieldCheck : ShieldAlert;
                  const trustColor = a.trust === "trusted" ? "var(--allow)" : a.trust === "conditional" ? "var(--constrain)" : "var(--bad)";
                  return (
                    <EntityCard
                      key={a.id}
                      onClick={() => setOpen(a)}
                      tone={a.discovered ? "block" : undefined}
                      icon={<AgentMark agentId={a.id} size={26} />}
                      eyebrow={`${a.provider} · ${a.kind}`}
                      title={a.name}
                      status={
                        <>
                          {a.discovered && <Chip tone="critical">UNREGISTERED</Chip>}
                          {stopOf(a.id, s) && <Chip tone="block"><OctagonX size={12} /> STOPPED</Chip>}
                          {a.operator && <Chip tone="neutral"><Building2 size={12} /> supplier</Chip>}
                          <Chip tone={trustTone(a.trust)}><TrustIcon size={12} strokeWidth={1.9} style={{ color: trustColor }} /> {a.trust}</Chip>
                          <RiskChip r={a.risk} />
                        </>
                      }
                      fields={[
                        {
                          label: a.operator ? "Sponsor" : "Owner",
                          value: a.owner ? (
                            <><Avatar userId={a.owner} size={16} />{userById(a.owner)?.name}<span className="faint">· {a.device ? deviceById(a.device)?.name : "—"}</span></>
                          ) : <span className="faint">unknown</span>,
                        },
                        ...(a.operator ? [{
                          label: "Operated by",
                          value: (() => { const sp = supplierById(a.operator)!; const live = supplierActive(sp); return <>{sp.name}<span className="faint">· {live ? `contract until ${sp.contractEnds}` : `contract ended ${sp.contractEnds}`}</span></>; })(),
                        }] : []),
                        {
                          label: "Used by",
                          value: seen.length === 0 ? <span className="faint">nobody yet</span> : seen.map((u) => (
                            <span key={u.user} className="row" style={{ gap: 5, flexWrap: "nowrap" }}>
                              <Avatar userId={u.user} size={16} />{userById(u.user)?.name ?? u.user}
                            </span>
                          )),
                        },
                        { label: "Tools", value: a.tools.map((t) => <Chip key={t} tone="neutral">{t}</Chip>) },
                        {
                          label: "Reach",
                          value: a.destinations.map((x) => (
                            <span key={x} className="row" style={{ gap: 5, flexWrap: "nowrap" }}>
                              <DestMark destId={x} size={14} /><span>{destById(x)?.label ?? x}</span>
                            </span>
                          )),
                        },
                        {
                          label: "Activity",
                          value: (
                            <span className="row" style={{ gap: 5 }}>
                              <Activity size={12} strokeWidth={1.9} />
                              <span className="tnum">{d.total} events</span>
                              {d.blocked > 0 && <span style={{ color: "var(--bad)" }} className="tnum">· {d.blocked} blocked</span>}
                              <span className="faint">· {last ? timeAgo(last) : "no activity"}</span>
                            </span>
                          ),
                        },
                      ]}
                    />
                  );
                })}
              </CardGrid>
              )}
              <Pager {...pagedAgents} />
            </>
          ),
        },
        {
          id: "suppliers",
          label: "Suppliers",
          count: SUPPLIERS.length,
          content: (
            <>
              <SectionHead title="Supplier agents" sub={`Third parties whose agents act inside ${ORG.short}'s systems. The contract is their authority: nothing outside its scope, and nothing at all once it ends.`} />
              <CardGrid>
                {SUPPLIERS.map((sp) => {
                  const theirs = AGENTS.filter((a) => a.operator === sp.id);
                  const evs = s.events.filter((e) => e.operator === sp.id);
                  const live = supplierActive(sp);
                  return (
                    <EntityCard
                      key={sp.id}
                      icon={<Building2 size={20} />}
                      eyebrow={sp.service}
                      title={sp.name}
                      tone={live ? undefined : "block"}
                      status={<Chip tone={live ? "allow" : "block"}>{live ? `contract until ${sp.contractEnds}` : `contract ended ${sp.contractEnds}`}</Chip>}
                      fields={[
                        { label: "Agents", value: theirs.map((a) => <span key={a.id} className="row" style={{ gap: 5, flexWrap: "nowrap" }}><AgentMark agentId={a.id} size={14} />{a.name}</span>) },
                        { label: "Contracted scope", value: <>{sp.scopeActions.join(", ")} on {sp.scopeResources.map((r) => resourceById(r)?.name ?? r).join(", ")}</> },
                        { label: "Data agreement", value: sp.dpa ? "DPA signed — personal and financial data allowed in scope" : "No DPA — no personal or financial data" },
                        { label: "Sponsor", value: <><Avatar userId={sp.sponsor} size={16} />{userById(sp.sponsor)?.name}<span className="faint">· vendor review by {userById(sp.reviewedBy)?.name}</span></> },
                        { label: "Recorded actions", value: <span className="tnum">{evs.length} · {evs.filter((e) => e.decision === "BLOCK").length} blocked</span> },
                      ]}
                    />
                  );
                })}
              </CardGrid>
            </>
          ),
        },
        {
          id: "activity",
          label: "Agent activity",
          count: streamShown,
          content: (
            <>
              <SectionHead title="Agent activity" sub="The live decision stream across all agents, newest first" right={<button className="btn btn-sm" onClick={() => nav("live")}>Live Actions <ArrowRight size={13} /></button>} />
              {streamShown === 0 ? (
                <div className="card empty">No agent activity recorded yet.</div>
              ) : (
                <EventStream events={s.events} nav={nav} compact limit={streamLimit} filters={false} bare />
              )}
            </>
          ),
        },
      ]} />

      {open && (
        <Drawer onClose={() => setOpen(null)}>
          <h2 style={{ fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
            <AgentMark agentId={open.id} size={20} />{open.name}
          </h2>
          <div className="row small dim" style={{ marginBottom: 12 }}>
            {open.provider} · {open.kind}
            {open.discovered && <Chip tone="critical">SHADOW AGENT — discovered by traffic analysis</Chip>}
          </div>
          {!open.discovered && <KillSwitch agent={open} />}
          {(() => { const t = taintOf(open.id, Date.now(), s); return t ? (
            <div className="small" style={{ marginBottom: 12, color: "var(--review)", display: "flex", gap: 6, alignItems: "center" }}>
              <Eye size={14} /> Under closer watch: read {t.label} {timeAgo(t.at)} — its risky actions go to a person until {new Date(t.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
            </div>) : null; })()}
          <dl className="kv">
            <dt>{open.operator ? "Sponsor" : "Owner"}</dt><dd>{open.owner ? `${userById(open.owner)?.name} (${open.operator ? "${ORG.short} sponsor, accountable" : "registered it, accountable"})` : "unknown — no registered owner"}</dd>
            {open.operator && (() => { const sp = supplierById(open.operator)!; return <><dt>Operated by</dt><dd>{sp.name} · {sp.service} · {supplierActive(sp) ? `contract until ${sp.contractEnds}` : `contract ended ${sp.contractEnds} — no authority`} · scope {sp.scopeActions.join("/")} on {sp.scopeResources.map((r) => resourceById(r)?.name ?? r).join(", ")}</dd></>; })()}
            <dt>{open.discovered ? "Seen on" : open.location && open.location !== "laptop" ? "Runs on" : "Registered on"}</dt><dd>{open.device ? deviceById(open.device)?.name : "—"}</dd>
            <dt>Used by</dt>
            <dd>
              {usersOf(open.id).length === 0 ? "nobody yet" : usersOf(open.id).map((u) => (
                <div key={u.user} className="row" style={{ gap: 6 }}>
                  <Avatar userId={u.user} size={18} />{userById(u.user)?.name ?? u.user}
                  <span className="faint">on {deviceById(u.device)?.name ?? u.device}</span>
                </div>
              ))}
            </dd>
            <dt>Environment</dt><dd>{open.environment}</dd>
            <dt>Tools</dt><dd>{open.tools.join(", ")}</dd>
            <dt>Destinations</dt><dd>{open.destinations.map((x) => destById(x)?.label ?? x).join(", ")}</dd>
            <dt>Trust</dt><dd>{open.trust}</dd>
            <dt>Risk</dt><dd><RiskChip r={open.risk} /></dd>
          </dl>
          {open.discovered && (
            <div className="card" style={{ marginTop: 12, borderColor: "var(--bad)" }}>
              <b className="small">Why this appears here</b>
              <div className="small dim">
                Wrapbox observed an unregistered MCP server (tcp/7823) initiating external transfers from Finance-Laptop-07.
                Observation never widens authority — this agent has no granted permissions, and its external destinations
                are evaluated as UNKNOWN_EXTERNAL (fail-safe).
              </div>
            </div>
          )}
          <hr className="divider" />
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>Recent decisions for this agent</h3>
          <div className="small">
            {s.events.filter((e) => e.agent === open.id).slice(-6).reverse().map((e) => (
              <div key={e.id} className="stream-item">
                <span className="stream-text">
                  <span className="stream-sentence">{describe(e)}</span>
                  <span className="stream-meta">
                    <span className="stream-who"><Avatar userId={e.user} size={16} />{userById(e.user)?.name ?? e.user}</span>
                    <span className="sep">·</span>{timeAgo(e.timestamp)}
                    <span className="sep">·</span><span className="mono">{e.action}</span>
                  </span>
                </span>
                <DecisionChip d={e.decision} small />
              </div>
            ))}
            {s.events.filter((e) => e.agent === open.id).length === 0 && <div className="empty">No recorded activity.</div>}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={() => { setOpen(null); nav("trust"); }}>View in Trust Graph</button>
            <button className="btn btn-sm" onClick={() => { setOpen(null); nav("evidence"); }}>Open Evidence</button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
