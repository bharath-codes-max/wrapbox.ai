import { ArrowRight, FlaskConical, OctagonX, Pause, Play, Plug, Server, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { AGENTS, ASSURANCE, CATEGORIES, agentById, agentsIn, type Assurance, type Decision } from "../data/agents";
import { DecisionSpace } from "../components/insight";
import { DecisionStream } from "../components/stream";
import { Avatar, Button, Card, CardHead, D_DOT, DecisionPill, Logo, PageHeader, Segmented, Toggle, cn } from "../components/ui";
import { useAccount } from "../lib/auth";
import { ago, go } from "../lib/router";
import { adminPerson, getState, setState, spaceOf, tickTraffic, toast, useStore, useWorkspace, type Evt } from "../lib/store";
import { EvidenceDrawer } from "./evidence";
import { useCpStatus } from "../lib/cp-sync";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/* 24 hourly buckets, deterministic, with a work-day shape */
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const shape = 0.25 + 0.75 * Math.max(0, Math.sin(((i - 6) / 16) * Math.PI));
  const base = Math.round(260 + 900 * shape + ((i * 37) % 60));
  return { h: i, allow: Math.round(base * 0.9), constrain: Math.round(base * 0.03), review: Math.round(base * 0.028 + (i % 3)), block: Math.round(base * 0.042 + (i % 4)) };
});

function HourlyChart({ events }: { events?: Evt[] }) {
  const W = 720,
    H = 170,
    padL = 34,
    padB = 22,
    padT = 8;
  const now = new Date();
  const data = events
    ? Array.from({ length: 24 }, (_, i) => {
        const h = (now.getHours() - 23 + i + 24) % 24;
        const inHour = events.filter((e) => new Date(e.ts).getHours() === h && Date.now() - e.ts < 24 * 3600_000);
        const c = (d: string) => inHour.filter((e) => e.decision === d).length;
        return { h, allow: c("ALLOW"), constrain: c("CONSTRAIN"), review: c("REVIEW"), block: c("BLOCK") };
      })
    : HOURS;
  const peak = Math.max(...data.map((d) => d.allow + d.constrain + d.review + d.block));
  const max = events ? Math.max(4, Math.ceil(peak * 1.25)) : 1400;
  const ticks = events ? [0, Math.round(max / 2), max] : [0, 500, 1000];
  const bw = (W - padL - 8) / 24;
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Decisions per hour, last 24 hours">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? "3 4" : undefined} />
          <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = padL + i * bw + 2;
        const w = bw - 4;
        const parts: [number, string, number][] = [
          [d.allow, "var(--fg-3)", i === 23 ? 0.7 : 0.28],
          [d.constrain, "var(--constrain)", 1],
          [d.review, "var(--review)", 1],
          [d.block, "var(--block)", 1],
        ];
        let top = y(0);
        return (
          <g key={i}>
            {parts.map(([v, c, o], k) => {
              const h = y(0) - y(v);
              top -= h + (k ? 1 : 0);
              return <rect key={k} x={x} y={top} width={w} height={Math.max(h, 0)} rx={k ? 1 : 2} fill={c} opacity={o} />;
            })}
            {i % 6 === 0 && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)">
                {String(d.h).padStart(2, "0")}:00
              </text>
            )}
          </g>
        );
      })}
      <text x={W - 4} y={H - 6} textAnchor="end" fontSize="10" fill="var(--fg-2)" fontFamily="var(--font-mono)">
        now
      </text>
    </svg>
  );
}

function ConnectControlPlaneCard({ status }: { status: string }) {
  const label =
    status === "unconfigured" ? "No Control Plane connected yet." :
    status === "connecting" ? "Trying to reach the Control Plane…" :
    status === "unauthorized" ? "The admin key was rejected." :
    "The Control Plane is unreachable from this browser.";
  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="Wrapbox v2 · production"
        title="Connect a Control Plane to see your fleet"
        sub="Wrapbox v2 is the real product — nothing is shown here until it can reach a Control Plane. Every number on every page will come from that server, not from this browser."
      />
      <Card className="p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-fg-2">
            <Server className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{label}</div>
            <p className="mt-1 text-[13px] text-fg-3 max-w-[64ch] leading-relaxed">
              Point Wrapbox at a running Control Plane, enroll at least one device, and this page will populate from live data. Until then it stays blank — no seeded numbers, no illustrative fleet.
            </p>
            <ol className="mt-5 space-y-3 text-[13px] max-w-[64ch]">
              <li className="flex gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-fg text-surface text-[11px] font-semibold shrink-0">1</span>
                <div>
                  <div className="font-medium">Start the Control Plane</div>
                  <pre className="mt-1 rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-2 overflow-x-auto">cd control-plane && npm run dev</pre>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-fg text-surface text-[11px] font-semibold shrink-0">2</span>
                <div>
                  <div className="font-medium">Enroll a device from the runtime</div>
                  <pre className="mt-1 rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg-2 overflow-x-auto">cd runtime && npm run cli -- enroll --server &lt;url&gt; --token &lt;wbxe_…&gt;</pre>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-fg text-surface text-[11px] font-semibold shrink-0">3</span>
                <div>
                  <div className="font-medium">Point Wrapbox at it</div>
                  <p className="text-fg-3 mt-0.5">Open <button className="underline" onClick={() => go("/settings")}>Settings → Control Plane</button>, paste the server URL, admin key and org id.</p>
                </div>
              </li>
            </ol>
            <div className="mt-6 flex gap-2">
              <Button variant="primary" onClick={() => go("/settings")}>
                <Plug className="size-3.5" /> Open Settings
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function Overview() {
  const workspace = useStore((s) => s.workspace);
  const cpStatus = useCpStatus();
  if (workspace === "v2" && cpStatus !== "connected") return <ConnectControlPlaneCard status={cpStatus} />;
  const allEvents = useStore((s) => s.events);
  const envFilter = useStore((s) => s.envFilter);
  const events = useMemo(() => (envFilter === "all" ? allEvents : allEvents.filter((e) => e.env === envFilter)), [allEvents, envFilter]);
  const baseline = useStore((s) => s.baseline);
  const ws = useWorkspace();
  const company = useStore((s) => s.company);
  const fresh = ws.kind === "fresh";
  const sandbox = ws.kind === "sandbox";
  const approvals = useStore((s) => s.approvals);
  const connected = useStore((s) => s.connected);
  const kill = useStore((s) => s.killSwitch);
  const live = useStore((s) => s.live);
  // v2 is the live Control-Plane-backed workspace. The CP is read-only (cp-api.ts issues GET only) and has no
  // kill-switch or approval concept, so controls that would write to a device must be inert and honestly labelled
  // here; fabric/fresh drive the local evaluator, where those controls genuinely do what the copy says.
  const cpBacked = workspace === "v2";
  const [filter, setFilter] = useState<"all" | Decision>("all");
  const [open, setOpen] = useState<Evt | null>(null);
  const account = useAccount();
  const members = useStore((s) => s.members);
  const first = (account?.name?.trim() || adminPerson({ members } as never).name).split(" ")[0];
  const pending = approvals.filter((a) => a.status === "pending");
  // Real latency percentiles from the decisions on screen — never a typed-in number.
  const lat = useMemo(() => {
    const xs = allEvents.map((e) => e.latency).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
    const q = (p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
    return { p50: q(0.5), p99: q(0.99) };
  }, [allEvents]);
  const shown = filter === "all" ? events : events.filter((e) => e.decision === filter);
  // "Today" is the calendar day in the reference workspace, everything in a fresh one, and the seeded baseline plus
  // what has happened since load in the sandbox.
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const scope = sandbox ? allEvents.filter((e) => e.source !== "seed") : fresh ? allEvents : allEvents.filter((e) => e.ts >= dayStart);
  const total = (sandbox ? baseline.decisions : 0) + scope.length;
  const blocked = (sandbox ? baseline.blocked : 0) + scope.filter((e) => e.decision === "BLOCK").length;
  const rewritten = (sandbox ? baseline.rewritten : 0) + scope.filter((e) => e.decision === "CONSTRAIN").length;
  const nConnected = Object.keys(connected).length;
  const wouldStop = scope.filter((e) => e.observed === "BLOCK" || e.observed === "REVIEW").length;

  const byAssurance = useMemo(() => {
    const m: Record<Assurance, number> = { "observe-only": 0, "hook-enforced": 0, "gateway-enforced": 0, "endpoint-enforced": 0, "resource-verified": 0 };
    Object.values(connected).forEach((c) => m[c.assurance]++);
    return m;
  }, [connected]);
  const score = Math.round((Object.values(connected).reduce((s, c) => s + ASSURANCE[c.assurance].rank, 0) / Math.max(1, nConnected) / 5) * 100);

  const topRules = useMemo(() => {
    const m = new Map<string, { n: number; d: Decision }>();
    events.filter((e) => e.decision !== "ALLOW").forEach((e) => m.set(e.rule, { n: (m.get(e.rule)?.n ?? 0) + 1, d: e.decision }));
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  }, [events]);

  const points = useMemo(
    () =>
      events.slice(0, 160).map((e) => {
        const [x, y] = spaceOf(e);
        return { id: e.id, x, y, d: e.decision, label: `${agentById(e.agentId).name} · ${e.action}` };
      }),
    [events],
  );

  const kpis = [
    { label: "Decisions today", value: total.toLocaleString("en-US"), sub: total ? `p50 ${lat.p50} ms · p99 ${lat.p99} ms` : "none yet" },
    { label: "Blocked before execution", value: blocked.toLocaleString("en-US"), sub: total ? `${((blocked / Math.max(1, total)) * 100).toFixed(1)}% of actions` : "—", tone: "text-block" },
    { label: "Rewritten to a safe variant", value: rewritten.toLocaleString("en-US"), sub: "PII masked, force-with-lease…", tone: "text-constrain" },
    { label: "Waiting for a human", value: String(pending.length), sub: "oldest " + (pending.length ? ago(Math.min(...pending.map((p) => p.createdAt))) : "—"), tone: "text-review", href: "/approvals" },
    { label: "Agents connected", value: `${nConnected} / ${AGENTS.length}`, sub: `assurance score ${score}`, href: "/agents" },
  ];

  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={`${greeting()} · ${fresh ? "fresh workspace" : sandbox ? "Wrapbox production control plane" : `${company} · production`}`}
        title={total ? (blocked === 0 && wouldStop > 0 ? `${total.toLocaleString("en-US")} agent actions checked today. ${wouldStop} would be stopped once you enforce.` : `${total.toLocaleString("en-US")} agent actions checked today. ${blocked.toLocaleString("en-US")} stopped before they ran.`) : nConnected ? "Agents connected. Waiting for their first action." : "Nothing to govern yet — connect your first agent."}
        sub={total ? `${greeting()}, ${first}. Across ${nConnected} connected agents — every action checked against contract v${getState().version}, every risky one stopped, rewritten or held for a person.` : ws.labs ? "Every page fills in as you go: connect an agent, write a rule, send an action from the playground or run a happy flow." : "Every page fills in as agents act: connect an agent and publish a rule, and decisions appear here."}
        right={
          <>
            <Button onClick={() => go("/agents")}>
              <Plug className="size-3.5" /> Connect agent
            </Button>
            {ws.labs ? (
              <Button variant="primary" onClick={() => go("/flows/cli")}>
                <Play className="size-3.5 fill-current" /> Run a happy flow
              </Button>
            ) : (
              <Button variant="primary" onClick={() => go("/approvals")}>
                Review approvals{pending.length ? <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px] tnum">{pending.length}</span> : null}
              </Button>
            )}
          </>
        }
      />

      <Card className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-4">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => k.href && go(k.href)} className={cn("text-left px-6 py-5", k.href && "hover:bg-surface-2 transition-colors")}>
            <div className="text-[12px] text-fg-3">{k.label}</div>
            <div className={cn("mt-1 text-[24px] font-semibold tracking-tight tnum", k.tone)}>{k.value}</div>
            <div className="text-[11.5px] text-fg-3 mt-0.5 truncate">{k.sub}</div>
          </button>
        ))}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden min-w-0">
          <CardHead
            title={
              <span className="flex items-center gap-2">
                Live decision stream <span className={cn("size-1.5 rounded-full", live ? "bg-allow live-dot" : "bg-line-strong")} />
              </span>
            }
            sub="One contract, many agent vendors. Click any row for its evidence."
            right={
              <div className="flex items-center gap-2">
                <Segmented
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "BLOCK", label: "Blocked" },
                    { value: "CONSTRAIN", label: "Rewritten" },
                    { value: "REVIEW", label: "Review" },
                  ]}
                />
                <button onClick={() => setState({ live: !live })} className="grid size-7 place-items-center rounded-full border border-line text-fg-2 hover:text-fg" aria-label={live ? "Pause stream" : "Resume stream"}>
                  {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
              </div>
            }
          />
          <div className="border-t border-line">
            {shown.length ? (
              <DecisionStream events={shown} limit={11} onPick={setOpen} />
            ) : (
              <div className="px-6 py-12 text-center">
                <div className="text-[13.5px] font-semibold">No decisions yet</div>
                <p className="mt-1 text-[12.5px] text-fg-3">{nConnected ? (ws.labs ? "Send an action from the playground or run a happy flow — it appears here instantly." : "Decisions appear here the moment a connected agent acts.") : "Connect an agent, then send it an action."}</p>
                <div className="mt-4 flex justify-center gap-2">
                  {!nConnected && (
                    <Button size="sm" variant="primary" onClick={() => go("/agents")}>
                      <Plug className="size-3.5" /> Connect an agent
                    </Button>
                  )}
                  {ws.labs && (
                    <Button size="sm" onClick={() => go("/playground")}>
                      <FlaskConical className="size-3.5" /> Open the playground
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-5 min-w-0">
          {fresh && (
            <Card className="p-6">
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-fg-2">
                  <Zap className="size-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">Test traffic</div>
                  <div className="text-[12.5px] text-fg-3 mt-0.5">{nConnected ? "Send test actions from your connected agents. Each one is decided by your published contract." : "Connect agents first — traffic only comes from connected agents."}</div>
                </div>
                <Toggle on={live} onChange={(v) => setState({ live: v })} label="Continuous test traffic" />
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={!nConnected}
                onClick={() => {
                  const n = tickTraffic(20);
                  toast(n ? `${n} test actions sent` : "No connected agents", n ? "Decided by your published contract" : undefined, "allow");
                }}
              >
                <Zap className="size-3.5" /> Send 20 test actions
              </Button>
            </Card>
          )}
          <Card className={cn("p-5 transition-colors", kill && "border-block bg-block-soft/40")}>
            <div className="flex items-start gap-3">
              <span className={cn("grid size-9 place-items-center rounded-xl", kill ? "bg-block text-white" : "bg-surface-2 text-fg-2")}>
                <OctagonX className="size-4.5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold">Org kill switch</div>
                <div className="text-[12.5px] text-fg-3 mt-0.5">
                  {cpBacked
                    ? "Not available on this Control Plane yet — this build only reads from it. Nothing here reaches your enrolled devices."
                    : kill
                      ? "Every action this workspace evaluates is denied right now."
                      : "Simulated: deny every agent action in this workspace."}
                </div>
              </div>
              {cpBacked ? (
                // No write path to the CP in v2 — render the control inert rather than imply an org-wide stop it cannot perform.
                <span className="pointer-events-none opacity-40">
                  <Toggle on={false} tone="block" label="Kill switch — not available on this Control Plane" onChange={() => {}} />
                </span>
              ) : (
                <Toggle
                  on={kill}
                  tone="block"
                  label="Kill switch"
                  onChange={(v) => {
                    setState({ killSwitch: v });
                    toast(v ? "Simulated kill switch engaged" : "Kill switch released", v ? "Decisions in this workspace now return BLOCK." : "Decisions follow the published contract again.", v ? "block" : "allow");
                  }}
                />
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHead title="Waiting for a human" sub={cpBacked ? "Review rules stop the agent and ask its operator. Signed, quorum-bound approvals are not on this Control Plane yet." : "Signed approvals, bound to exact arguments"} right={<Button size="sm" variant="ghost" onClick={() => go("/approvals")}>All <ArrowRight className="size-3" /></Button>} />
            <div className="border-t border-line">
              {pending.slice(0, 4).map((a) => {
                const ag = agentById(a.agentId);
                return (
                  <a key={a.id} href="#/approvals" className="flex items-center gap-3 px-6 py-3.5 border-b border-line last:border-0 hover:bg-surface-2">
                    <Logo name={ag.logo} bleed={ag.bleed} size={24} rounded="rounded-md" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11.5px] truncate">{a.title}</div>
                      <div className="text-[11.5px] text-fg-3">
                        {a.approvedBy.length}/{a.quorum} signed · {ago(a.createdAt)}
                      </div>
                    </div>
                    <div className="flex -space-x-1.5">
                      {a.approvers.map((p) => (
                        <Avatar key={p.id} p={p} size={20} className={a.approvedBy.includes(p.id) ? "" : "opacity-50"} />
                      ))}
                    </div>
                  </a>
                );
              })}
              {!pending.length && <div className="px-5 py-6 text-[12.5px] text-fg-3">{cpBacked ? "Nothing waiting. Review decisions are answered at the agent's own terminal today — they do not queue here yet." : ws.labs ? "Nothing waiting. Run a happy flow to create one." : "Nothing waiting. REVIEW decisions land here the moment an agent hits one."}</div>}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-baseline justify-between">
              <div className="text-[13.5px] font-semibold">Assurance</div>
              <div className="text-[12px] text-fg-3">
                score <span className="font-semibold text-fg tnum">{score}</span>/100
              </div>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
              {(Object.keys(byAssurance) as Assurance[]).map((a, i) => (
                <div key={a} style={{ width: `${(byAssurance[a] / Math.max(1, nConnected)) * 100}%`, opacity: 0.3 + i * 0.17 }} className="bg-fg border-r border-surface last:border-0" />
              ))}
            </div>
            <ul className="mt-3 space-y-1">
              {(Object.keys(byAssurance) as Assurance[]).map((a) => (
                <li key={a} className="flex justify-between text-[12px]">
                  <span className="text-fg-2">{ASSURANCE[a].label}</span>
                  <span className="font-mono tnum text-fg-3">{byAssurance[a]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
            <div>
              <div className="text-[13.5px] font-semibold">Decision space</div>
              <div className="text-[12px] text-fg-3 max-w-[52ch]">Every recent action, placed by the same deterministic signals the policy engine reads. Rules decide; this shows where decisions land.</div>
            </div>
            <div className="flex flex-wrap gap-3 text-[11.5px] text-fg-2">
              {(["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"] as Decision[]).map((d) => (
                <span key={d} className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", D_DOT[d])} />
                  {d.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <DecisionSpace points={points} height={320} onPick={(id) => setOpen(events.find((e) => e.id === id) ?? null)} />
            {!points.length && <div className="absolute inset-0 grid place-items-center text-[12.5px] text-fg-3">Decisions appear here as your agents act.</div>}
          </div>
        </Card>
        <div className="space-y-5 min-w-0">
          <Card className="p-6">
            <div className="mb-2">
              <div className="text-[13.5px] font-semibold">Decisions · last 24 hours</div>
              <div className="text-[12px] text-fg-3">Per hour, stacked by outcome</div>
            </div>
            <HourlyChart events={sandbox ? undefined : allEvents} />
          </Card>
          <Card className="overflow-hidden">
            <CardHead title="Rules doing the work" sub="Non-allow decisions in the stream" right={<Button size="sm" variant="ghost" onClick={() => go("/contract")}>Contract <ArrowRight className="size-3" /></Button>} />
            <ul className="border-t border-line">
              {!topRules.length && <li className="px-5 py-5 text-[12.5px] text-fg-3">No rule has fired yet.</li>}
              {topRules.map(([rule, v]) => (
                <li key={rule} className="flex items-center gap-3 px-5 py-2 border-b border-line last:border-0">
                  <span className="font-mono text-[12px] flex-1 truncate">{rule}</span>
                  <DecisionPill d={v.d} size="sm" />
                  <span className="font-mono text-[12px] text-fg-3 tnum w-6 text-right">{v.n}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHead title="Coverage by surface" sub={`${CATEGORIES.length} surfaces across ${AGENTS.length} agents — connect one and the contract follows it`} right={<Button size="sm" variant="ghost" onClick={() => go("/agents")}>Manage <ArrowRight className="size-3" /></Button>} />
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 border-t border-line">
          {CATEGORIES.map((c) => {
            const list = agentsIn(c.id);
            const on = list.filter((a) => connected[a.id]).length;
            return (
              <a key={c.id} href={`#/agents?c=${c.id}`} className="flex items-center gap-3 px-6 py-4 border-b border-line sm:odd:border-r xl:border-r xl:[&:nth-child(4n)]:border-r-0 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate">{c.name}</div>
                  <div className="text-[11.5px] text-fg-3">
                    {on} of {list.length} connected
                  </div>
                </div>
                <div className="flex -space-x-1">
                  {list.map((a) => (
                    <Logo key={a.id} name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" className={cn("ring-2 ring-surface", !connected[a.id] && "opacity-30 grayscale")} />
                  ))}
                </div>
              </a>
            );
          })}
        </div>
      </Card>

      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}
