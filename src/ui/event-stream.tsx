// Shared filterable event stream — used by Live Actions and embedded elsewhere.
import { useMemo, useState } from "react";
import type { SimulationEvent } from "../model/types";
import { Avatar, AgentMark, DecisionChip, names, clock, RiskChip, usePaged, Pager, EntityCard, CardGrid, FilterBar } from "./kit";
import { EventDetail } from "./event-detail";
import { describe } from "./describe";
import { AGENTS, USERS } from "../model/org";

export function EventStream({
  events, nav, compact, limit, filters = true, bare,
}: {
  events: SimulationEvent[];
  nav: (r: string) => void;
  compact?: boolean;
  limit?: number;
  filters?: boolean;
  bare?: boolean;
}) {
  const [fAgent, setFAgent] = useState("");
  const [fUser, setFUser] = useState("");
  const [fPlane, setFPlane] = useState("");
  const [fDecision, setFDecision] = useState("");
  const [fRisk, setFRisk] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SimulationEvent | null>(null);

  const filtered = useMemo(() => {
    let list = [...events].sort((a, b) => b.timestamp - a.timestamp);
    if (fAgent) list = list.filter((e) => e.agent === fAgent);
    if (fUser) list = list.filter((e) => e.user === fUser);
    if (fPlane) list = list.filter((e) => e.plane === fPlane);
    if (fDecision) list = list.filter((e) => e.decision === fDecision);
    if (fRisk) list = list.filter((e) => e.risk === fRisk);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((e) =>
        [e.resource, e.actionRaw, e.action, e.id, ...(e.dataClasses)].join(" ").toLowerCase().includes(s)
      );
    }
    return limit ? list.slice(0, limit) : list;
  }, [events, fAgent, fUser, fPlane, fDecision, fRisk, q, limit]);
  // Full streams page at 12 rows; embedded previews (`limit`) show their slice as-is.
  const paged = usePaged(filtered, limit ? Math.max(filtered.length, 1) : 12, [fAgent, fUser, fPlane, fDecision, fRisk, q].join("|"));

  const anyFilter = !!(fAgent || fUser || fPlane || fDecision || fRisk || q);
  const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));
  const toneOf = (d: string) => (d === "BLOCK" ? "block" : d === "REVIEW" ? "review" : undefined) as "block" | "review" | undefined;

  return (
    <>
      {filters && (
        <FilterBar
          query={q}
          onQuery={setQ}
          placeholder="Search resource, action, data class…"
          filters={[
            { id: "agent", label: "Agent", options: AGENTS.map((a) => ({ value: a.id, label: a.name })) },
            { id: "user", label: "Person", options: USERS.map((u) => ({ value: u.id, label: u.name })) },
            { id: "plane", label: "Plane", options: opts(["ENDPOINT", "NETWORK", "GATEWAY", "BROWSER", "HOSTED"]) },
            { id: "decision", label: "Decision", options: opts(["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"]) },
            { id: "risk", label: "Risk", options: opts(["low", "moderate", "high", "critical"]) },
          ]}
          values={{ agent: fAgent, user: fUser, plane: fPlane, decision: fDecision, risk: fRisk }}
          onChange={(id, v) => ({ agent: setFAgent, user: setFUser, plane: setFPlane, decision: setFDecision, risk: setFRisk } as Record<string, (x: string) => void>)[id](v)}
          count={filtered.length}
          total={events.length}
          onClear={anyFilter ? () => { setFAgent(""); setFUser(""); setFPlane(""); setFDecision(""); setFRisk(""); setQ(""); } : undefined}
        />
      )}
      {filtered.length === 0 && <div className="card empty">No events match the current filters.</div>}
      <CardGrid>
        {paged.rows.map((e) => {
          const n = names(e);
          return (
            <EntityCard
              key={e.id}
              icon={<AgentMark agentId={e.agent} size={26} />}
              eyebrow={`${clock(e.timestamp)} · ${e.plane}`}
              title={describe(e)}
              status={<DecisionChip d={e.decision} small />}
              tone={toneOf(e.decision)}
              onClick={() => setOpen(e)}
              fields={[
                { label: "Person", value: <><Avatar userId={e.user} size={16} />{n.user}</> },
                { label: "Agent", value: <>{n.agent}{e.application && <span className="faint">· {e.application}</span>}</> },
                ...(compact ? [] : [
                  { label: "Action", value: <span className="mono">{e.action}</span> },
                  { label: "Risk", value: <RiskChip r={e.risk} /> },
                ]),
              ]}
            />
          );
        })}
      </CardGrid>
      <Pager {...paged} />
      {open && <EventDetail e={events.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} onNavigate={(r) => { setOpen(null); nav(r); }} />}
    </>
  );
}
