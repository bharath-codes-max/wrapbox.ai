import { ArrowRight, Check, CircleSlash, Clock, FlaskConical, Lightbulb, Repeat2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { agentById } from "../data/agents";
import { SCENARIOS } from "../data/scenarios";
import { DecisionSpace, Signals, SlackCard } from "../components/insight";
import { Checks, PermitTicket, useCountdown } from "../components/permit";
import { Avatar, Button, Card, Chip, DecisionPill, Logo, PageHeader, cn } from "../components/ui";
import { approvalArgs, approvalPermitArgs, approveWithPasskey } from "../lib/actions";
import { canonical, mintPermit, sha256, short, verifyPermit, type Check as VCheck } from "../lib/permit";
import { ago, go } from "../lib/router";
import { EMPLOYEE, attachPermit, reject, toast, useStore, useWorkspace, type Approval } from "../lib/store";

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${(s / 3600).toFixed(1)}h`;
};

/** Suggestions an approver can act on, keyed by the rule that keeps producing requests. */
const SUGGEST: Record<string, string> = {
  "prod.k8s.delete": "Prefer `kubectl rollout restart` — it avoids downtime and could be ALLOW.",
  "payments.refund": "Most of this queue sits between the automatic tier and the block tier — raise the automatic tier if the rejection rate stays low.",
  "claims.payout": "Payouts under the first tier are automatic; everything here is above it by design.",
};

export function Approvals() {
  const role = useStore((s) => s.role);
  const all = useStore((s) => s.approvals);
  const eventCount = useStore((s) => s.events.length);
  const { labs } = useWorkspace();
  // v2 is read-only against the live Control Plane, which has no approval queue or Slack routing. The
  // simulated workspaces genuinely run both, so the empty-state copy is gated on this.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const mine = role === "employee";
  const list = mine ? all.filter((a) => a.approvers.some((p) => p.id === EMPLOYEE.id)) : all;
  const hidden = all.length - list.length;
  const [sel, setSel] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const current = list.find((a) => a.id === sel) ?? list.find((a) => a.status === "pending") ?? list[0];
  const pending = list.filter((a) => a.status === "pending");
  const done = list.filter((a) => a.status !== "pending");
  const shownDone = showAll ? done : done.slice(0, 25);
  // Derived from the resolved requests in this workspace — never a typed-in figure.
  const health = useMemo(() => {
    const resolved = all.filter((a) => a.status !== "pending" && a.resolvedAt);
    if (resolved.length < 3) return null;
    const times = resolved.map((a) => a.resolvedAt! - a.createdAt).sort((x, y) => x - y);
    const days = Math.max(1, Math.ceil((Date.now() - Math.min(...resolved.map((a) => a.createdAt))) / 86_400_000));
    const approvers = new Set(resolved.flatMap((a) => a.approvedBy.length ? a.approvedBy : a.approvers.map((p) => p.id)));
    return {
      days,
      median: times[Math.floor(times.length / 2)],
      perPersonDay: resolved.length / days / Math.max(1, approvers.size),
      rejected: resolved.filter((a) => a.status === "rejected").length / resolved.length,
      share: all.length / Math.max(1, eventCount),
    };
  }, [all, eventCount]);

  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={mine ? "Assigned to you as on-call SRE" : "Human step-up"}
        title={mine ? "My approvals" : "Approvals"}
        sub="Every request shows what the person asked for, exactly what will change, why policy stopped it, and how similar requests went. An approval is a passkey signature over the exact arguments — not a click."
      />
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-line text-[12px] font-medium text-fg-3">Waiting · {pending.length}</div>
            {pending.map((a) => (
              <Row key={a.id} a={a} active={current?.id === a.id} onClick={() => setSel(a.id)} />
            ))}
            {!pending.length && (
              <div className="px-5 py-8 text-[12.5px] text-fg-3">
                {cpBacked ? (
                  <>
                    No approval queue or Slack routing is running on this Control Plane yet. A REVIEW decision returns{" "}
                    <span className="font-mono">ask</span> to the agent's own client, which prompts the operator locally, and the signed receipt lands in{" "}
                    <a href="#/evidence" className="underline underline-offset-2 text-fg">
                      Evidence
                    </a>
                    . Routing REVIEW requests to this queue and to Slack is not implemented yet.
                  </>
                ) : (
                  <>
                    All clear. REVIEW decisions land here and in Slack the moment an agent hits one.
                    {labs && (
                      <>
                        {" "}
                        <a href="#/playground" className="underline underline-offset-2 text-fg">
                          Try one in the playground
                        </a>
                        .
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
          {done.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line text-[12px] font-medium text-fg-3">Resolved · {done.length}</div>
              {shownDone.map((a) => (
                <Row key={a.id} a={a} active={current?.id === a.id} onClick={() => setSel(a.id)} />
              ))}
              {done.length > shownDone.length && (
                <button onClick={() => setShowAll(true)} className="w-full px-5 py-2.5 text-left text-[12px] text-fg-3 hover:text-fg border-t border-line">
                  Show {done.length - shownDone.length} older
                </button>
              )}
            </Card>
          )}
          {mine && hidden > 0 && <p className="px-1 text-[12px] text-fg-3">{hidden} other approvals are assigned to other people and aren't visible to you.</p>}
          {!mine && health && (
            <Card className="p-4">
              <div className="text-[12.5px] font-semibold">Approval health · {health.days} {health.days === 1 ? "day" : "days"}</div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[
                  [fmtDuration(health.median), "median time"],
                  [health.perPersonDay.toFixed(1), "per person / day"],
                  [`${Math.round(health.rejected * 100)}%`, "rejected"],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-lg bg-surface-2 py-2">
                    <div className="text-[15px] font-semibold tnum">{v}</div>
                    <div className="text-[10.5px] text-fg-3">{l}</div>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11.5px] text-fg-3">Only {(health.share * 100).toFixed(1)}% of agent actions needed a human. Everything else was allowed, rewritten or blocked by policy alone.</p>
            </Card>
          )}
        </div>
        {current ? <Detail key={current.id} a={current} mine={mine} /> : <Card className="p-10 text-center text-fg-3">Nothing here yet.</Card>}
      </div>
    </div>
  );
}

function Row({ a, active, onClick }: { a: Approval; active: boolean; onClick: () => void }) {
  const ag = agentById(a.agentId);
  return (
    <button onClick={onClick} className={cn("flex w-full items-start gap-3 px-5 py-4 border-b border-line last:border-0 text-left transition-colors", active ? "bg-surface-2" : "hover:bg-surface-2")}>
      <Logo name={ag.logo} bleed={ag.bleed} size={28} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11.5px] truncate">{a.title}</div>
        <div className="mt-0.5 text-[11.5px] text-fg-3 truncate">
          {ag.name} · for {a.human.name.split(" ")[0]} · {ago(a.createdAt)}
        </div>
      </div>
      {a.status === "pending" ? (
        <span className="text-[11px] font-mono text-review tnum">
          {a.approvedBy.length}/{a.quorum}
        </span>
      ) : a.status === "approved" ? (
        <Check className="size-4 text-allow" />
      ) : (
        <CircleSlash className="size-4 text-block" />
      )}
    </button>
  );
}

function Sla({ createdAt }: { createdAt: number }) {
  const left = useCountdown(createdAt + 15 * 60_000);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 h-6 text-[11.5px] font-medium", left < 300 ? "bg-block-soft text-block" : "bg-surface-2 text-fg-2")}>
      <Clock className="size-3" /> {left ? `escalates to the admin in ${m}:${String(s).padStart(2, "0")}` : "escalated to the admin"}
    </span>
  );
}

const REASONS = ["Use `rollout restart` instead", "Wrong target", "Needs a change ticket", "Amount doesn't match the case"];

function Detail({ a, mine }: { a: Approval; mine: boolean }) {
  const ag = agentById(a.agentId);
  const s = a.scenarioId ? SCENARIOS[a.scenarioId] : undefined;
  const g = a.gate;
  const [hash, setHash] = useState("");
  const [checks, setChecks] = useState<VCheck[] | null>(null);
  const [probe, setProbe] = useState<{ label: string; checks: VCheck[] } | null>(null);
  const [why, setWhy] = useState("");
  const version = useStore((s) => s.version);
  const all = useStore((s) => s.approvals);
  // How requests under this rule went — from this workspace's own resolved requests; a scripted gate's authored
  // history only when there are none.
  const similar = useMemo(() => {
    const xs = all.filter((x) => x.id !== a.id && x.rule === a.rule && x.status !== "pending");
    if (!xs.length) return g.history ? { ...g.history, days: 90 } : null;
    const days = Math.max(1, Math.ceil((Date.now() - Math.min(...xs.map((x) => x.createdAt))) / 86_400_000));
    return { approved: xs.filter((x) => x.status === "approved").length, rejected: xs.filter((x) => x.status === "rejected").length, days, suggestion: g.history?.suggestion ?? SUGGEST[a.rule] };
  }, [all, a.id, a.rule, g.history]);

  useEffect(() => {
    sha256(canonical(approvalArgs(a))).then((h) => setHash("sha256:" + h));
  }, [a]);

  // Quorum reached here (not inside a running flow): mint the permit, then let the executor verify it.
  useEffect(() => {
    if (a.status !== "approved" || a.permit) return;
    let alive = true;
    (async () => {
      const p = await mintPermit({
        id: a.permitId,
        decision_id: a.gateId.startsWith("d-") ? a.gateId : "d-" + (parseInt(a.gateId.replace(/\D/g, "") || "7", 10) * 40503).toString(16).slice(-6).padStart(6, "7"),
        subject_agent: a.agentId,
        on_behalf_of: a.human.id,
        action: g.effect,
        resource: g.resource,
        environment: g.environment,
        approved_by: a.approvedBy,
        args: approvalPermitArgs(a),
      });
      if (!alive) return;
      attachPermit(a.id, p);
    })();
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.status, a.permit, a.id]);

  useEffect(() => {
    if (!a.permit || checks) return;
    const t = setTimeout(async () => setChecks(await verifyPermit(a.permit!, approvalPermitArgs(a))), 600);
    return () => clearTimeout(t);
  }, [a, checks]);

  const nextApprover = a.approvers.find((p) => !a.approvedBy.includes(p.id) && (!mine || p.id === EMPLOYEE.id));

  return (
    <div className="space-y-5 min-w-0">
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-3">
          <Logo name={ag.logo} bleed={ag.bleed} size={40} rounded="rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[14px] font-medium break-words">{a.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
              <DecisionPill d="REVIEW" size="sm" /> {ag.name} for {a.human.name} · {ago(a.createdAt)}
              {a.status === "pending" && <Sla createdAt={a.createdAt} />}
            </div>
          </div>
          {s && (
            <Button size="sm" variant="ghost" onClick={() => go(`/flows/${s.id}?agent=${a.agentId}`)}>
              Replay this flow <ArrowRight className="size-3" />
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] xl:grid-cols-2">
        <div className="space-y-5 min-w-0">
          <Card className="p-5 space-y-4">
            <div>
              <div className="eyebrow mb-1.5">What {a.human.name.split(" ")[0]} asked for</div>
              <blockquote className="border-l-2 border-line-strong pl-3 text-[13.5px] text-fg">“{a.intent}”</blockquote>
              {g.scope && (
                <div className={cn("mt-2 text-[12px]", g.scope.ok ? "text-allow" : "text-block")}>
                  {g.scope.ok ? "✓ The action is in scope of this request" : "✕ The action goes beyond this request"} <span className="text-fg-2">— {g.scope.note}</span>
                </div>
              )}
            </div>
            {g.dryRun && (
              <div>
                <div className="eyebrow mb-1.5">What will change · dry run</div>
                <div className="rounded-xl bg-code border border-code-line p-3.5 font-mono text-[12px] leading-[1.8]">
                  {g.dryRun.map((l, i) => (
                    <div key={i} className={l.startsWith("−") ? "text-[#ff8fa3]" : l.startsWith("+") ? "text-[#3fd49b]" : l.startsWith("~") ? "text-[#f4b453]" : "text-[#8a95b3]"}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="eyebrow mb-1.5">Why it's here</div>
              <div className="mb-2 text-[12.5px]">
                rule <span className="font-mono font-semibold">{a.rule}</span> — {a.reason}
              </div>
              <Signals signals={g.signals} dense />
            </div>
          </Card>
          <Card className="p-6">
            <div className="grid gap-5 sm:grid-cols-[1fr_200px] items-center">
              <div>
                <div className="eyebrow mb-1.5">Similar requests · {similar ? `${similar.days} days` : "none yet"}</div>
                <div className="flex gap-4 text-[13px]">
                  <span>
                    <b className="tnum">{similar?.approved ?? 0}</b> <span className="text-fg-3">approved</span>
                  </span>
                  <span>
                    <b className="tnum">{similar?.rejected ?? 0}</b> <span className="text-fg-3">rejected</span>
                  </span>
                </div>
                {similar?.suggestion && !mine && (
                  <div className="mt-3 rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-start gap-2 text-[12px] text-fg-2">
                      <Lightbulb className="size-3.5 mt-0.5 text-review shrink-0" /> {similar.suggestion}
                    </div>
                    <Button size="sm" className="mt-2" onClick={() => toast("Draft rule added", `Contract v${version + 1} draft · replay it before publishing`, "review")}>
                      Draft a rule
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <DecisionSpace mini height={140} points={[]} highlight={{ id: g.id, x: g.space[0], y: g.space[1], d: "REVIEW" }} />
                <div className="text-center text-[10.5px] text-fg-3 mt-1">impact × trust</div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-[13.5px] font-semibold">Approvers</div>
              <span className="text-[12px] text-fg-3">
                {a.quorum} of {a.approvers.length} required
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {a.approvers.map((p) => {
                const done = a.approvedBy.includes(p.id);
                const canAct = a.status === "pending" && !done && (!mine || p.id === EMPLOYEE.id);
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3">
                    <Avatar p={p} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {p.name}
                        {mine && p.id === EMPLOYEE.id && <span className="text-fg-3 font-normal"> (you)</span>}
                      </div>
                      <div className="text-[11.5px] text-fg-3 truncate">{done ? `signed · ${a.signatures[p.id]?.slice(0, 20)}…` : p.role}</div>
                    </div>
                    {done ? (
                      <Chip tone="allow">
                        <Check className="size-3" /> Signed
                      </Chip>
                    ) : canAct ? (
                      <Button size="sm" variant="allow" onClick={() => approveWithPasskey(a, p)}>
                        {mine ? "Approve" : `Approve as ${p.name.split(" ")[0]}`}
                      </Button>
                    ) : a.status === "pending" ? (
                      <span className="text-[12px] text-fg-3">waiting</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-2.5 text-[11.5px] text-fg-3">
              {a.human.name} requested this, so {a.human.name.split(" ")[0]} can't approve it. {mine ? "You can only sign as yourself." : "As the workspace admin you can act as each approver to walk this request through."}
            </p>
            {a.status === "pending" && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-[12px] font-medium mb-1.5">Reject with a reason the agent will see</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {REASONS.map((r) => (
                    <button key={r} onClick={() => setWhy(r)} className={cn("h-6 rounded-full border px-2 text-[11.5px]", why === r ? "border-fg text-fg" : "border-line text-fg-2 hover:border-line-strong")}>
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason…" className="flex-1 h-8 rounded-lg border border-line bg-surface-2 px-2.5 text-[12.5px] outline-none focus:border-fg-3" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-block"
                    onClick={() => {
                      reject(a.id, why || "rejected");
                      toast("Rejected", `The agent receives: “${why || "rejected"}”`, "block");
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
            {a.status === "rejected" && <div className="mt-3 rounded-lg bg-block-soft px-3 py-2 text-[12.5px] text-block">Rejected — “{a.rejectReason}”. The effect never executed.</div>}
          </Card>

          <SlackCard
            who={(nextApprover ?? a.approvers[0]).name}
            title={`${ag.name} needs approval for ${a.human.name}`}
            lines={[
              ["Action", a.title],
              ["Rule", a.rule],
              ["Args", hash ? short(hash) : "…"],
            ]}
            done={a.status === "approved" ? "approved" : a.status === "rejected" ? "rejected" : undefined}
            onApprove={() => nextApprover && approveWithPasskey(a, nextApprover)}
            onReject={() => {
              reject(a.id, "Rejected from Slack");
              toast("Rejected from Slack", undefined, "block");
            }}
          />

          {a.permit && (
            <>
              <PermitTicket permit={a.permit} status={checks?.every((c) => c.ok) ? "used" : "authorized"} />
              <Card className="p-6">
                <div className="text-[13.5px] font-semibold">Executor verification</div>
                <p className="text-[12px] text-fg-3 mt-0.5 mb-3">What the {g.effect.split(/[ .]/)[0]} service checks immediately before the effect.</p>
                {checks ? <Checks checks={checks} /> : <div className="text-[12.5px] text-fg-3">Verifying…</div>}
                {checks && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {g.tamper && (
                      <Button size="sm" onClick={async () => setProbe({ label: g.tamper!.label, checks: await verifyPermit(a.permit!, g.tamper!.args, { consume: false, probe: true }) })}>
                        <FlaskConical className="size-3.5" /> Tamper test
                      </Button>
                    )}
                    <Button size="sm" onClick={async () => setProbe({ label: "Same permit replayed", checks: await verifyPermit(a.permit!, approvalPermitArgs(a), { consume: false }) })}>
                      <Repeat2 className="size-3.5" /> Replay permit
                    </Button>
                  </div>
                )}
                {probe && (
                  <div className="mt-3 rounded-lg border border-block/30 bg-block-soft/50 p-3">
                    <div className="text-[12px] font-semibold text-block mb-1.5">{probe.label} → refused</div>
                    <Checks checks={probe.checks} />
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

