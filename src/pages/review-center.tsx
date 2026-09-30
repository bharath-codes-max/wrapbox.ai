// Review Center — only exceptional items; action, environment, data and
// destination, blast radius, requester vs. approver (separation of duties),
// expiry and a safer alternative. Related steps also arrive bundled.
import { useState } from "react";
import { useAppState, resolveReview, approverFor } from "../state/store";
import { PageHead, SectionHead, MetricBar, DecisionChip, Chip, RiskChip, SimNote, names, timeAgo, StatusChip, Avatar, AgentMark, DestMark, PageTabs, usePaged, Pager, EntityCard, CardGrid, FilterBar, useCardFilters } from "../ui/kit";
import { describe } from "../ui/describe";
import { userById } from "../model/org";
import { EventDetail } from "../ui/event-detail";
import type { SimulationEvent } from "../model/types";
import { Hand, Layers, CheckCircle2, XCircle, ArrowRight, UserCheck } from "lucide-react";

export function ReviewCenter({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [open, setOpen] = useState<SimulationEvent | null>(null);
  const pending = s.events.filter((e) => e.reviewState?.status === "pending").sort((a, b) => b.timestamp - a.timestamp);
  const resolved = s.events.filter((e) => e.reviewState && e.reviewState.status !== "pending").sort((a, b) => (b.reviewState?.decidedAt ?? 0) - (a.reviewState?.decidedAt ?? 0));

  // Transaction bundling: group pending items from the same agent + task.
  const bundles = new Map<string, SimulationEvent[]>();
  for (const e of pending) {
    const key = e.taskId ?? `${e.agent}-single-${e.id}`;
    bundles.set(key, [...(bundles.get(key) ?? []), e]);
  }

  const approved = resolved.filter((e) => e.reviewState!.status.startsWith("approved")).length;
  const constrained = resolved.filter((e) => e.reviewState!.status === "constrained").length;
  const denied = resolved.filter((e) => e.reviewState!.status === "denied").length;

  // Presentation only: page through bundles and the resolved log so neither tab
  // becomes a long scroll. Counts above are always over the full lists.
  const pagedBundles = usePaged([...bundles.entries()], 2);
  const RESOLUTION: Record<string, string> = {
    approved: "Approved", approved_scoped: "Approved (scoped)", constrained: "Constrained", denied: "Denied", expired: "Expired",
  };
  const rf = useCardFilters(resolved, {
    filters: [
      { id: "resolution", label: "Resolution", get: (e) => e.reviewState!.status, format: (v) => RESOLUTION[v] ?? v },
      { id: "approver", label: "Approver", get: (e) => e.reviewState!.reviewer, format: (v) => userById(v)?.name ?? v },
    ],
  });
  const pagedResolved = usePaged(rf.filtered, 8, rf.resetKey);

  return (
    <div className="page">
      <PageHead
        eyebrow="Authorization"
        title="Review Center"
        sub="Humans review exceptions, not every action. Each pending request shows the action, environment, data and destination, blast radius, requester, required approver, expiry and a safer alternative — and the requester can never approve their own action."
        right={<SimNote>Each request goes to the right approver — never the requester</SimNote>}
      />

      {/* Lead with the inbox — the work that needs a human. Counts live in the
          tab strip and section header, not in a row of oversized number boxes. */}
      <PageTabs storageKey="reviews" tabs={[
        { id: "pending", label: "Awaiting your decision", count: pending.length, content: (<>
          <SectionHead
            title="Awaiting your decision"
            sub="Each request shows the action, environment, data and destination, blast radius, expiry and a safer alternative before you act — related steps arrive together"
            right={
              <div className="row" style={{ gap: 8 }}>
                <Chip tone={pending.length > 0 ? "review" : "allow"}>
                  <Hand size={12} /> {pending.length} awaiting
                </Chip>
                {bundles.size > 0 && (
                  <Chip tone="neutral"><Layers size={12} /> {bundles.size} bundle{bundles.size === 1 ? "" : "s"}</Chip>
                )}
              </div>
            }
          />

          {pending.length === 0 ? (
            <div className="card empty">
              Nothing waiting — every exception has been decided. Normal safe work auto-allows; transformable work auto-constrains.
              Generate exceptions from the <a onClick={() => nav("simlab")}>Simulation Lab</a> or <a onClick={() => nav("tasks")}>Tasks</a>.
            </div>
          ) : (<>
            <div className="grid" style={{ gap: 16 }}>
              {pagedBundles.rows.map(([key, evs]) => {
                const isBundle = evs.length > 1 || evs[0].taskId !== undefined;
                const first = evs[0];
                const n = names(first);
                const task = first.taskId ? s.tasks.find((t) => t.taskId === first.taskId) : undefined;
                return (
                  <div key={key} className="rc-bundle">
                    {/* Bundle header — what, who asked, who decides, risk & expiry */}
                    <EntityCard
                      icon={<AgentMark agentId={first.agent} size={26} />}
                      eyebrow={isBundle ? `Bundle · ${evs.length} step${evs.length === 1 ? "" : "s"}` : "Single request"}
                      title={task ? `${task.team ?? "Task"} · “${task.title}”` : describe(first)}
                      tone="review"
                      status={<>
                        <RiskChip r={first.risk} />
                        <Chip tone="review">expires {new Date(first.reviewState!.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Chip>
                        {/* Separation of duties, made visible — resolveReview() enforces it. */}
                        {approverFor(first) !== first.user && <Chip tone="allow"><UserCheck size={12} /> requester ≠ approver</Chip>}
                      </>}
                      fields={[
                        { label: "Requested by", value: <><Avatar userId={first.user} size={16} />{n.user}<span className="faint">via {n.agent}{first.application ? ` (${first.application})` : ""} · {timeAgo(first.timestamp)}</span></> },
                        { label: "Decides", value: <><Avatar userId={approverFor(first)} size={16} />{userById(approverFor(first))?.name}<span className="faint">· {task?.approverRole ?? userById(approverFor(first))?.role}</span></> },
                        ...(isBundle && task ? [{ label: "Progress", value: `${task.steps.length} steps · ${task.steps.filter((x) => x.state === "done").length} already done · ${evs.length} need${evs.length === 1 ? "s" : ""} a yes` }] : []),
                      ]}
                    />

                    {/* One card per action in the bundle */}
                    {evs.map((e) => {
                      const en = names(e);
                      const br = e.blastRadius;
                      const brBits: { k: string; v: string }[] = [];
                      if (br) {
                        if (typeof br.files === "number") brBits.push({ k: "files", v: br.files.toLocaleString("en-US") });
                        if (typeof br.rows === "number") brBits.push({ k: "rows", v: br.rows.toLocaleString("en-US") });
                        if (typeof br.records === "number") brBits.push({ k: "records", v: br.records.toLocaleString("en-US") });
                        if (typeof br.recipients === "number") brBits.push({ k: "recipients", v: br.recipients.toLocaleString("en-US") });
                        if (typeof br.spendUsd === "number") brBits.push({ k: "spend", v: `$${br.spendUsd.toLocaleString("en-US")}` });
                      }
                      return (
                        <div key={e.id} className="card" style={{ marginTop: 12 }}>
                          <div className="spread" style={{ alignItems: "flex-start", gap: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="stream-sentence">{describe(e)}</div>
                              <div className="stream-meta" style={{ gap: 8 }}>
                                <span className="mono">{e.actionRaw ?? e.action}</span>
                                <span className="faint">·</span>
                                <span className="row" style={{ gap: 5, flexWrap: "nowrap" }}><Avatar userId={e.user} size={16} />{en.user}</span>
                                <span className="faint">·</span>
                                <span>{e.environment}</span>
                                {e.destination && (
                                  <>
                                    <span className="faint">·</span>
                                    <span className="row" style={{ gap: 5, flexWrap: "nowrap" }}><DestMark destId={e.destination} size={14} />{en.destination}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <DecisionChip d="REVIEW" small />
                          </div>

                          <div className="grid g3" style={{ marginTop: 14 }}>
                            <div>
                              <div className="stat-label">Why</div>
                              <div className="small dim" style={{ marginTop: 4 }}>{e.decisionReasons[0]}</div>
                            </div>
                            {br && (
                              <div>
                                <div className="stat-label">Blast radius / preflight</div>
                                <div className="small dim" style={{ marginTop: 4 }}>{br.label}</div>
                                {brBits.length > 0 && (
                                  <div className="row" style={{ gap: 5, marginTop: 6 }}>
                                    {brBits.map((b) => (
                                      <Chip key={b.k} tone="neutral">{b.v} {b.k}</Chip>
                                    ))}
                                  </div>
                                )}
                                {br.dependencies && <div className="faint small" style={{ marginTop: 6 }}>deps: {br.dependencies.join(", ")}</div>}
                              </div>
                            )}
                            {e.safeAlternative && (
                              <div>
                                <div className="stat-label">Safer alternative</div>
                                <div className="small dim" style={{ marginTop: 4 }}>{e.safeAlternative}</div>
                              </div>
                            )}
                          </div>

                          <div className="row" style={{ marginTop: 16, gap: 8 }}>
                            <button className="btn btn-good btn-sm" onClick={() => resolveReview(e.id, "approved", approverFor(e), "Approved once")}><CheckCircle2 size={13} /> Approve once</button>
                            <button className="btn btn-sm" onClick={() => resolveReview(e.id, "approved_scoped", approverFor(e), "Scoped", "This resource only · 4h · no wider authority")}>Approve scoped</button>
                            <button className="btn btn-warn btn-sm" onClick={() => resolveReview(e.id, "constrained", approverFor(e), "Constrained to the safer alternative")}>Constrain</button>
                            <button className="btn btn-danger btn-sm" onClick={() => resolveReview(e.id, "denied", approverFor(e), "Denied")}><XCircle size={13} /> Deny</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(e)} style={{ marginLeft: "auto" }}>Full evidence <ArrowRight size={13} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <Pager {...pagedBundles} />
          </>)}
        </>) },

        { id: "resolved", label: "Resolved", count: resolved.length, content: (<>
          <SectionHead
            title="Resolved"
            sub="A denied review remains denied. Approvals are per-action and never silently widen later scope."
          />

          {resolved.length === 0 ? (
            <div className="card empty">
              No decisions yet — approved, constrained and denied exceptions appear here once a reviewer acts.
            </div>
          ) : (<>
            {/* Refined outcome strip — small numbers in one carded band. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <MetricBar band items={[
                { label: "Approved", value: approved, tone: approved > 0 ? "good" : undefined, note: "per-action, never widened later" },
                { label: "Constrained", value: constrained, tone: constrained > 0 ? "info" : undefined, note: "steered to a safer path" },
                { label: "Denied", value: denied, tone: denied > 0 ? "bad" : undefined, note: "stays denied; no silent retry" },
                { label: "Decided", value: resolved.length, note: "exceptions closed by a human" },
              ]} />
            </div>

            <FilterBar {...rf.bar} />
            {rf.filtered.length === 0 ? (
              <div className="card empty">No resolved reviews match the current filters.</div>
            ) : (
              <CardGrid>
                {pagedResolved.rows.map((e) => {
                  const n = names(e);
                  const r = e.reviewState!;
                  const reviewer = r.reviewer;
                  return (
                    <EntityCard
                      key={e.id}
                      icon={<AgentMark agentId={e.agent} size={26} />}
                      eyebrow={RESOLUTION[r.status] ?? r.status}
                      title={describe(e)}
                      status={<StatusChip s={r.status} />}
                      tone={r.status === "denied" ? "block" : r.status === "constrained" ? "constrain" : r.status.startsWith("approved") ? "allow" : undefined}
                      onClick={() => setOpen(e)}
                      fields={[
                        { label: "Requester", value: <><Avatar userId={e.user} size={16} />{n.user}</> },
                        { label: "Approver", value: reviewer ? <><Avatar userId={reviewer} size={16} />{userById(reviewer)?.name ?? reviewer}</> : <span className="faint">—</span> },
                        { label: "Decided", value: r.decidedAt ? timeAgo(r.decidedAt) : <span className="faint">—</span> },
                        { label: "Note / scope", value: <span className="dim">{r.scope ?? r.note ?? "—"}</span> },
                        { label: "Action", value: <span className="mono">{e.action}</span> },
                      ]}
                    />
                  );
                })}
              </CardGrid>
            )}
            <Pager {...pagedResolved} />
          </>)}
        </>) },
      ]} />

      {open && <EventDetail e={s.events.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} onNavigate={(r) => { setOpen(null); nav(r); }} />}
    </div>
  );
}
