import { ArrowRight, CheckCircle2, Eye, EyeOff, Hand, Laptop, Loader2, Send, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";
import { agentById } from "../data/agents";
import { DecisionStream } from "../components/stream";
import { Button, Card, CardHead, Chip, DecisionPill, Logo, Modal, PageHeader, cn } from "../components/ui";
import { approveWithPasskey } from "../lib/actions";
import { ago, go } from "../lib/router";
import { EMPLOYEE, adminPerson, setState, toast, useStore, type Evt } from "../lib/store";
import { EvidenceDrawer } from "./evidence";

export const HOW_TO: Record<string, string> = {
  "secrets.read": "Reference the secret instead: `wrapbox secrets ref SESSION_SECRET` gives the agent a handle, never the value.",
  "git.main": "Push to a branch and open a PR — merges to main stay with humans.",
  "network.egress": "If the domain is legitimate, request it on the egress allowlist.",
  "prod.k8s.delete": "It's routed to on-call automatically. `kubectl rollout restart` avoids the delete entirely.",
  "db.prod.write": "Ship it as a migration PR, or ask a DBA to run it in the change window.",
  "git.force": "Wrapbox already rewrote it to --force-with-lease, which can't clobber a teammate's work.",
};

export function EmployeeHome() {
  const events = useStore((s) => s.events);
  const approvals = useStore((s) => s.approvals);
  const allRequests = useStore((s) => s.requests);
  const requests = useMemo(() => allRequests.filter((r) => r.person.id === EMPLOYEE.id), [allRequests]);
  const version = useStore((s) => s.version);
  const published = useStore((s) => s.published);
  const onCall = useStore((s) => (s.groups["oncall-sre"] ?? []).includes(EMPLOYEE.id));
  // The rules that reach this person's agents, in the order they'd be noticed. Derived from the published contract.
  const notice = useMemo(() => {
    type D = "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK";
    const rows = published
      .filter((r) => r.scope !== "business")
      .map((r) => ({ d: (r.mode === "observe" ? "ALLOW" : r.attenuate ? "BLOCK" : (r.decision ?? r.tiers?.[r.tiers.length - 1]?.decision ?? "ALLOW")) as D, t: r.title + (r.mode === "observe" ? " — watching, not enforced yet" : "") }));
    // A few of each kind, hardest first, so the list reads like the day will: what stops, what gets rewritten, what waits.
    const take = (d: D, n: number) => rows.filter((r) => r.d === d).slice(0, n);
    return [...take("BLOCK", 3), ...take("CONSTRAIN", 2), ...take("REVIEW", 3), { d: "ALLOW" as const, t: "Everything else: edits, tests, builds, feature branches" }];
  }, [published]);
  const [open, setOpen] = useState<Evt | null>(null);
  const [ask, setAsk] = useState<Evt | null>(null);
  const [doctor, setDoctor] = useState<"idle" | "run" | "ok">("idle");
  const device = useStore((s) => s.devices.find((d) => d.ownerId === EMPLOYEE.id));
  const onboarded = useStore((s) => s.onboarded.employee);
  const domain = useStore((s) => s.domain);
  const first = EMPLOYEE.name.split(" ")[0];
  const mine = useMemo(() => events.filter((e) => e.human === EMPLOYEE.id), [events]);
  const waiting = approvals.filter((a) => a.status === "pending" && a.approvers.some((p) => p.id === EMPLOYEE.id));
  const blocked = useMemo(() => Array.from(new Map(mine.filter((e) => e.decision === "BLOCK" || e.decision === "CONSTRAIN").map((e) => [e.rule, e])).values()).slice(0, 4), [mine]);
  const counts = { ALLOW: 0, CONSTRAIN: 0, REVIEW: 0, BLOCK: 0 };
  mine.forEach((e) => counts[e.decision]++);

  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={`Employee view · ${EMPLOYEE.name} · ${EMPLOYEE.role}`}
        title={device ? `Hi ${first} — your agents are covered.` : `Hi ${first} — let's get your agents covered.`}
        sub={`Your coding agents follow the Wrapbox contract v${version}. Almost everything is allowed instantly; you'll only notice Wrapbox when an action touches secrets, main, customer data or production.`}
      />

      <Card className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-4">
        {[
          ["Your agents' actions", mine.length, ""],
          ["Allowed instantly", counts.ALLOW, "text-allow"],
          ["Rewritten safely", counts.CONSTRAIN, "text-constrain"],
          ["Blocked", counts.BLOCK, "text-block"],
        ].map(([l, v, c]) => (
          <div key={l as string} className="px-6 py-5">
            <div className="text-[12px] text-fg-3">{l}</div>
            <div className={cn("mt-1 text-[22px] font-semibold tnum", c as string)}>{v as number}</div>
          </div>
        ))}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          {!device ? (
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-4">
                <span className="grid size-10 place-items-center rounded-xl bg-surface-2">
                  <Laptop className="size-5 text-fg-2" />
                </span>
                <div className="flex-1 min-w-[240px]">
                  <div className="text-[14px] font-semibold">{onboarded ? "Your laptop isn't reporting" : "You haven't set up Wrapbox yet"}</div>
                  <div className="text-[12.5px] text-fg-2">Accept the invite, run one command, and your agents are protected. About 3 minutes.</div>
                </div>
                <Button variant="primary" onClick={() => go("/onboarding/employee")}>
                  Start setup
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Laptop className="size-4 text-fg-2" />
                <span className="font-mono text-[13px] font-medium">{device.id}</span>
                <Chip tone="allow">protected</Chip>
                <span className="text-[11.5px] text-fg-3">
                  wrapbox CLI {device.cli} · checked in {ago(device.seen)} · managed by {device.mdm}
                </span>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    setDoctor("run");
                    setTimeout(() => setDoctor("ok"), 1400);
                  }}
                >
                  {doctor === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />} wrapbox doctor
                </Button>
              </div>
              <div className="mt-3 grid sm:grid-cols-3 gap-2">
                {device.agents.map((a) => (
                  <div key={a.name} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
                    <Logo name={a.logo} size={28} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold truncate">{a.name}</div>
                      <div className="flex items-center gap-1 text-[11px] text-allow">
                        <CheckCircle2 className="size-3" /> hook active
                      </div>
                    </div>
                  </div>
                ))}
                {!device.agents.length && <div className="text-[12px] text-fg-3">No agents enabled for you yet — request one below.</div>}
              </div>
              {doctor === "ok" && (
                <div className="mt-3 rounded-xl bg-code border border-code-line p-3 font-mono text-[11.5px] leading-[1.75] text-[#a2acc5]">
                  <div className="text-[#3fd49b]">✓ identity {EMPLOYEE.id}@{domain} · device key in Secure Enclave</div>
                  {device.agents.map((a) => (
                    <div key={a.name} className="text-[#3fd49b]">
                      ✓ {a.name.toLowerCase()} · {a.note}
                    </div>
                  ))}
                  <div className="text-[#3fd49b]">✓ endpoint runtime · file/process/network mediation on</div>
                  <div>policy cache v{version} · api.wrapbox.ai reachable</div>
                </div>
              )}
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHead title="What your agents did" sub="Click any row to see exactly why." right={<Button size="sm" variant="ghost" onClick={() => go("/evidence")}>All activity <ArrowRight className="size-3" /></Button>} />
            <div className="border-t border-line">
              {mine.length ? <DecisionStream events={mine} limit={8} onPick={setOpen} /> : <div className="px-6 py-10 text-[12.5px] text-fg-3">No actions yet today.</div>}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHead title="Stopped or changed today — and how to get it done" sub="Wrapbox explains every decision in plain language." />
            <div className="border-t border-line">
              {blocked.map((e) => (
                <div key={e.rule} className="flex flex-wrap items-start gap-3 px-6 py-4 border-b border-line last:border-0">
                  <DecisionPill d={e.decision} size="sm" />
                  <div className="min-w-[240px] flex-1">
                    <div className="font-mono text-[11.5px] text-fg-2 truncate">{e.action}</div>
                    <div className="text-[12.5px] mt-0.5">{e.reason}</div>
                    <div className="text-[12px] text-fg-3 mt-1">{HOW_TO[e.rule] ?? "Request a time-boxed exception and your admin will see it."}</div>
                  </div>
                  {e.decision === "BLOCK" && (
                    <Button size="sm" onClick={() => setAsk(e)}>
                      <Send className="size-3" /> Request exception
                    </Button>
                  )}
                </div>
              ))}
              {!blocked.length && <div className="px-5 py-6 text-[12.5px] text-fg-3">Nothing blocked today.</div>}
            </div>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card className={cn("overflow-hidden", waiting.length && "border-review/40")}>
            <CardHead title={<span className="flex items-center gap-2"><Hand className="size-4 text-review" /> Waiting on you</span>} sub={onCall ? "You're on call — production changes need your signature." : "Requests assigned to you as an approver."} />
            <div className="border-t border-line">
              {waiting.map((a) => {
                const ag = agentById(a.agentId);
                return (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <Logo name={ag.logo} size={26} />
                    <a href="#/approvals" className="min-w-0 flex-1">
                      <div className="font-mono text-[11.5px] truncate">{a.title}</div>
                      <div className="text-[11.5px] text-fg-3">
                        for {a.human.name} · {ago(a.createdAt)}
                      </div>
                    </a>
                    <Button size="sm" variant="allow" onClick={() => approveWithPasskey(a, EMPLOYEE)}>
                      Approve
                    </Button>
                  </div>
                );
              })}
              {!waiting.length && <div className="px-6 py-6 text-[12.5px] text-fg-3">Nothing needs you right now.</div>}
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-[13.5px] font-semibold">When you'll notice Wrapbox</div>
            <ul className="mt-3 space-y-2">
              {notice.map(({ d, t }) => (
                <li key={t} className="flex items-center gap-2.5 text-[12.5px]">
                  <DecisionPill d={d} size="sm" className="w-[84px] shrink-0 justify-center" />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-4" onClick={() => go("/contract")}>
              Read the rules <ArrowRight className="size-3" />
            </Button>
          </Card>

          <Card className="p-6">
            <div className="text-[13.5px] font-semibold">Your requests</div>
            <div className="mt-3 space-y-2">
              {requests.map((r) => {
                const a = agentById(r.agentId);
                return (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <Logo name={a.logo} bleed={a.bleed} size={24} rounded="rounded-md" />
                    <span className="text-[12.5px] flex-1 truncate">{r.kind === "exception" ? `Exception · ${r.action}` : a.name}</span>
                    <Chip tone={r.status === "approved" ? "allow" : r.status === "denied" ? "block" : "review"}>{r.status}</Chip>
                  </div>
                );
              })}
              {!requests.length && <div className="text-[12.5px] text-fg-3">No requests.</div>}
            </div>
            <Button size="sm" className="mt-3" onClick={() => go("/agents")}>
              Request another agent
            </Button>
          </Card>

          <Card className="p-5 bg-surface-2">
            <div className="grid grid-cols-2 gap-4 text-[12px]">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-[12.5px] mb-1.5">
                  <Eye className="size-3.5" /> Your admin sees
                </div>
                <ul className="space-y-1 text-fg-2">
                  <li>Your agents' actions and decisions</li>
                  <li>Laptop and hook health</li>
                  <li>Your requests and approvals</li>
                </ul>
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-[12.5px] mb-1.5">
                  <EyeOff className="size-3.5" /> Never collected
                </div>
                <ul className="space-y-1 text-fg-2">
                  <li>Your source code or file contents</li>
                  <li>Chat history with the agent</li>
                  <li>Prompts — except the one attached to an approval request</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
      <ExceptionModal e={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

function ExceptionModal({ e, onClose }: { e: Evt | null; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [mins, setMins] = useState(30);
  return (
    <Modal open={!!e} onClose={onClose}>
      {e && (
        <div className="p-6">
          <div className="text-[15px] font-semibold">Request a time-boxed exception</div>
          <p className="mt-1 text-[12.5px] text-fg-3">Your admin sees it in Team & devices. If granted, Wrapbox mints a permit for this one command only — the rule stays in force for everything else.</p>
          <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12px]">{e.action}</div>
          <div className="mt-1 font-mono text-[11px] text-fg-3">rule {e.rule}</div>
          <label className="block mt-4">
            <span className="text-[12px] font-medium">Why do you need it?</span>
            <textarea value={why} onChange={(x) => setWhy(x.target.value)} rows={3} placeholder="e.g. Hotfix for the checkout outage — CI is green" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-fg-3" />
          </label>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="text-fg-3">For</span>
            {[15, 30, 60].map((m) => (
              <button key={m} onClick={() => setMins(m)} className={cn("h-7 rounded-full border px-2.5", mins === m ? "border-fg text-fg" : "border-line text-fg-2")}>
                {m} min
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setState((s) => ({
                  requests: [
                    { id: "rq-" + Date.now(), kind: "exception", person: EMPLOYEE, agentId: e.agentId, action: e.action, rule: e.rule, reason: (why || "Needed for the current task") + ` (${mins} min)`, status: "pending", at: Date.now() },
                    ...s.requests,
                  ],
                }));
                toast("Exception requested", `${mins} minutes · waiting for ${adminPerson().name}`, "review");
                setWhy("");
                onClose();
              }}
            >
              <Send className="size-3.5" /> Send request
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
