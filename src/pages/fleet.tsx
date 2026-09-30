import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Download, KeyRound, Laptop, Network, OctagonX, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { agentById } from "../data/agents";
import { personById } from "../data/people";
import { profileOf } from "../data/profiles";
import { DecisionStream } from "../components/stream";
import { Avatar, Button, Card, CardHead, Chip, Logo, PageHeader, cn } from "../components/ui";
import { COVERAGE, KINDS, LAUNCH, coverageFor, devicesFor, fmtHeartbeat, gapFor, type CoverageClass } from "../lib/fabric";
import { ago, go } from "../lib/router";
import { EMPLOYEE, adminPerson, useStore, type Destination, type DiscoveredAgent, type Evt, type FleetDevice, type GatewayNode } from "../lib/store";
import { EvidenceDrawer } from "./evidence";

const STATE_TONE: Record<FleetDevice["state"], "allow" | "review" | "block" | "muted"> = { healthy: "allow", "heartbeat-lost": "review", quarantined: "block", enrolling: "muted" };
const STATE_LABEL: Record<FleetDevice["state"], string> = { healthy: "healthy", "heartbeat-lost": "heartbeat lost", quarantined: "quarantined", enrolling: "enrolling" };

interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone?: string;
  href?: string;
}

/** Coverage for display. Floor is OS kernel confinement, which a process has only when the Runtime
 *  launched it under the sandbox (`launchMode === "wrapbox"`). On the live Control Plane an agent's
 *  launch mode comes from a filesystem scan, so every agent is "unknown" — the scan proves it is
 *  installed, never that it ran under confinement — and there is no Floor to claim. The scripted
 *  reference stamps its own coverage and is left untouched. */
function coverageDisplay(d: FleetDevice, a: DiscoveredAgent, kind: Parameters<typeof coverageFor>[2], gateways: GatewayNode[], destinations: Destination[], cpBacked: boolean): CoverageClass[] {
  const cov = coverageFor(d, a, kind, gateways, destinations);
  return cpBacked && a.launchMode !== "wrapbox" ? cov.filter((c) => c !== "Floor") : cov;
}

/** Every coverage class any agent on the device has for any action kind, in strength order. */
function deviceCoverage(d: FleetDevice, gateways: GatewayNode[], destinations: Destination[], cpBacked: boolean) {
  const set = new Set<CoverageClass>();
  for (const a of d.agents) for (const k of KINDS) coverageDisplay(d, a, k.id, gateways, destinations, cpBacked).forEach((c) => set.add(c));
  return (["Floor", "Ceiling", "Remote", "Assured"] as CoverageClass[]).filter((c) => set.has(c));
}

export function Fleet() {
  const role = useStore((s) => s.role);
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const destinations = useStore((s) => s.destinations);
  const events = useStore((s) => s.events);
  const approvals = useStore((s) => s.approvals);
  const sessions = useStore((s) => s.sessions);
  const version = useStore((s) => s.version);
  const company = useStore((s) => s.company);
  const members = useStore((s) => s.members);
  // The live Control-Plane workspace is read-only inventory: discovery proves an agent is installed,
  // never that it is governed. Simulated workspaces (fabric reference) provision and confine for real,
  // so many coverage/attribution claims that are false in v2 are true there — gate on this, not delete.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const admin = role === "admin";
  const me = admin ? adminPerson({ members } as never) : EMPLOYEE;
  const devices = devicesFor(fleet, me.id, admin);
  const [open, setOpen] = useState<Evt | null>(null);

  const dayStart = new Date().setHours(0, 0, 0, 0);
  const mine = useMemo(() => (admin ? events : events.filter((e) => e.human === me.id)), [events, admin, me.id]);
  const today = mine.filter((e) => e.ts >= dayStart);
  const blocked = today.filter((e) => e.decision === "BLOCK").length;
  const pending = approvals.filter((a) => a.status === "pending" && (admin || a.human.id === me.id || a.approvers.some((p) => p.id === me.id)));
  const discovered = devices.flatMap((d) => d.agents);
  const unknown = discovered.filter((a) => !profileOf(a.agentId)).length;
  const gaps = devices.flatMap((d) => d.agents.map((a) => gapFor(d, a)).filter(Boolean) as string[]);
  const healthy = devices.filter((d) => d.state === "healthy").length;
  const attention = useMemo(() => {
    const out: { tone: "block" | "review"; title: string; body: string; href: string }[] = [];
    for (const d of devices) {
      if (d.state === "heartbeat-lost") out.push({ tone: "review", title: `${d.hostname} stopped reporting`, body: `Last heartbeat ${fmtHeartbeat(d.heartbeat)}. Its cached bundle v${d.policyBundleVersion} keeps enforcing locally; no receipt can be minted for it until it checks in.`, href: `/fleet/${d.id}` });
      if (d.state === "quarantined") out.push({ tone: "block", title: `${d.hostname} is quarantined`, body: "Every action from this device is refused until an admin lifts the quarantine.", href: `/fleet/${d.id}` });
      for (const a of d.agents) {
        // Say only what was observed. Discovery is a filesystem scan: it proves
        // the agent is INSTALLED, never that it ran, reached a model host, or
        // was refused anything. Never describe enforcement we did not perform.
        if (!profileOf(a.agentId)) out.push({ tone: "review", title: `Ungoverned agent on ${d.hostname}`, body: `${a.binary} is installed but not provisioned by Wrapbox. Anything it does is outside policy unless it is launched through a Wrapbox shim — run \`wrapboxd wrap\` on the device to cover it.`, href: `/fleet/${d.id}` });
        if (a.adapter?.state === "tampered") out.push({ tone: "block", title: `Adapter changed on ${d.hostname}`, body: `${a.adapter.path} was edited outside Wrapbox. ${agentById(a.agentId).name} is unmanaged until the Runtime rewrites it.`, href: `/fleet/${d.id}` });
      }
    }
    for (const s of sessions.filter((x) => x.state === "revoked" && Date.now() - (x.revokedAt ?? 0) < 7 * 86_400_000)) out.push({ tone: "review", title: `Session revoked for ${agentById(s.agentId).name} on ${s.deviceId}`, body: `${personById(s.revokedBy ?? "")?.name ?? "An admin"} revoked it ${ago(s.revokedAt ?? 0)} · ${s.reason ?? ""}`, href: "/gateway" });
    return out;
  }, [devices, sessions]);

  const kpis: Kpi[] = admin
    ? [
        { label: "Devices", value: `${healthy} / ${devices.length}`, sub: healthy === devices.length ? "all reporting" : `${devices.length - healthy} not reporting`, tone: healthy < devices.length ? "text-review" : "" },
        { label: "Agents discovered", value: String(discovered.length), sub: unknown ? `${unknown} unknown · ${discovered.length - unknown} provisioned` : "all provisioned", tone: unknown ? "text-review" : "" },
        { label: "Coverage gaps", value: String(gaps.length), sub: gaps.length ? "stated on each device" : "none", tone: gaps.length ? "text-review" : "" },
        { label: "Decisions today", value: today.length.toLocaleString("en-US"), sub: `${blocked} stopped before they ran` },
        { label: "Waiting for a human", value: String(pending.length), sub: pending.length ? `oldest ${ago(Math.min(...pending.map((p) => p.createdAt)))}` : "nothing waiting", tone: "text-review", href: "/approvals" },
      ]
    : [
        { label: "Your devices", value: String(devices.length), sub: devices.every((d) => d.state === "healthy") ? "reporting" : "check the runtime" },
        { label: "Agents covered", value: String(discovered.length), sub: unknown ? `${unknown} unknown` : "all provisioned" },
        { label: "Your actions today", value: today.length.toLocaleString("en-US"), sub: `${blocked} stopped` },
        { label: "Waiting on you", value: String(pending.length), sub: pending.length ? "open Approvals" : "nothing", href: "/approvals" },
      ];

  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      {admin && <FabricHero devices={devices} gateways={gateways} discovered={discovered.length} governed={discovered.length - unknown} version={version} today={today.length} blocked={blocked} />}
      <PageHeader
        eyebrow={admin ? `${company} · Runtime and Gateway` : `${me.name} · ${me.role}`}
        title={admin ? "Fleet" : "My device"}
        sub={
          admin
            ? `${devices.length} enrolled ${devices.length === 1 ? "device" : "devices"} and ${gateways.length} ${gateways.length === 1 ? "gateway" : "gateways"} enforce contract v${version}. Every agent on them was discovered by the Runtime — nothing is installed per agent.`
            : cpBacked
              ? `The Runtime on your laptop discovered these agents — a scan of what is installed, not proof that any of them is governed. Only agents launched through a Wrapbox shim, or running with the governor hooks in place, are evaluated against ${version ? `contract v${version}` : "your contract (nothing published yet)"}; the rest run exactly as they did before.`
              : `The Runtime on your laptop discovered your agents and wrote their adapters. Contract v${version} applies to all of them; you will only notice it when an action touches secrets, main, customer data or production.`
        }
        right={
          admin ? (
            <Button variant="primary" onClick={() => go("/approvals")}>
              Review approvals{pending.length ? <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px] tnum">{pending.length}</span> : null}
            </Button>
          ) : undefined
        }
      />

      <Card className={cn("grid grid-cols-2 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-4", admin ? "md:grid-cols-5" : "md:grid-cols-4")}>
        {kpis.map((k) => (
          <button key={k.label} onClick={() => k.href && go(k.href)} className={cn("text-left px-6 py-5", k.href && "hover:bg-surface-2 transition-colors")}>
            <div className="text-[12px] text-fg-3">{k.label}</div>
            <div className={cn("mt-1 text-[24px] font-semibold tracking-tight tnum", k.tone)}>{k.value}</div>
            <div className="text-[11.5px] text-fg-3 mt-0.5 truncate">{k.sub}</div>
          </button>
        ))}
      </Card>

      {attention.length > 0 && (
        <Card className="overflow-hidden mb-4">
          <CardHead title="Needs attention" sub="From runtime heartbeats, agent discovery and adapter integrity checks" />
          <div className="border-t border-line">
            {attention.map((a, i) => (
              <a key={i} href={"#" + a.href} className="flex items-start gap-3 px-6 py-4 border-b border-line last:border-0 hover:bg-surface-2">
                <span className={cn("grid size-8 place-items-center rounded-lg shrink-0", a.tone === "block" ? "bg-block-soft text-block" : "bg-review-soft text-review")}>
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{a.title}</div>
                  <div className="text-[12px] text-fg-2 leading-relaxed">{a.body}</div>
                </div>
                <ArrowRight className="size-3.5 text-fg-3 mt-2" />
              </a>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-4">
        {devices.map((d) => (
          <DeviceCard key={d.id} d={d} gateways={gateways} destinations={destinations} />
        ))}
        {admin && gateways.map((g) => <GatewayCard key={g.id} g={g} />)}
      </div>

      <Card className="overflow-hidden">
        <CardHead title={admin ? "Live decisions" : "What your agents did"} sub="Every action from every enforcement point, decided by the same contract. Click a row for its evidence." right={<Button size="sm" variant="ghost" onClick={() => go("/evidence")}>Evidence <ArrowRight className="size-3" /></Button>} />
        <div className="border-t border-line">{mine.length ? <DecisionStream events={mine} limit={8} onPick={setOpen} /> : <div className="px-6 py-10 text-[12.5px] text-fg-3">No decisions yet.</div>}</div>
      </Card>
      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** The shape of the product in one card: three enforcement points, every number from state. */
function FabricHero({ devices, gateways, discovered, governed, version, today, blocked }: { devices: FleetDevice[]; gateways: GatewayNode[]; discovered: number; governed: number; version: number; today: number; blocked: number }) {
  const rest = discovered - governed;
  // Governance is not discovery: an agent counts as governed only when it is wrapped or carries a
  // Wrapbox hook. On the live Control Plane every discovered agent is "unknown" (scan only), so
  // governed === 0 and this paragraph says so — the same `unknown`/`governed` count the KPI row uses.
  const cover =
    discovered === 0
      ? "No agents discovered yet — enroll a device and the Runtime will inventory what is installed on it."
      : `${discovered} ${discovered === 1 ? "agent was" : "agents were"} discovered across ${devices.length} ${devices.length === 1 ? "device" : "devices"} by one Runtime per machine.` +
        (governed === 0
          ? ` None are governed yet — nothing was provisioned for them, and their actions are not seen until \`wrapboxd wrap\` covers them.`
          : rest === 0
            ? ` All ${governed} ${governed === 1 ? "is" : "are"} governed — wrapped or carrying a Wrapbox hook, so every tool call is decided before it runs.`
            : ` ${governed} ${governed === 1 ? "is" : "are"} governed — wrapped or carrying a Wrapbox hook, so every tool call is decided before it runs. The other ${rest} ${rest === 1 ? "is" : "are"} inventory only, not seen until \`wrapboxd wrap\` covers ${rest === 1 ? "it" : "them"}.`) +
        ` Today ${today.toLocaleString("en-US")} ${today === 1 ? "action" : "actions"} from governed agents ${today === 1 ? "was" : "were"} decided and ${blocked} refused.`;
  const platforms = useMemo(() => {
    const seen = new Map<string, { logo: string; label: string; n: number }>();
    for (const d of devices) {
      const label = /win/i.test(d.os) ? "Windows" : /mac/i.test(d.os) ? "macOS" : "Linux";
      const cur = seen.get(label);
      seen.set(label, { logo: d.osLogo, label, n: (cur?.n ?? 0) + 1 });
    }
    return [...seen.values()];
  }, [devices]);
  const points = [
    { icon: Laptop, label: "Runtime", where: `${devices.length} ${devices.length === 1 ? "device" : "devices"}`, sub: "installed once per machine" },
    { icon: Network, label: "Gateway", where: `${gateways.length} ${gateways.length === 1 ? "network" : "networks"}`, sub: "installed once per network" },
    { icon: ShieldCheck, label: "Contract", where: `v${version}`, sub: "one policy, both places" },
  ];
  return (
    <section className="hero-prism relative overflow-hidden rounded-3xl px-6 py-6 lg:px-8 lg:py-7 text-white mb-6 shadow-[0_20px_50px_-28px_rgba(120,40,90,0.5)]">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 ring-1 ring-white/35 backdrop-blur-md px-3 py-1 text-[11.5px] font-medium">
            <span className="size-1.5 rounded-full bg-[#1b0f33]" />
            Enforcement Fabric
          </div>
          <h2 className="mt-3 text-[26px] lg:text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] [text-shadow:0_2px_20px_rgba(90,20,40,0.2)]">
            {governed === 0 ? "Installed once per device. Wrap an agent to govern it." : governed === discovered ? "Installed once. Every agent governed." : `${governed} of ${discovered} agents governed.`}
          </h2>
          <p className="mt-2 max-w-[56ch] text-[13.5px] leading-relaxed text-white/90">{cover}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {platforms.map((p) => (
              <span key={p.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 ring-1 ring-white/25 pl-1 pr-2.5 py-1 text-[11.5px] font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-white shadow-sm">
                  <Logo name={p.logo} size={13} rounded="rounded-none" />
                </span>
                {p.label} <span className="text-white/70 tnum">{p.n}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          {points.map((p) => (
            <div key={p.label} className="flex items-center gap-3 rounded-xl bg-white/[0.14] ring-1 ring-white/25 backdrop-blur-md px-3.5 py-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-white/20 shrink-0">
                <p.icon className="size-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{p.label}</div>
                <div className="text-[11px] text-white/75 truncate">{p.sub}</div>
              </div>
              <div className="text-[13px] font-semibold tnum whitespace-nowrap">{p.where}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentRow({ d, a, dense }: { d: FleetDevice; a: DiscoveredAgent; dense?: boolean }) {
  const agent = agentById(a.agentId);
  const gap = gapFor(d, a);
  const l = LAUNCH[a.launchMode];
  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg border border-line", dense ? "px-2.5 py-1.5" : "px-3 py-2.5")}>
      <Logo name={agent.logo} bleed={agent.bleed} size={dense ? 22 : 26} rounded="rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium truncate">
          {agent.name}
          <span className="font-normal text-fg-3">{a.version !== "—" ? a.version : ""}</span>
        </div>
        <div className="text-[11px] text-fg-3 truncate font-mono">{a.adapter ? a.adapter.path : gap ? gap.split(": ")[1] : "runtime launch · no adapter needed"}</div>
      </div>
      <Chip tone={l.tone}>{l.label}</Chip>
    </div>
  );
}

function DeviceCard({ d, gateways, destinations }: { d: FleetDevice; gateways: GatewayNode[]; destinations: Destination[] }) {
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const owner = personById(d.ownerId);
  const cov = deviceCoverage(d, gateways, destinations, cpBacked);
  const gaps = d.agents.map((a) => gapFor(d, a)).filter(Boolean);
  return (
    <Card className={cn("p-5 flex flex-col transition-all hover:shadow-card hover:border-line-strong", d.state === "quarantined" && "border-block/40")}>
      <a href={`#/fleet/${d.id}`} className="flex items-start gap-3">
        <Logo name={d.osLogo} size={36} rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] font-semibold truncate">{d.hostname}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-fg-3">
            {owner && (
              <span className="inline-flex items-center gap-1">
                <Avatar p={owner} size={16} /> {owner.name}
              </span>
            )}
            <span>{d.os} · {d.arch}</span>
          </div>
        </div>
        <Chip tone={STATE_TONE[d.state]}>{STATE_LABEL[d.state]}</Chip>
      </a>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[11.5px]">
        {[
          ["Runtime", `wrapboxd ${d.runtimeVersion}`],
          ["Bundle", `v${d.policyBundleVersion}`],
          ["Heartbeat", fmtHeartbeat(d.heartbeat)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 px-2.5 py-2">
            <dt className="text-fg-3">{k}</dt>
            <dd className={cn("font-medium tnum", k === "Heartbeat" && d.state !== "healthy" && "text-review")}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <a href="#/docs/runtime" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg">
          <BookOpen className="size-3" /> Runtime docs
        </a>
        <span className="text-fg-3">·</span>
        <a href="#/downloads" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg">
          <Download className="size-3" /> Manage
        </a>
      </div>
      <div className="mt-3 space-y-1.5">
        {d.agents.map((a) => (
          <AgentRow key={a.agentId} d={d} a={a} dense />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {cov.map((c) => (
          <Chip key={c} tone={c === "Assured" ? "accent" : "muted"}>
            {c}
          </Chip>
        ))}
        {gaps.length > 0 && <Chip tone="review">{gaps.length} {gaps.length === 1 ? "gap" : "gaps"}</Chip>}
        {d.killSwitch && (
          <Chip tone="block">
            <OctagonX className="size-3" /> kill switch
          </Chip>
        )}
        <a href={`#/fleet/${d.id}`} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent">
          Open <ArrowRight className="size-3" />
        </a>
      </div>
    </Card>
  );
}

function GatewayCard({ g }: { g: GatewayNode }) {
  return (
    <Card className="p-5 flex flex-col hover:shadow-card hover:border-line-strong transition-all">
      <a href="#/gateway" className="flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-xl prism-swatch text-white">
          <Network className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] font-semibold truncate">{g.id}</div>
          <div className="mt-0.5 text-[11.5px] text-fg-3">Gateway · {g.region} · one per network</div>
        </div>
        <Chip tone={g.state === "healthy" ? "allow" : "review"}>{g.state}</Chip>
      </a>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[11.5px]">
        {[
          ["Version", `Gateway ${g.version}`],
          ["Bundle", `v${g.policyBundleVersion}`],
          ["Heartbeat", fmtHeartbeat(g.heartbeat)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 px-2.5 py-2">
            <dt className="text-fg-3">{k}</dt>
            <dd className="font-medium tnum">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <a href="#/docs/gateway" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg">
          <BookOpen className="size-3" /> Gateway docs
        </a>
        <span className="text-fg-3">·</span>
        <a href="#/downloads" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg">
          <Download className="size-3" /> Manage
        </a>
      </div>
      <div className="mt-4 space-y-1.5">
        {g.upstreams.map((id) => {
          const a = agentById(id);
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
              <Logo name={a.logo} bleed={a.bleed} size={22} rounded="rounded-md" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{a.name}</div>
                <div className="text-[11px] text-fg-3 truncate font-mono">virtual MCP · pinned tool schema</div>
              </div>
              <Chip tone="allow">fronted</Chip>
            </div>
          );
        })}
        {g.brokered.map((h) => (
          <div key={h} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
            <span className="grid size-[22px] place-items-center rounded-md bg-surface-2 text-fg-2">
              <KeyRound className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium truncate font-mono">{h}</div>
              <div className="text-[11px] text-fg-3 truncate">credential brokered · agents hold no key</div>
            </div>
            <Chip tone="allow">brokered</Chip>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip>Remote</Chip>
        <Chip tone="accent">Assured</Chip>
        <a href="#/gateway" className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent">
          Open <ArrowRight className="size-3" />
        </a>
      </div>
    </Card>
  );
}

/** One device: its agents, the adapters written for them, and the coverage every action kind is under. */
export function FleetDeviceDetail({ id }: { id: string }) {
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const destinations = useStore((s) => s.destinations);
  const events = useStore((s) => s.events);
  const role = useStore((s) => s.role);
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const [open, setOpen] = useState<Evt | null>(null);
  const d = fleet.find((x) => x.id === id);
  const mine = useMemo(() => events.filter((e) => e.act?.ctx?.["device.id"] === id), [events, id]);
  if (!d || (role === "employee" && d.ownerId !== EMPLOYEE.id)) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-20 text-center">
        <Laptop className="mx-auto size-6 text-fg-3" />
        <h1 className="mt-4 text-[22px] font-semibold">No such device</h1>
        <p className="mt-2 text-[13.5px] text-fg-2">It may have been unenrolled, or it belongs to someone else.</p>
        <Button className="mt-5" onClick={() => go("/")}>Back to Fleet</Button>
      </div>
    );
  }
  const owner = personById(d.ownerId);
  const gaps = d.agents.map((a) => gapFor(d, a)).filter(Boolean) as string[];
  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <a href="#/" className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg mb-5">
        <ArrowLeft className="size-3.5" /> Fleet
      </a>
      <div className="flex flex-wrap items-center gap-5 mb-6">
        <Logo name={d.osLogo} size={60} rounded="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-[24px] font-semibold tracking-tight">{d.hostname}</h1>
            <Chip tone={STATE_TONE[d.state]}>{STATE_LABEL[d.state]}</Chip>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
            {owner && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar p={owner} size={18} /> {owner.name} · {owner.role}
              </span>
            )}
            <span>·</span>
            <span>{d.os} · {d.arch}</span>
            <span>·</span>
            <span>enrolled {ago(d.enrolledAt)}</span>
            <span>·</span>
            <span className="font-mono">{d.keyId.slice(0, 11)}…</span>
          </div>
        </div>
      </div>

      <Card className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-5">
        {[
          ["Runtime", `wrapboxd ${d.runtimeVersion}`, d.state === "healthy" ? "running" : d.state === "heartbeat-lost" ? "not reporting" : d.state],
          // Rule bundles are not signed in this build (bundle signing is on the
          // roadmap) — say only that a copy is cached on the device.
          ["Policy bundle", `v${d.policyBundleVersion}`, "cached on the device"],
          ["Heartbeat", fmtHeartbeat(d.heartbeat), "every 30 s while running"],
          ["Agents", String(d.agents.length), `${d.agents.filter((a) => a.adapter).length} adapters written`],
        ].map(([l, v, s]) => (
          <div key={l} className="px-6 py-5">
            <div className="text-[12px] text-fg-3">{l}</div>
            <div className="mt-1 text-[20px] font-semibold tracking-tight tnum">{v}</div>
            <div className="text-[11.5px] text-fg-3 mt-0.5 truncate">{s}</div>
          </div>
        ))}
      </Card>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-3">
        <a href="#/docs/runtime" className="inline-flex items-center gap-1.5 font-medium text-accent"><BookOpen className="size-3.5" /> Runtime documentation</a>
        <span>·</span>
        <a href="#/downloads" className="inline-flex items-center gap-1.5 font-medium text-accent"><Download className="size-3.5" /> Downloads &amp; MDM profiles</a>
        <span>·</span>
        <a href="#/docs/runtime/troubleshooting" className="hover:text-fg">Troubleshooting</a>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-5 min-w-0">
          <Card className="overflow-hidden">
            <CardHead title="Discovered agents" sub="Found by the Runtime's scan of this device. An adapter is written only for an agent that matches a profile — the rest are listed here but not provisioned." />
            <div className="border-t border-line divide-y divide-line">
              {d.agents.map((a) => {
                const agent = agentById(a.agentId);
                const p = profileOf(a.agentId);
                const l = LAUNCH[a.launchMode];
                return (
                  <div key={a.agentId} className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Logo name={agent.logo} bleed={agent.bleed} size={32} rounded="rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold">
                          {agent.name} <span className="font-normal text-fg-3">{a.version}</span>
                        </div>
                        <div className="text-[11.5px] text-fg-3 font-mono truncate">{a.binary}{p?.signingId ? ` · ${p.signingId}` : ""} · discovered {ago(a.discoveredAt)}</div>
                      </div>
                      <Chip tone={l.tone}>{l.label}</Chip>
                    </div>
                    <p className="mt-2 text-[12px] text-fg-2">{l.plain}</p>
                    {a.adapter ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 border border-line px-3 py-2">
                        <ShieldCheck className={cn("size-3.5", a.adapter.state === "tampered" ? "text-block" : "text-allow")} />
                        <span className="font-mono text-[11.5px] truncate">{a.adapter.path}</span>
                        <span className="text-[11px] text-fg-3">{a.adapter.kind}</span>
                        <Chip tone={a.adapter.state === "tampered" ? "block" : "allow"}>{a.adapter.state}</Chip>
                        <span className="ml-auto text-[11px] text-fg-3">written {ago(a.adapter.writtenAt)} · {a.adapter.sha256.slice(0, 16)}…</span>
                      </div>
                    ) : (
                      <div className="mt-2.5 text-[12px] text-fg-3">{p ? "Launched by the Runtime as a service — no adapter file; governed by the SDK guard and the Gateway." : "No profile matches this process. Nothing was provisioned for it — it is governed only when launched through a Wrapbox shim."}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHead title="Coverage by action kind" sub={cpBacked ? "What each kind of action is actually covered by, per agent. Floor appears only for an agent the Runtime launched under confinement — an agent started outside Wrapbox shows the gap." : "What guarantee each kind of action is under, per agent. A gap is stated, never hidden."} />
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[720px] text-left text-[12px]">
                <thead>
                  <tr className="text-[11.5px] text-fg-3 border-b border-line">
                    <th className="font-medium px-6 py-2.5">Action</th>
                    {d.agents.map((a) => (
                      <th key={a.agentId} className="font-medium px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <Logo name={agentById(a.agentId).logo} bleed={agentById(a.agentId).bleed} size={16} rounded="rounded" /> {agentById(a.agentId).name.split(" ")[0]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {KINDS.map((k) => (
                    <tr key={k.id} className="border-b border-line last:border-0">
                      <td className="px-6 py-2.5">
                        <div className="font-medium">{k.label}</div>
                        <div className="font-mono text-[10.5px] text-fg-3">{k.id}</div>
                      </td>
                      {d.agents.map((a) => {
                        const cov = coverageDisplay(d, a, k.id, gateways, destinations, cpBacked);
                        return (
                          <td key={a.agentId} className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {cov.length ? cov.map((c) => <Chip key={c} tone={c === "Assured" ? "accent" : "muted"}>{c}</Chip>) : <Chip tone="review">Gap</Chip>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 text-[11.5px] text-fg-3 bg-surface-2 grid gap-1 sm:grid-cols-2">
              {(Object.keys(COVERAGE) as (keyof typeof COVERAGE)[]).filter((k) => k !== "observe-only").map((k) => (
                <div key={k}>
                  <span className="font-medium text-fg-2">{COVERAGE[k].cls}</span> · {COVERAGE[k].plain}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-5 min-w-0">
          {gaps.length > 0 && (
            <Card className="p-5">
              <div className="text-[13.5px] font-semibold">Gaps on this device</div>
              <ul className="mt-2 space-y-1.5 text-[12.5px] text-fg-2">
                {gaps.map((g) => (
                  <li key={g} className="flex gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5 text-review shrink-0" /> {g}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHead title="Decisions from this device" sub={cpBacked ? "Signed by this device's Runtime and attributed to the agent process and session — receipts carry no user identity." : "Attributed by the Runtime to the process and the person logged in."} />
            <div className="border-t border-line">{mine.length ? <DecisionStream events={mine} limit={12} compact onPick={setOpen} /> : <div className="px-5 py-8 text-[12.5px] text-fg-3">No decisions yet.</div>}</div>
          </Card>
        </div>
      </div>
      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}
