import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FlaskConical, Plug, Send, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AGENTS, CATEGORIES, agentById } from "../data/agents";
import { personById, type Person } from "../data/people";
import { nativeFor } from "../data/scenarios";
import { ActionComposer, TraceView, type Composed } from "../components/composer";
import { CodeBlock, json } from "../components/code";
import { Checks, PermitTicket } from "../components/permit";
import { Avatar, Button, Card, CardHead, Chip, DecisionPill, Logo, PageHeader, Segmented, cn } from "../components/ui";
import { rewrite } from "../lib/engine";
import { mintPermit, newDecisionId, verifyPermit, type Check, type Permit } from "../lib/permit";
import { go } from "../lib/router";
import { ADMIN, EMPLOYEE, approvalFrom, evaluateNow, gateFromAct, pushEvent, resolveApprovers, toast, upsertApproval, useStore } from "../lib/store";

interface Sent {
  id: string;
  agentId: string;
  display: string;
  decision: string;
  rule: string;
  permit?: Permit;
  checks?: Check[];
  approvalId?: string;
  rewritten?: string;
}

export function Playground() {
  const role = useStore((s) => s.role);
  const connected = useStore((s) => s.connected);
  const members = useStore((s) => s.members);
  const allowed = useStore((s) => s.allowed);
  const workspace = useStore((s) => s.workspace);
  const version = useStore((s) => s.version);
  useStore((s) => s.published);
  useStore((s) => s.rules);
  const mine = role === "employee";
  const pool = mine ? AGENTS.filter((a) => (allowed[EMPLOYEE.id] ?? []).includes(a.id)) : AGENTS;
  const [agentId, setAgentId] = useState(() => pool.find((a) => connected[a.id])?.id ?? "claude-code");
  const [who, setWho] = useState(mine ? EMPLOYEE.id : members.some((m) => m.id === "dev.k") ? "dev.k" : ADMIN.id);
  const [against, setAgainst] = useState<"published" | "draft">("published");
  const [c, setC] = useState<Composed | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const agent = agentById(agentId);
  const isConnected = !!connected[agentId];
  const people = useMemo(() => members.map((m) => personById(m.id)).filter(Boolean) as Person[], [members]);
  const human = personById(who) ?? ADMIN;

  const v = c ? evaluateNow(c.act, agentId, against === "draft") : null;
  const native = c
    ? nativeFor(agent, { ...gateFromAct("pg", c.display, c.act, v!), op: c.op })
    : null;

  async function send() {
    if (!c) return;
    const verdict = evaluateNow(c.act, agentId);
    const id = newDecisionId();
    const gate = { ...gateFromAct(id, c.display, c.act, verdict), op: c.op };
    const rewritten = verdict.decision === "CONSTRAIN" ? rewrite(c.act, verdict.constrain) : undefined;
    const base = { agentId, human: human.id, action: c.display, effect: c.act.effect, rule: verdict.rule, reason: verdict.reason, latency: 2, env: c.act.env ?? "production", source: "playground" as const, observed: verdict.observed };
    if (verdict.decision === "REVIEW") {
      const ap = approvalFrom({ gate, agentId, human, intent: `Playground: ${human.name} asked ${agent.name} to “${c.display}”`, approvers: resolveApprovers(verdict.approvers, human.id), quorum: verdict.quorum, args: { ...c.act } });
      upsertApproval(ap);
      pushEvent({ ...base, decision: "REVIEW", id });
      setSent((s) => [{ id, agentId, display: c.display, decision: "REVIEW", rule: verdict.rule, approvalId: ap.id }, ...s]);
      toast("Held for approval", `${ap.approvers.map((p) => p.name).join(" + ")} · open Approvals to sign`, "review");
      return;
    }
    if (verdict.decision === "BLOCK") {
      pushEvent({ ...base, decision: "BLOCK", id });
      setSent((s) => [{ id, agentId, display: c.display, decision: "BLOCK", rule: verdict.rule }, ...s]);
      toast("Blocked before execution", verdict.reason, "block");
      return;
    }
    const args = rewritten ? (c.act.sql ? { sql: rewritten } : { command: rewritten }) : { ...c.act };
    const permit = await mintPermit({ decision_id: id, subject_agent: agentId, on_behalf_of: human.id, action: c.act.effect, resource: gate.resource, environment: gate.environment, approved_by: [], args });
    const checks = await verifyPermit(permit, args);
    pushEvent({ ...base, decision: verdict.decision, permit: permit.id, rewritten, id });
    setSent((s) => [{ id, agentId, display: c.display, decision: verdict.decision, rule: verdict.rule, permit, checks, rewritten }, ...s]);
    toast(verdict.decision === "CONSTRAIN" ? "Rewritten and executed" : "Allowed with permit", rewritten ?? `${permit.id} · verified by the executor`, "allow");
  }

  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="Try anything"
        title="Action playground"
        sub="Pick an agent, type what it would do — a command, a file read, a refund, a SQL query — and watch Wrapbox evaluate it against your contract, rule by rule. Send it, and it lands in the stream, approvals and evidence like real traffic."
        right={<Chip>contract v{version}</Chip>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-5 min-w-0">
          <Card className="p-6">
            <div className="text-[13px] font-semibold mb-2.5">1 · Which agent</div>
            <div className="space-y-2.5 max-h-[300px] overflow-y-auto scroll-thin pr-1">
              {CATEGORIES.map((cat) => {
                const list = pool.filter((a) => a.category === cat.id);
                if (!list.length) return null;
                return (
                  <div key={cat.id}>
                    <div className="eyebrow !text-[10px] mb-1">{cat.name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setAgentId(a.id)}
                          className={cn("flex items-center gap-1.5 rounded-full border h-7 pl-1 pr-2.5 text-[12px] transition-colors", agentId === a.id ? "border-fg text-fg bg-surface shadow-card" : "border-line text-fg-2 hover:border-line-strong", !connected[a.id] && "opacity-60")}
                        >
                          <Logo name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" /> {a.name}
                          {!connected[a.id] && <span className="text-[10.5px] text-fg-3">· off</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!pool.length && <div className="text-[12.5px] text-fg-3">No agents enabled for you yet.</div>}
            </div>
            {!mine && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-fg-3">Acting for</span>
                <select value={who} onChange={(e) => setWho(e.target.value)} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]">
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.role}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[13px] font-semibold">2 · What it tries to do</div>
              <span className="font-mono text-[11px] text-fg-3">{agent.adapter} adapter</span>
            </div>
            <ActionComposer key={agentId} agentId={agentId} onChange={setC} />
          </Card>

          {!isConnected && (
            <Card className="p-4 flex flex-wrap items-center gap-3 border-review/40">
              <Plug className="size-4 text-review" />
              <div className="flex-1 min-w-[220px] text-[12.5px] text-fg-2">
                <b className="text-fg">{agent.name} isn't connected{workspace === "fresh" ? " to this workspace" : ""}.</b> You can still see what your contract would decide; connect it to send real traffic.
              </div>
              {!mine && (
                <Button size="sm" variant="primary" onClick={() => go(`/agents/${agentId}`)}>
                  Connect
                </Button>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5 min-w-0">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-[13px] font-semibold flex items-center gap-2">
                <FlaskConical className="size-4 text-fg-2" /> 3 · What Wrapbox decides
              </div>
              {!mine && (
                <Segmented
                  size="sm"
                  value={against}
                  onChange={setAgainst}
                  options={[
                    { value: "published", label: `Published v${version}` },
                    { value: "draft", label: "Draft" },
                  ]}
                />
              )}
            </div>
            {v && c ? (
              <div className="space-y-3">
                <TraceView v={v} />
                {v.decision === "CONSTRAIN" && (
                  <div className="rounded-lg bg-code border border-code-line p-2.5 font-mono text-[11.5px]">
                    <div className="text-[#ff8fa3] break-words">− {c.act.sql ?? c.act.command}</div>
                    <div className="text-[#3fd49b] break-words">+ {rewrite(c.act, v.constrain)}</div>
                  </div>
                )}
                {v.decision === "REVIEW" && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-2">
                    Would be held for
                    {resolveApprovers(v.approvers, human.id).map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-1">
                        <Avatar p={p} size={18} /> {p.name}
                      </span>
                    ))}
                    <span className="text-fg-3">· group {v.approvers ?? "admin"}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button variant="primary" onClick={send} disabled={!isConnected || against === "draft"}>
                    <Send className="size-3.5" /> Send through Wrapbox
                  </Button>
                  {!mine && v.rule === "default" && (
                    <Button onClick={() => go(`/contract?from=${encodeURIComponent(JSON.stringify(c.act))}`)}>
                      <Wand2 className="size-3.5" /> Write a rule for this
                    </Button>
                  )}
                  {against === "draft" && <span className="text-[11.5px] text-fg-3">Publish your draft to send against it.</span>}
                </div>
              </div>
            ) : (
              <div className="text-[12.5px] text-fg-3">Compose an action on the left.</div>
            )}
          </Card>

          {native && c && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1.5 text-[12.5px] font-semibold">
                  {agent.name} sends <span className="font-normal text-fg-3">· {native.hook}</span>
                </div>
                <CodeBlock lang="json" code={json(native.request)} maxH={220} />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 text-[12.5px] font-semibold">
                  {agent.name} receives <span className="font-normal text-fg-3">· its own format</span>
                </div>
                <CodeBlock lang="json" code={json(native.respond(v!.decision, { reason: v!.reason, rule: v!.rule, decisionId: "d-preview", permitId: "wbp_preview", pending: v!.decision === "REVIEW", rewritten: v!.decision === "CONSTRAIN" ? { sql: rewrite(c.act, v!.constrain), command: rewrite(c.act, v!.constrain) } : undefined }))} maxH={220} />
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            <CardHead title="Sent from the playground" sub="Each one is real traffic in this workspace — see it in the stream, approvals and evidence." right={sent.length ? <Button size="sm" variant="ghost" onClick={() => go("/evidence")}>Evidence <ArrowRight className="size-3" /></Button> : undefined} />
            <div className="border-t border-line">
              <AnimatePresence initial={false}>
                {sent.map((x) => {
                  const a = agentById(x.agentId);
                  return (
                    <motion.div key={x.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="px-5 py-3 border-b border-line last:border-0">
                      <div className="flex items-center gap-3">
                        <Logo name={a.logo} bleed={a.bleed} size={24} rounded="rounded-md" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[12px] truncate">{x.display}</div>
                          <div className="text-[11.5px] text-fg-3">
                            {x.id} · rule {x.rule}
                            {x.rewritten ? ` · ran as: ${x.rewritten}` : ""}
                          </div>
                        </div>
                        <DecisionPill d={x.decision as never} size="sm" />
                        {x.approvalId && (
                          <Button size="sm" onClick={() => go("/approvals")}>
                            Sign it
                          </Button>
                        )}
                      </div>
                      {x.permit && x.checks && (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <PermitTicket permit={x.permit} status="used" />
                          <div className="rounded-xl border border-line p-3">
                            <div className="text-[12px] font-semibold mb-2">Executor verification</div>
                            <Checks checks={x.checks} />
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {!sent.length && <div className="px-5 py-6 text-[12.5px] text-fg-3">Nothing sent yet.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

