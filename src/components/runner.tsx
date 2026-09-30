import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, CircleSlash, FlaskConical, Loader2, Play, Plug, RefreshCcw, Repeat2, RotateCcw, ShieldCheck, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Agent, Decision } from "../data/agents";
import { personById } from "../data/people";
import { ALT_ALLOW, REQUIRES_BLOCK, actOf, gateArgs, nativeFor, normalizedFor, type Gate, type SLine, type Scenario } from "../data/scenarios";
import { approveWithPasskey } from "../lib/actions";
import { rewrite, type Verdict } from "../lib/engine";
import { mintPermit, newDecisionId, verifyPermit, type Check as VCheck, type Permit } from "../lib/permit";
import { go } from "../lib/router";
import { attachPermit, ensurePending, evaluateNow, getState, pushEvent, subscribeStore, useStore } from "../lib/store";
import { CodeBlock, json } from "./code";
import { DecisionSpace, Signals } from "./insight";
import { Checks, PermitTicket, useCountdown } from "./permit";
import { AgentSurface, type RLine } from "./surfaces";
import { Avatar, Button, Card, Chip, DecisionPill, Logo, cn } from "./ui";

interface GateRun {
  decisionId: string;
  stage: number;
  v: Verdict;
  args: Record<string, unknown>;
  permit?: Permit;
  checks?: VCheck[];
  probe?: { label: string; checks: VCheck[] };
  approvalId?: string;
  heldAt?: number;
  rejected?: string;
  skipped?: boolean;
}

type StageKey = "intercept" | "normalize" | "identity" | "policy" | "decision" | "human" | "constrain" | "permit" | "enforce" | "evidence";
const stagesFor = (d: Decision): { key: StageKey; title: string }[] => [
  { key: "intercept", title: "Intercepted" },
  { key: "normalize", title: "Normalized" },
  { key: "identity", title: "Identity & delegation" },
  { key: "policy", title: "Your contract + risk signals" },
  { key: "decision", title: "Decision" },
  ...(d === "REVIEW" ? [{ key: "human" as StageKey, title: "Human step-up" }] : []),
  ...(d === "CONSTRAIN" ? [{ key: "constrain" as StageKey, title: "Rewritten to a safe variant" }] : []),
  { key: "permit", title: d === "BLOCK" ? "No permit minted" : "Permit minted" },
  { key: "enforce", title: d === "BLOCK" ? "Effect prevented" : "Executor verified" },
  { key: "evidence", title: "Evidence recorded" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitApproval(id: string, alive: () => boolean): Promise<{ ok: boolean; by: string[]; reason?: string }> {
  return new Promise((resolve) => {
    const check = () => {
      if (!alive()) {
        un();
        return;
      }
      const a = getState().approvals.find((x) => x.id === id);
      if (a && a.status !== "pending") {
        un();
        resolve({ ok: a.status === "approved", by: a.approvedBy, reason: a.rejectReason });
      }
    };
    const un = subscribeStore(check);
    check();
  });
}

/** The args the permit binds to: the authored rewrite, an engine rewrite, or the original call. */
function argsFor(g: Gate, v: Verdict): Record<string, unknown> {
  if (v.decision !== "CONSTRAIN") return gateArgs(g);
  if (g.constrain && g.decision === "CONSTRAIN") return g.constrain.args;
  const a = actOf(g);
  const r = rewrite(a, v.constrain);
  if (!r) return gateArgs(g);
  return a.sql ? { sql: r } : { command: r };
}

function thenFor(g: Gate, d: Decision): SLine[] {
  if (d === g.decision) return g.then;
  if (d === "ALLOW" && g.decision === "REVIEW") return [{ k: "info", t: "Your contract didn't require an approval — it ran immediately." }, ...g.then];
  if (d === "ALLOW" || d === "CONSTRAIN") return ALT_ALLOW[g.id] ?? (g.decision === "ALLOW" ? g.then : [{ k: "out", t: "Executed — nothing in your contract stopped it." }]);
  if (d === "REVIEW") return g.then;
  return [{ k: "think", t: "Blocked by the contract. Moving on without it." }];
}

export function FlowRunner({ scenario, agent, picker }: { scenario: Scenario; agent: Agent; picker?: ReactNode }) {
  const [lines, setLines] = useState<RLine[]>([]);
  const [runs, setRuns] = useState<GateRun[]>([]);
  const [gi, setGi] = useState(0);
  const [phase, setPhase] = useState<"idle" | "running" | "waiting" | "done">("idle");
  const runId = useRef(0);
  const workspace = useStore((s) => s.workspace);
  const connected = useStore((s) => !!s.connected[agent.id]);
  const version = useStore((s) => s.version);
  const ruleCount = useStore((s) => s.published.length);
  const needsConnect = workspace === "fresh" && !connected;

  useEffect(() => () => void runId.current++, []);

  const add = (l: RLine) => setLines((ls) => [...ls, l]);
  const replaceGate = (l: RLine) =>
    setLines((ls) => {
      const i = ls.map((x) => x.k).lastIndexOf("gate");
      if (i < 0) return [...ls, l];
      const c = ls.slice();
      c[i] = l;
      return c;
    });
  const patchRun = (i: number, p: Partial<GateRun>) => setRuns((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function run() {
    const my = ++runId.current;
    const alive = () => runId.current === my;
    setLines([]);
    setRuns([]);
    setGi(0);
    setPhase("running");
    add({ k: "user", t: scenario.prompt });
    for (const l of scenario.pre) {
      await sleep(320);
      if (!alive()) return;
      add(l);
    }
    let prev: Decision | undefined;
    for (let i = 0; i < scenario.gates.length; i++) {
      const g = scenario.gates[i];
      const v = evaluateNow(actOf(g), agent.id);
      const d = v.decision;
      const args = argsFor(g, v);
      const reason = v.rule === g.rule && d === g.decision ? g.reason : v.reason;
      if (REQUIRES_BLOCK.has(g.id) && prev !== "BLOCK") {
        setRuns((rs) => [...rs, { decisionId: "—", stage: -1, v, args, skipped: true }]);
        continue;
      }
      const stages = stagesFor(d);
      const at = (k: StageKey) => stages.findIndex((s) => s.key === k);
      const native = nativeFor(agent, g);
      const decisionId = newDecisionId();
      await sleep(380);
      if (!alive()) return;
      setGi(i);
      setRuns((rs) => [...rs, { decisionId, stage: -1, v: { ...v, reason }, args }]);
      add({ k: "tool", t: g.display });
      add({ k: "gate", t: `Wrapbox checking · ${native.hook}` });
      for (const k of ["intercept", "normalize", "identity", "policy", "decision"] as StageKey[]) {
        await sleep(440);
        if (!alive()) return;
        patchRun(i, { stage: at(k) });
      }
      const base = { agentId: agent.id, human: scenario.human.id, action: g.display, effect: actOf(g).effect, rule: v.rule, latency: g.latency, env: actOf(g).env ?? "production", source: "flow" as const, observed: v.observed };
      if (d === "BLOCK") {
        replaceGate({ k: "deny", t: native.denyLine(reason) });
        await sleep(400);
        patchRun(i, { stage: at("permit") });
        await sleep(400);
        patchRun(i, { stage: at("enforce") });
        pushEvent({ ...base, decision: "BLOCK", reason, id: decisionId });
        await sleep(360);
        patchRun(i, { stage: at("evidence") });
      } else {
        let by: string[] = [];
        if (d === "REVIEW") {
          const apId = ensurePending(scenario, g, agent.id, v);
          const approvers = getState().approvals.find((a) => a.id === apId)?.approvers ?? [];
          replaceGate({ k: "hold", t: `Held by Wrapbox for ${approvers.map((p) => p.name).join(" + ")} · ${decisionId}` });
          patchRun(i, { stage: at("human"), approvalId: apId, heldAt: Date.now() });
          pushEvent({ ...base, decision: "REVIEW", reason });
          setPhase("waiting");
          const res = await waitApproval(apId, alive);
          if (!alive()) return;
          setPhase("running");
          if (!res.ok) {
            setLines((ls) => [...ls.map((l) => (l.k === "hold" ? ({ k: "info", t: "Approver responded" } as RLine) : l)), { k: "deny", t: native.denyLine(`rejected by approver — ${res.reason ?? "no reason"}`) }]);
            pushEvent({ ...base, decision: "BLOCK", reason: `rejected by approver — ${res.reason ?? ""}`, id: decisionId });
            patchRun(i, { rejected: res.reason ?? "rejected", stage: stages.length - 1 });
            prev = "BLOCK";
            continue;
          }
          by = res.by;
          add({ k: "info", t: `Approved with passkey by ${by.map((id) => personById(id)?.name ?? id).join(" and ")}` });
        }
        if (d === "CONSTRAIN") {
          await sleep(400);
          patchRun(i, { stage: at("constrain") });
        }
        const permit = await mintPermit({ decision_id: decisionId, subject_agent: agent.id, on_behalf_of: scenario.human.id, action: actOf(g).effect, resource: g.resource, environment: g.environment, approved_by: by, args, ttl: 60 });
        if (!alive()) return;
        if (d === "REVIEW") attachPermit("ap-" + g.id, permit);
        patchRun(i, { stage: at("permit"), permit });
        await sleep(600);
        const checks = await verifyPermit(permit, args);
        if (!alive()) return;
        patchRun(i, { stage: at("enforce"), checks });
        const rewritten = d === "CONSTRAIN" ? String((args as { sql?: string; command?: string }).sql ?? (args as { command?: string }).command ?? "") : undefined;
        replaceGate(d === "CONSTRAIN" ? { k: "allowed", t: `Rewritten by Wrapbox → ${g.constrain && g.decision === "CONSTRAIN" ? g.constrain.display : rewritten}` } : { k: "allowed", t: `Allowed by Wrapbox · permit ${permit.id}` });
        setLines((ls) => ls.map((l) => (l.k === "hold" ? { k: "info", t: "Approval received — hook released" } : l)));
        pushEvent({ ...base, decision: d === "CONSTRAIN" ? "CONSTRAIN" : "ALLOW", reason: d === "REVIEW" ? "approved · " + reason : reason, permit: permit.id, approvers: by, rewritten, id: decisionId });
        await sleep(360);
        patchRun(i, { stage: at("evidence") });
      }
      prev = d;
      for (const l of thenFor(g, d)) {
        await sleep(300);
        if (!alive()) return;
        add(l);
      }
    }
    await sleep(300);
    if (!alive()) return;
    setPhase("done");
  }

  const reset = () => {
    runId.current++;
    setLines([]);
    setRuns([]);
    setGi(0);
    setPhase("idle");
  };

  // Post-run summary lines come from what actually happened under the current contract.
  const matchedScript = runs.length > 0 && runs.every((r, i) => r.skipped || (r.v.decision === scenario.gates[i].decision && !r.rejected));
  useEffect(() => {
    if (phase !== "done") return;
    setLines((ls) => [...ls, ...(matchedScript ? scenario.post : [{ k: "info" as const, t: `Finished under contract v${version} — some actions were decided differently than the reference policy.` }])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const gate = scenario.gates[gi];
  const r = runs[gi];
  const d: Decision = r ? (r.rejected ? "BLOCK" : r.v.decision) : gate.decision;
  const native = nativeFor(agent, gate);
  const stages = stagesFor(r?.v.decision ?? gate.decision);
  const done = runs.filter((x) => !x.skipped && x.stage >= stagesFor(x.v.decision).length - 1);
  const counts = done.reduce((acc, x) => (acc[x.rejected ? "BLOCK" : x.v.decision]++, acc), { ALLOW: 0, CONSTRAIN: 0, REVIEW: 0, BLOCK: 0 } as Record<Decision, number>);
  const gaps = runs.map((x, i) => ({ x, g: scenario.gates[i] })).filter(({ x, g }) => !x.skipped && x.v.rule === "default" && g.decision !== "ALLOW");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Logo name={agent.logo} bleed={agent.bleed} size={36} rounded="rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold tracking-tight">{scenario.title}</div>
          <div className="text-[12.5px] text-fg-3 truncate">
            {agent.name} · on behalf of {scenario.human.name} ({scenario.human.role}) · evaluated against contract v{version} ({ruleCount} rules)
          </div>
        </div>
        <div className="flex items-center gap-2">
          {phase !== "idle" && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          )}
          <Button variant={phase === "idle" ? "primary" : "secondary"} onClick={run} disabled={phase === "running" || needsConnect}>
            {phase === "running" ? <Loader2 className="size-3.5 animate-spin" /> : phase === "done" ? <RefreshCcw className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
            {phase === "idle" ? "Run happy flow" : phase === "running" ? "Running…" : phase === "waiting" ? "Restart" : "Run again"}
          </Button>
        </div>
      </div>
      {picker}

      {needsConnect && (
        <Card className="p-4 flex flex-wrap items-center gap-3 border-review/40">
          <Plug className="size-4 text-review" />
          <div className="flex-1 min-w-[240px] text-[13px]">
            <b>{agent.name} isn't connected to this workspace yet.</b> <span className="text-fg-2">Connect it first — then every action it takes goes through your contract.</span>
          </div>
          <Button variant="primary" size="sm" onClick={() => go(`/agents/${agent.id}`)}>
            Connect {agent.name}
          </Button>
        </Card>
      )}
      {!needsConnect && ruleCount === 0 && phase === "idle" && (
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <AlertTriangle className="size-4 text-review" />
          <div className="flex-1 min-w-[240px] text-[13px] text-fg-2">
            <b className="text-fg">Your contract has no rules yet</b>, so every action will be allowed. Run it once to see what happens — then write a rule and run it again.
          </div>
          <Button size="sm" onClick={() => go("/contract")}>
            Open the contract
          </Button>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="h-[500px] min-w-0">
          <AgentSurface agent={agent} scenario={scenario} lines={lines} running={phase === "running"} />
        </div>

        <Card className="h-[500px] flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-2 px-4 h-11 border-b border-line shrink-0">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <ShieldCheck className="size-4 text-accent" /> Wrapbox pipeline
            </div>
            {scenario.gates.length > 1 && (
              <div className="flex gap-1">
                {scenario.gates.map((g, i) => (
                  <button
                    key={g.id}
                    disabled={!runs[i] || runs[i].skipped}
                    onClick={() => setGi(i)}
                    className={cn("h-6 rounded-full px-2 text-[11px] font-medium border transition-colors disabled:opacity-40", gi === i ? "border-fg text-fg bg-surface-2" : "border-line text-fg-3")}
                  >
                    Action {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-4">
            {!r || r.skipped ? (
              <Preview scenario={scenario} agentId={agent.id} />
            ) : (
              <ol className="relative">
                {stages.map((s, si) => {
                  const state = si < r.stage ? "done" : si === r.stage ? (si === stages.length - 1 ? "done" : "active") : "pending";
                  return (
                    <Stage key={s.key} title={s.title} state={state} last={si === stages.length - 1} tone={s.key === "decision" || s.key === "enforce" ? d : undefined}>
                      {si <= r.stage && <StageBody k={s.key} gate={gate} agent={agent} scenario={scenario} run={r} hook={native.hook} onProbe={(p) => patchRun(gi, { probe: p })} />}
                    </Stage>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Payload n={1} title={`${agent.name} sent`} sub={native.hook} ready={!!r && !r.skipped && r.stage >= 0} code={json(native.request)} />
        <Payload
          n={2}
          title="Wrapbox evaluated"
          sub={r ? `rule ${r.v.rule} · ${gate.latency} ms` : "…"}
          ready={!!r && !r.skipped && r.stage >= 1}
          code={json({ ...normalizedFor(agent, gate, scenario), rule: r?.v.rule, decision: r && r.stage >= 4 ? d : "…", ...(r?.v.observed ? { observe_mode_would: r.v.observed } : {}) })}
        />
        <Payload
          n={3}
          title={`${agent.name} received`}
          sub="in the agent's own format"
          ready={!!r && !r.skipped && r.stage >= 4}
          code={json(
            native.respond(d, {
              reason: r?.rejected ? `rejected by approver — ${r.rejected}` : (r?.v.reason ?? gate.reason),
              rule: r?.v.rule ?? gate.rule,
              decisionId: r?.decisionId ?? "d-……",
              permitId: r?.permit?.id,
              pending: d === "REVIEW" && !r?.permit && !r?.rejected,
              rewritten: d === "CONSTRAIN" ? r?.args : undefined,
            }),
          )}
        />
      </div>

      <AnimatePresence>
        {phase === "done" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className={cn("p-4 flex flex-wrap items-center gap-4", gaps.length && "border-review/50")}>
              <span className={cn("grid size-9 place-items-center rounded-full", gaps.length ? "bg-review-soft text-review" : "bg-allow-soft text-allow")}>
                {gaps.length ? <AlertTriangle className="size-5" /> : <Check className="size-5" />}
              </span>
              <div className="flex-1 min-w-[240px]">
                <div className="font-semibold text-[14px]">
                  {matchedScript ? scenario.outcome : gaps.length ? `${gaps.length} risky action${gaps.length > 1 ? "s" : ""} ran because no rule in your contract covers ${gaps.length > 1 ? "them" : "it"}.` : "Decided by your contract."}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                  {counts.ALLOW > 0 && <Chip tone="allow">{counts.ALLOW} allowed with permit</Chip>}
                  {counts.CONSTRAIN > 0 && <Chip className="bg-constrain-soft text-constrain border-0">{counts.CONSTRAIN} rewritten to a safe variant</Chip>}
                  {counts.REVIEW > 0 && <Chip tone="review">{counts.REVIEW} approved by humans</Chip>}
                  {counts.BLOCK > 0 && <Chip tone="block">{counts.BLOCK} blocked before execution</Chip>}
                  <Chip>{done.length} decisions in Evidence</Chip>
                </div>
              </div>
              {gaps.length > 0 && (
                <Button variant="primary" onClick={() => go(`/contract?suggest=${gaps[0].g.id}`)}>
                  <Wand2 className="size-3.5" /> Write a rule for this
                </Button>
              )}
              <Button onClick={() => go("/evidence")}>
                Open evidence <ArrowRight className="size-3.5" />
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Preview({ scenario, agentId }: { scenario: Scenario; agentId: string }) {
  const published = useStore((s) => s.published);
  const kill = useStore((s) => s.killSwitch);
  void published;
  void kill;
  return (
    <div>
      <div className="eyebrow mb-2">What your contract will decide</div>
      <p className="text-[13px] text-fg-2 leading-relaxed mb-4">“{scenario.prompt}”</p>
      <ol className="space-y-2">
        {scenario.gates.map((g, i) => {
          const v = evaluateNow(actOf(g), agentId);
          return (
            <li key={g.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
              <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-fg-2 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11.5px] truncate">{g.display}</div>
                <div className="text-[12px] text-fg-3 mt-0.5">
                  {v.rule === "default" ? "no rule matches → default ALLOW" : `rule ${v.rule} · ${v.reason}`}
                  {REQUIRES_BLOCK.has(g.id) && " · only if the previous action is blocked"}
                </div>
              </div>
              <DecisionPill d={v.decision} size="sm" />
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[12px] text-fg-3 leading-relaxed">Change the contract and this preview changes with it. Every action: intercepted → normalized → identity → your contract → decision → permit → executor check → evidence.</p>
    </div>
  );
}

function Stage({ title, state, children, last, tone }: { title: string; state: "done" | "active" | "pending"; children?: ReactNode; last?: boolean; tone?: Decision }) {
  return (
    <li className="relative pl-7 pb-3.5">
      {!last && <span className={cn("absolute left-[9px] top-5 bottom-0 w-px", state === "done" ? "bg-fg/25" : "bg-line")} />}
      <span
        className={cn(
          "absolute left-0 top-0.5 grid size-[19px] place-items-center rounded-full border text-[10px]",
          state === "done" && !tone && "bg-ink border-ink text-ink-fg",
          state === "done" && tone === "ALLOW" && "bg-allow border-allow text-white",
          state === "done" && tone === "CONSTRAIN" && "bg-constrain border-constrain text-white",
          state === "done" && tone === "REVIEW" && "bg-review border-review text-white",
          state === "done" && tone === "BLOCK" && "bg-block border-block text-white",
          state === "active" && "border-accent text-accent bg-surface",
          state === "pending" && "border-line bg-surface",
        )}
      >
        {state === "done" ? tone === "BLOCK" ? <CircleSlash className="size-3" /> : <Check className="size-3" strokeWidth={3} /> : state === "active" ? <Loader2 className="size-3 animate-spin" /> : null}
      </span>
      <div className={cn("text-[12.5px] font-semibold", state === "pending" ? "text-fg-3" : "text-fg")}>{title}</div>
      {children && <div className="mt-1.5">{children}</div>}
    </li>
  );
}

function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-[11.5px] leading-relaxed">
      <span className="text-fg-3 w-[88px] shrink-0">{k}</span>
      <span className={cn("text-fg min-w-0 break-words", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function HoldBudget({ since }: { since: number }) {
  const left = useCountdown(since + 75_000);
  return <span className={cn("font-mono text-[11px]", left > 0 ? "text-fg-3" : "text-review")}>{left > 0 ? `hook held · ${left}s of 75s poll budget` : "budget elapsed → agent told to retry; approval stays open"}</span>;
}

function StageBody({ k, gate, agent, scenario, run, hook, onProbe }: { k: StageKey; gate: Gate; agent: Agent; scenario: Scenario; run: GateRun; hook: string; onProbe: (p: GateRun["probe"]) => void }) {
  const approval = useStore((s) => (run.approvalId ? s.approvals.find((a) => a.id === run.approvalId) : undefined));
  const d = run.rejected ? "BLOCK" : run.v.decision;
  const matched = run.v.trace.filter((t) => t.matched);
  switch (k) {
    case "intercept":
      return <KV k="adapter" v={hook} />;
    case "normalize":
      return (
        <div className="space-y-0.5">
          <KV k="effect" v={actOf(gate).effect} />
          <KV k="resource" v={gate.resource} />
          <KV k="environment" v={actOf(gate).env ?? gate.environment} />
        </div>
      );
    case "identity":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <Avatar p={scenario.human} size={18} />
          <span className="font-medium">{scenario.human.name}</span>
          <ArrowRight className="size-3 text-fg-3" />
          <Logo name={agent.logo} bleed={agent.bleed} size={18} rounded="rounded" />
          <span className="font-medium">{agent.id}</span>
          {scenario.delegation && (
            <>
              <ArrowRight className="size-3 text-fg-3" />
              <span className="font-mono">purchasing-subagent</span>
            </>
          )}
        </div>
      );
    case "policy":
      return (
        <div className="space-y-2">
          {run.v.rule === "default" && gate.decision === "ALLOW" ? (
            <div className="rounded-lg bg-surface-2 border border-line px-2.5 py-1.5 text-[11.5px] text-fg-2">No rule matches this low-risk action · default ALLOW · deterministic, no model in the loop</div>
          ) : run.v.rule === "default" ? (
            <div className="rounded-lg border border-review/40 bg-review-soft/60 px-2.5 py-1.5 text-[11.5px]">
              <b>No rule in your contract matches.</b> <span className="text-fg-2">Default is ALLOW.</span>{" "}
              <a href={`#/contract?suggest=${gate.id}`} className="underline underline-offset-2 font-medium">
                Write a rule for this →
              </a>
            </div>
          ) : (
            <div className="rounded-lg bg-surface-2 border border-line px-2.5 py-1.5 font-mono text-[11px]">
              <span className="text-fg-3">matched</span> {matched.map((t) => t.rule.id).join(", ")}
              {matched.length > 1 && <span className="text-fg-3"> · most restrictive wins → </span>}
              {matched.length > 1 && <span className="font-semibold">{run.v.rule}</span>}
              <span className="text-fg-3"> · deterministic · no model in the loop</span>
            </div>
          )}
          {run.v.observed && (
            <div className="text-[11.5px] text-review">
              Observe mode: would have been <b>{run.v.observed}</b> — logged, not enforced.
            </div>
          )}
          <Signals signals={gate.signals} dense />
        </div>
      );
    case "decision":
      return (
        <div className="grid grid-cols-[1fr_120px] gap-3 items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <DecisionPill d={d} />
              <span className="font-mono text-[11px] text-fg-3">{gate.latency} ms</span>
            </div>
            <div className="text-[12px] text-fg-2">{run.v.reason}</div>
          </div>
          <DecisionSpace mini height={110} points={[]} highlight={{ id: gate.id, x: gate.space[0], y: gate.space[1], d }} />
        </div>
      );
    case "human":
      return (
        <div className="space-y-1.5">
          {gate.scope && (
            <div className="rounded-lg border border-line px-2.5 py-1.5 text-[11.5px]">
              <span className={gate.scope.ok ? "text-allow font-medium" : "text-block font-medium"}>{gate.scope.ok ? "✓ In scope of the task" : "✕ Outside the task"}</span>
              <span className="text-fg-2"> · {gate.scope.note}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-fg-3">
            {approval?.quorum ?? 1} of {approval?.approvers.length ?? 1} required · group {run.v.approvers ?? "admin"} · in{" "}
            <a href="#/approvals" className="text-fg underline underline-offset-2">
              Approvals
            </a>
            {run.heldAt && !run.permit && ["claude", "codex", "cursor", "copilot", "gemini"].includes(agent.adapter) && <HoldBudget since={run.heldAt} />}
          </div>
          {(approval?.approvers ?? []).map((p) => {
            const done = approval?.approvedBy.includes(p.id);
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                <Avatar p={p} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-fg-3 truncate">{done ? `signed ${approval?.signatures[p.id]?.slice(0, 16)}…` : p.role}</div>
                </div>
                {done ? (
                  <Chip tone="allow">
                    <Check className="size-3" /> Signed
                  </Chip>
                ) : approval?.status === "pending" ? (
                  <Button size="sm" variant="allow" onClick={() => approveWithPasskey(approval, p)}>
                    Approve as {p.name.split(" ")[0]}
                  </Button>
                ) : null}
              </div>
            );
          })}
          {["claude", "codex", "cursor", "copilot", "gemini"].includes(agent.adapter) && (
            <p className="text-[11px] text-fg-3 leading-snug">Why not the agent's own “ask” prompt? The developer at the keyboard could approve their own action. Wrapbox holds the hook and routes to a separate, signed approver.</p>
          )}
        </div>
      );
    case "constrain": {
      const before = (gateArgs(gate) as { sql?: string; command?: string }).sql ?? (gateArgs(gate) as { command?: string }).command ?? gate.display;
      const after = (run.args as { sql?: string; command?: string }).sql ?? (run.args as { command?: string }).command ?? "";
      return (
        <div className="space-y-1.5">
          <div className="rounded-lg bg-code border border-code-line p-2.5 font-mono text-[11px] leading-relaxed">
            <div className="text-[#ff8fa3] break-words">− {before}</div>
            <div className="text-[#3fd49b] break-words">+ {after}</div>
          </div>
          <div className="flex items-start gap-1.5 text-[11.5px] text-fg-2">
            <Wand2 className="size-3.5 text-constrain mt-0.5 shrink-0" /> {gate.constrain?.note ?? "Allowed as a safer variant; the permit binds the rewritten arguments."}
          </div>
        </div>
      );
    }
    case "permit":
      if (d === "BLOCK") return <div className="text-[12px] text-fg-2">Nothing to verify — the executor refuses anything without a permit, so the effect never runs.</div>;
      return run.permit ? <PermitTicket permit={run.permit} status={run.checks?.every((c) => c.ok) ? "used" : "authorized"} /> : null;
    case "enforce":
      if (d === "BLOCK") return <div className="text-[12px] text-fg-2">{agent.name} received the denial and its reason in its own format (see “received” below).</div>;
      return run.checks ? (
        <div className="space-y-2.5">
          <Checks checks={run.checks} />
          <div className="flex flex-wrap gap-1.5">
            {gate.tamper && (
              <Button size="sm" onClick={async () => onProbe({ label: gate.tamper!.label, checks: await verifyPermit(run.permit!, gate.tamper!.args, { consume: false, probe: true }) })}>
                <FlaskConical className="size-3.5" /> Tamper test
              </Button>
            )}
            <Button size="sm" onClick={async () => onProbe({ label: "Agent replays the same permit a second time", checks: await verifyPermit(run.permit!, run.args, { consume: false }) })}>
              <Repeat2 className="size-3.5" /> Replay permit
            </Button>
          </div>
          {run.probe && (
            <div className="rounded-lg border border-block/30 bg-block-soft/50 p-2.5">
              <div className="text-[12px] font-semibold text-block mb-1.5">{run.probe.label} → executor refuses</div>
              <Checks checks={run.probe.checks} />
            </div>
          )}
        </div>
      ) : null;
    case "evidence":
      return (
        <div className="text-[12px] text-fg-2">
          <span className="font-mono text-fg">{run.decisionId}</span> · human → agent → tool → resource → rule {run.v.rule}
          {d === "REVIEW" || approval ? " → signed approver" : ""} → {d === "BLOCK" ? "denial" : "permit"} → outcome
        </div>
      );
  }
}

function Payload({ n, title, sub, code, ready }: { n: number; title: string; sub: string; code: string; ready: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold text-fg-2">{n}</span>
        <span className="text-[12.5px] font-semibold">{title}</span>
        <span className="text-[11.5px] text-fg-3 truncate">{sub}</span>
      </div>
      <div className={cn("transition-opacity", ready ? "opacity-100" : "opacity-40")}>
        <CodeBlock code={ready ? code : "// waiting for the agent…"} lang="json" maxH={240} />
      </div>
    </div>
  );
}
