// Evidence Explorer — searchable, tamper-evident event evidence with the
// full causal chain and a graph/timeline view.
import { useMemo, useState } from "react";
import { useAppState } from "../state/store";
import { PageHead, SectionHead, MetricBar, DecisionChip, Chip, SimNote, names, EvidenceChain, RiskChip, Avatar, AgentMark, DestMark, usePaged, Pager, EntityCard, CardGrid, FilterBar, useCardFilters, clock } from "../ui/kit";
import { describe } from "../ui/describe";
import { EventDetail } from "../ui/event-detail";
import type { SimulationEvent } from "../model/types";
import { ORG, userById, AGENTS, USERS, SUPPLIERS } from "../model/org";
import { planeLabel } from "../model/registries";
import { toOcsfBatch, toOtlpLogs, OCSF_VERSION } from "../engine/export";
import { FileClock, LayoutGrid, GitBranch, Download } from "lucide-react";

/** Save decision records as a file — the same records the ledger shows. */
function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

// The human's answer to a REVIEW, kept separate from Wrapbox's own decision.
const REVIEW_OUTCOME: Record<string, [string, string]> = {
  pending: ["review", "Waiting"],
  approved: ["allow", "Approved"],
  approved_scoped: ["allow", "Approved (scoped)"],
  constrained: ["constrain", "Constrained"],
  denied: ["block", "Denied"],
  expired: ["neutral", "Expired"],
};

function HumanReview({ e }: { e: SimulationEvent }) {
  const r = e.reviewState;
  if (!r) return <span className="faint">—</span>;
  const [tone, label] = REVIEW_OUTCOME[r.status] ?? ["neutral", r.status];
  return (
    <>
      <Chip tone={tone}>{label}</Chip>
      {r.reviewer && <span className="small faint">by {userById(r.reviewer)?.name ?? r.reviewer}</span>}
    </>
  );
}

export function EvidenceExplorer({ nav }: { nav: (r: string) => void; route: string }) {
  const s = useAppState();
  const [view, setView] = useState<"cards" | "graph">("cards");
  const [open, setOpen] = useState<SimulationEvent | null>(null);

  const sorted = useMemo(() => [...s.events].sort((a, b) => b.timestamp - a.timestamp), [s.events]);
  const f = useCardFilters(sorted, {
    search: (e) => [e.id, describe(e), e.action, e.actionRaw, e.resource, e.decision, ...e.dataClasses,
      ...e.matchedContracts.map((m) => m.clauseText), ...e.safetyRules.map((r) => r.name),
      e.mcp ? `${e.mcp.tool} mcp` : "", e.decidedBy?.label ?? ""].join(" "),
    filters: [
      { id: "decision", label: "Decision", get: (e) => e.decision, options: ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"].map((v) => ({ value: v, label: v })) },
      { id: "agent", label: "Agent", get: (e) => e.agent, format: (v) => AGENTS.find((a) => a.id === v)?.name ?? v },
      { id: "user", label: "Person", get: (e) => e.user, format: (v) => USERS.find((u) => u.id === v)?.name ?? v },
      { id: "risk", label: "Risk", get: (e) => e.risk, options: ["low", "moderate", "high", "critical"].map((v) => ({ value: v, label: v })) },
      { id: "plane", label: "Plane", get: (e) => e.plane, format: (v) => planeLabel(v as SimulationEvent["plane"]) },
      { id: "operator", label: "Operated by", get: (e) => e.operator ?? "veridian", format: (v) => v === "veridian" ? `${ORG.short}'s own agents` : SUPPLIERS.find((x) => x.id === v)?.name ?? v },
      { id: "review", label: "Human review", get: (e) => e.reviewState?.status ?? "none",
        options: [...Object.entries(REVIEW_OUTCOME).map(([v, [, label]]) => ({ value: v, label })), { value: "none", label: "No review" }] },
    ],
  });
  const list = f.filtered;
  const paged = usePaged(list, 8, f.resetKey);

  const tally = useMemo(() => ({
    total: s.events.length,
    blocked: s.events.filter((e) => e.decision === "BLOCK").length,
    reviewed: s.events.filter((e) => e.decision === "REVIEW").length,
    breakGlass: s.events.filter((e) => e.breakGlass).length,
  }), [s.events]);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Visibility"
        title="Evidence Explorer"
        sub="One complete record per decision: user, agent, tool, action, resource, environment, data, destination, policy, decision reason, approver and outcome — the whole story of the action in one place."
        right={<SimNote>Hash chain simulated — evidence model real</SimNote>}
      />

      {/* Ledger hero — the complete decision record first; tamper-evident chaining is the integrity layer beneath it */}
      <div className="card overview-card">
        <div className="spread" style={{ alignItems: "flex-start", gap: 20 }}>
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <span className="stat-icon" style={{ color: "var(--accent)", background: "var(--accent-soft)", flexShrink: 0 }}><FileClock size={17} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="section-title">Complete decision records</div>
              <div className="section-sub">Every record captures the user, agent, tool, action, resource, environment, data, destination, policy, decision reason, approver and outcome. Integrity: each record is hash-linked to the one before it, so alterations show up on inspection.</div>
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="eyebrow">Chain head</div>
            <div className="mono small" style={{ marginTop: 5, color: "var(--fg-2)" }}>{s.lastHash}</div>
          </div>
        </div>
        <div className="overview-sep" />
        <MetricBar band items={[
          { label: "Decision records", value: tally.total, note: "complete & hash-linked" },
          { label: "Blocked", value: tally.blocked, tone: tally.blocked > 0 ? "bad" : "good", note: "stopped before execution" },
          { label: "Reviewed", value: tally.reviewed, tone: tally.reviewed > 0 ? "warn" : "good", note: "escalated to a human" },
          { label: "Break-glass", value: tally.breakGlass, tone: tally.breakGlass > 0 ? "bad" : "good", note: "emergency overrides logged" },
        ]} />
      </div>

      <div className="section">
        <SectionHead
          title="Evidence ledger"
          sub={`${list.length} of ${s.events.length} events, newest first`}
          right={
            <div className="row" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6 }} aria-label="Export the records shown">
              <button className="btn btn-sm" disabled={list.length === 0} title={`OCSF ${OCSF_VERSION} — File System, Process, HTTP and API Activity classes`} onClick={() => download(`wrapbox-decisions-${stamp()}.ocsf.json`, toOcsfBatch(list))}><Download size={13} /> OCSF</button>
              <button className="btn btn-sm" disabled={list.length === 0} title="OpenTelemetry OTLP/JSON logs — POST to a collector's /v1/logs" onClick={() => download(`wrapbox-decisions-${stamp()}.otlp.json`, toOtlpLogs(list))}><Download size={13} /> OTLP</button>
            </div>
            <div className="row" style={{ gap: 0 }}>
              <button className={`btn btn-sm ${view === "cards" ? "btn-primary" : ""}`} style={{ borderRadius: "8px 0 0 8px" }} onClick={() => setView("cards")}><LayoutGrid size={13} /> Cards</button>
              <button className={`btn btn-sm ${view === "graph" ? "btn-primary" : ""}`} style={{ borderRadius: "0 8px 8px 0" }} onClick={() => setView("graph")}><GitBranch size={13} /> Causal graph</button>
            </div>
            </div>
          }
        />

        <FilterBar {...f.bar} placeholder="Search id, action, resource, data class, policy…" />

        {list.length === 0 ? (
          <div className="card empty">No evidence matches the current filters.</div>
        ) : view === "cards" ? (<>
          <CardGrid>
            {paged.rows.map((e) => {
              const n = names(e);
              return (
                <EntityCard
                  key={e.id}
                  icon={<AgentMark agentId={e.agent} size={26} />}
                  eyebrow={`${clock(e.timestamp)} · ${e.id}`}
                  title={<>{e.destination && <span style={{ marginRight: 6, verticalAlign: "-2px" }}><DestMark destId={e.destination} size={14} /></span>}{describe(e)}</>}
                  status={<>{e.breakGlass && <Chip tone="critical">BREAK-GLASS</Chip>}<DecisionChip d={e.decision} small /></>}
                  tone={e.decision === "BLOCK" ? "block" : e.decision === "REVIEW" ? "review" : undefined}
                  onClick={() => setOpen(e)}
                  fields={[
                    { label: "Actor", value: <><Avatar userId={e.user} size={16} />{n.user}<span className="faint">via {n.agent}{e.application ? ` (${e.application})` : ""}</span></> },
                    { label: "Data", value: e.dataClasses.length === 0
                      ? <span className="faint">—</span>
                      : <>{e.dataClasses.slice(0, 2).map((c) => <Chip key={c} tone="violet">{c}</Chip>)}{e.dataClasses.length > 2 && <span className="faint small">+{e.dataClasses.length - 2}</span>}</> },
                    { label: "Human review", value: <HumanReview e={e} /> },
                    { label: "Risk", value: <RiskChip r={e.risk} /> },
                    { label: "Seal", value: <span className="mono small faint">{e.evidence.hash} ← {e.evidence.prevHash}</span> },
                  ]}
                />
              );
            })}
          </CardGrid>
          <Pager {...paged} />
        </>) : (
          <div className="grid g2">
            {list.slice(0, 8).map((e) => {
              const n = names(e);
              return (
                <div key={e.id} className="card rowlink" onClick={() => setOpen(e)} style={{ cursor: "pointer" }}>
                  <div className="spread" style={{ marginBottom: 14, alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 7 }}>
                        <Avatar userId={e.user} size={20} />
                        <AgentMark agentId={e.agent} size={14} />
                        <span className="small" style={{ fontWeight: 550 }}>{n.user}</span>
                      </div>
                      <div className="small dim" style={{ marginTop: 7 }}>{describe(e)}</div>
                      <div className="mono faint" style={{ fontSize: 11, marginTop: 3 }}>{e.id} · {new Date(e.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <DecisionChip d={e.decision} small />
                  </div>
                  <EvidenceChain e={e} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && <EventDetail e={s.events.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} onNavigate={(r) => { setOpen(null); nav(r); }} />}
    </div>
  );
}
