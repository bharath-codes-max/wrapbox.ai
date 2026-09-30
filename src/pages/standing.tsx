// Standing Permissions — an agent's everyday authority on one system, outside
// any task. Enforced by the Core Brain: in-scope work flows, limits and the
// "may not" list apply, and once revoked or expired that agent's work there
// needs a human yes. Inside a task, the task's permission slip is the authority.
import { useMemo, useState } from "react";
import { useAppState, revokeStanding, grantStandingAgain, shadowEvaluate } from "../state/store";
import { PageHead, SectionHead, MetricBar, Chip, SimNote, AgentMark, Avatar, DecisionChip, PageTabs, EntityCard, CardGrid } from "../ui/kit";
import { agentById, resourceById, userById } from "../model/org";
import { scenarioById } from "../engine/scenarios";
import { describe } from "../ui/describe";
import type { StandingPermission } from "../model/types";
import { ShieldCheck, Clock, Ban, Check, X, ArrowRight, Activity, RotateCcw } from "lucide-react";

export function StandingPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [confirming, setConfirming] = useState<string | null>(null);
  const daysLeftOf = (p: StandingPermission) => Math.max(0, Math.round((p.expiresAt - Date.now()) / (24 * 3600 * 1000)));
  const isActive = (p: StandingPermission) => p.status === "active" && p.expiresAt > Date.now();
  const active = s.standing.filter(isActive);
  const expiringSoon = active.filter((p) => daysLeftOf(p) <= 2).length;

  // Everyday (non-task) actions each permission covers, and what revoking it would change.
  const impact = useMemo(() => {
    const out: Record<string, { used: number; wouldReview: { id: string; text: string }[] }> = {};
    for (const p of s.standing) {
      const covered = s.events.filter((e) => e.agent === p.agent && e.resource === p.resource && !e.taskId);
      const revoked = s.standing.map((x) => (x.id === p.id ? { ...x, status: "revoked" as const } : x));
      const wouldReview = covered
        .filter((e) => e.scenario && scenarioById(e.scenario))
        .filter((e) => {
          const sc = scenarioById(e.scenario!)!;
          const now = shadowEvaluate(sc, s.contracts, s.kernel, s.standing);
          const after = shadowEvaluate(sc, s.contracts, s.kernel, revoked);
          return now !== after;
        })
        .map((e) => ({ id: e.id, text: describe(e) }));
      out[p.id] = { used: covered.length, wouldReview };
    }
    return out;
  }, [s.standing, s.events, s.contracts, s.kernel]);

  const totalUsed = Object.values(impact).reduce((n, x) => n + x.used, 0);
  // Everything not in force: the complement of `active`, so the two tabs always partition s.standing.
  const inactive = s.standing.filter((p) => !isActive(p));

  const renderCard = (p: StandingPermission) => {
    const on = isActive(p);
    const imp = impact[p.id];
    const res = resourceById(p.resource)?.name ?? p.resource;
    const soon = daysLeftOf(p) <= 2;
    const may = [
      ...p.allowed,
      ...(p.maxRows !== undefined ? [`at most ${p.maxRows} rows per query`] : []),
      ...(p.maxFilesPerTask > 0 ? [`at most ${p.maxFilesPerTask} files per task (enforced by the task's slip)`] : []),
    ];
    const list = (items: string[], ok: boolean) => (
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((x) => (
          <span key={x} className="row" style={{ gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
            {ok ? <Check size={13} style={{ color: "var(--allow)", flexShrink: 0, marginTop: 3 }} /> : <X size={13} style={{ color: "var(--block)", flexShrink: 0, marginTop: 3 }} />}
            <span style={{ lineHeight: 1.5 }}>{x}</span>
          </span>
        ))}
      </span>
    );
    const action = on ? (
      confirming === p.id ? (
        <>
          <button className="btn btn-danger btn-sm" onClick={() => { revokeStanding(p.id); setConfirming(null); }}>Yes, revoke</button>
          <button className="btn btn-sm" onClick={() => setConfirming(null)}>Cancel</button>
        </>
      ) : (
        <button className="btn btn-danger btn-sm" onClick={() => setConfirming(p.id)}>Revoke</button>
      )
    ) : (
      <button className="btn btn-sm" onClick={() => grantStandingAgain(p.id, "u-priya")}><RotateCcw size={13} /> Grant again for 7 days</button>
    );
    return (
      <EntityCard
        key={p.id}
        tone={on ? undefined : "block"}
        icon={<AgentMark agentId={p.agent} size={26} />}
        eyebrow={res}
        title={`${agentById(p.agent)?.name ?? p.agent} — everyday permission`}
        status={
          <>
            <Chip tone={on ? "allow" : "block"}>{on ? "ACTIVE" : p.status === "revoked" ? "REVOKED" : "EXPIRED"}</Chip>
            {on && <Chip tone={soon ? "review" : "neutral"}><Clock size={11} /> expires in {daysLeftOf(p)}d</Chip>}
          </>
        }
        action={action}
        fields={[
          { label: "May", value: list(may, true) },
          { label: "May not", value: list(p.forbidden, false) },
          { label: "Granted by", value: <><Avatar userId={p.grantedBy} size={16} />{userById(p.grantedBy)?.name}</> },
          {
            label: "Impact",
            value: (
              <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="row" style={{ gap: 6, alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <Activity size={13} className="faint" style={{ flexShrink: 0, marginTop: 3 }} />
                  <span style={{ lineHeight: 1.5 }}>
                    <b>Used {imp.used} time{imp.used === 1 ? "" : "s"}</b> for everyday work.{" "}
                    {on ? (
                      imp.wouldReview.length === 0
                        ? "Revoking it would not change any recorded action."
                        : <>If you revoked it, <b>{imp.wouldReview.length}</b> of those would have needed a human yes:</>
                    ) : (
                      <>Revoked — {agentById(p.agent)?.name}'s work on {res} now needs a human yes.</>
                    )}
                  </span>
                </span>
                {on && imp.wouldReview.slice(0, 3).map((w) => (
                  <span key={w.id} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <DecisionChip d="ALLOW" small /><ArrowRight size={12} className="faint" style={{ flexShrink: 0 }} /><DecisionChip d="REVIEW" small /><span className="dim" style={{ minWidth: 0 }}>{w.text}</span>
                  </span>
                ))}
              </span>
            ),
          },
        ]}
      >
        {confirming === p.id && on && (
          <span className="small">Revoke {agentById(p.agent)?.name}'s everyday permission on {res}?</span>
        )}
      </EntityCard>
    );
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="Authorization"
        title="Standing Permissions"
        sub="An agent's everyday authority on one system, outside any task. While it's active, normal work flows; its limits and 'may not' list are enforced; once revoked or expired, that agent's work there needs a human yes."
        right={<SimNote>Enforced by the Core Brain</SimNote>}
      />

      <div className="card">
        <MetricBar
          band
          items={[
            { label: "Active", value: active.length, tone: "good", note: "in force right now" },
            { label: "Expiring soon", value: expiringSoon, tone: expiringSoon > 0 ? "warn" : "good", note: "within 2 days" },
            { label: "Revoked / expired", value: s.standing.length - active.length, note: "needs a yes again" },
            { label: "Everyday actions covered", value: totalUsed, note: "recorded, outside tasks" },
          ]}
        />
      </div>

      <PageTabs storageKey="standing" tabs={[
        {
          id: "active",
          label: "Active",
          count: active.length,
          content: active.length === 0 ? (
            s.standing.length === 0 ? (
              <div className="card empty"><ShieldCheck size={26} className="dim" /><div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>No standing permissions yet</div><div className="small dim" style={{ maxWidth: 480, margin: "6px auto 0", lineHeight: 1.55 }}>Until one is granted, every agent action on these systems needs a human yes.</div></div>
            ) : (
              <div className="card empty"><ShieldCheck size={26} className="dim" /><div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>No standing permission is in force</div><div className="small dim" style={{ maxWidth: 480, margin: "6px auto 0", lineHeight: 1.55 }}>Every one has been revoked or has expired, so every agent action on these systems needs a human yes. Grant one again from Revoked &amp; expired.</div></div>
            )
          ) : (
            <>
              <SectionHead title="Active permissions" sub="Who holds each one, what it allows, what it never allows, and what would change if you revoked it" />
              <CardGrid>{active.map(renderCard)}</CardGrid>
            </>
          ),
        },
        {
          id: "inactive",
          label: "Revoked & expired",
          count: inactive.length,
          content: inactive.length === 0 ? (
            <div className="card empty"><Ban size={26} className="dim" /><div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>Nothing revoked or expired</div><div className="small dim" style={{ maxWidth: 480, margin: "6px auto 0", lineHeight: 1.55 }}>A permission lands here the moment it is revoked or passes its expiry, and can be granted again from here.</div></div>
          ) : (
            <>
              <SectionHead title="Revoked & expired" sub="No longer in force: that agent's work on the system needs a human yes until the permission is granted again" />
              <CardGrid>{inactive.map(renderCard)}</CardGrid>
            </>
          ),
        },
      ]} />

      <div className="small faint row" style={{ gap: 6, marginTop: 16 }}>
        Inside a task, the task's own permission slip is the authority instead —
        <a className="row" style={{ gap: 4 }} onClick={() => nav("tasks")}>Tasks <ArrowRight size={13} /></a>
      </div>
    </div>
  );
}
