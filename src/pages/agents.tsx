import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, Play, Plug, Search, Send, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AGENTS,
  ASSURANCE,
  CATEGORIES,
  MECHANISM,
  METHODS,
  PLANNED_MECHANISM,
  PRODUCT_CATS,
  agentById,
  categoryById,
  enforcementOf,
  mechanismOf,
  productOf,
  type Agent,
  type CategoryId,
  type Mechanism,
} from "../data/agents";
import { scenarioFor } from "../data/scenarios";
import { CodeBlock, InlineCmd } from "../components/code";
import { FlowRunner } from "../components/runner";
import { DecisionStream } from "../components/stream";
import { AssuranceBadge, Button, Card, Chip, CopyButton, DecisionPill, Logo, Modal, PageHeader, Segmented, cn } from "../components/ui";
import type { Act } from "../lib/engine";
import { ago, go } from "../lib/router";
import { EMPLOYEE, NONE, adminPerson, connectAgent, disconnectAgent, evaluateNow, getState, setState, toast, useStore, useWorkspace } from "../lib/store";
import { EvidenceDrawer } from "./evidence";
import type { Evt } from "../lib/store";

/* ================= Catalog ================= */

const MECH_ORDER: Mechanism[] = ["hooks", "sdk", "gateway", "runtime", "connector"];

export function AgentsPage({ query }: { query: URLSearchParams }) {
  const role = useStore((s) => s.role);
  const connected = useStore((s) => s.connected);
  const allowed = useStore((s) => s.allowed[EMPLOYEE.id] ?? NONE);
  const requests = useStore((s) => s.requests);
  const domain = useStore((s) => s.domain);
  const device = useStore((s) => s.devices.find((d) => d.ownerId === EMPLOYEE.id));
  const [f, setF] = useState<"all" | "on" | "off">("all");
  const [mech, setMech] = useState<"all" | Mechanism>("all");
  const [q, setQ] = useState("");
  const [req, setReq] = useState<Agent | null>(null);
  const focus = query.get("c") as CategoryId | null;
  const mine = role === "employee";
  const { labs } = useWorkspace();

  const list = (c: CategoryId) =>
    AGENTS.filter(
      (a) =>
        a.category === c &&
        (!q || (a.name + a.vendor + (a.surfaces ?? []).join(" ")).toLowerCase().includes(q.toLowerCase())) &&
        (f === "all" || (f === "on" ? !!connected[a.id] : !connected[a.id])) &&
        (mech === "all" || mechanismOf(a) === mech),
    );
  const ready = AGENTS.filter((a) => enforcementOf(a) === "connectable").length;
  const byMech = useMemo(() => {
    const m: Record<Mechanism, number> = { hooks: 0, sdk: 0, gateway: 0, runtime: 0, connector: 0 };
    AGENTS.forEach((a) => m[mechanismOf(a)]++);
    return m;
  }, []);
  const products = PRODUCT_CATS.filter((p) => p.cats.length && (!focus || p.cats.includes(focus)));

  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={mine ? "Enabled for you by your admin" : `${products.length} product families · ${AGENTS.length} agents · ${ready} connectable today`}
        title={mine ? "My agents" : "Agents"}
        sub={
          mine
            ? "These agents are protected on your laptop. Anything else needs your admin's approval — request it below."
            : "Every card says where the agent runs, how Wrapbox plugs in, and how strong that guarantee is. Connect one and the intent contract follows it."
        }
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 h-8.5 rounded-full border border-line bg-surface px-3.5 w-[240px]">
              <Search className="size-3.5 text-fg-3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter agents or surfaces" className="flex-1 bg-transparent outline-none text-[12.5px] placeholder:text-fg-3" />
            </div>
            {!mine && (
              <Segmented
                size="sm"
                value={f}
                onChange={setF}
                options={[
                  { value: "all", label: "All" },
                  { value: "on", label: "Connected" },
                  { value: "off", label: "Available" },
                ]}
              />
            )}
          </div>
        }
      />

      {mine ? (
        <Card className="p-6 mb-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex-1 min-w-[260px]">
              <div className="text-[14.5px] font-semibold">Protect every agent on this laptop</div>
              <div className="text-[12.5px] text-fg-3 mt-1">
                {allowed.length ? `Installs managed hooks for ${allowed.map((id) => agentById(id).name).join(", ")}, signed in as ${EMPLOYEE.id}@${domain}.` : `Nothing is enabled for you yet — request an agent below and your admin approves it.`}
              </div>
            </div>
            <InlineCmd cmd={`npx @wrapbox/cli install --all --org ${domain.replace(/\..*$/, "")}`} className="w-full md:w-[440px]" />
          </div>
          {allowed.length > 0 && (
            <div className="mt-5 grid sm:grid-cols-3 gap-3">
              {allowed.map((id) => {
                const a = agentById(id);
                return (
                  <a key={id} href={`#/agents/${id}`} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 hover:border-line-strong">
                    <Logo name={a.logo} bleed={a.bleed} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{a.name}</div>
                      <div className={cn("text-[11.5px] flex items-center gap-1", device ? "text-allow" : "text-fg-3")}>
                        <CheckCircle2 className="size-3" /> {device ? `Protected · checked in ${ago(device.seen)}` : "Enabled · install to protect"}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div className="mb-8">
          <div className="eyebrow mb-3 px-1">How Wrapbox connects</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {MECH_ORDER.map((m) => {
              const on = mech === m;
              return (
                <button
                  key={m}
                  onClick={() => setMech(on ? "all" : m)}
                  aria-pressed={on}
                  className={cn("text-left rounded-2xl border p-5 transition-colors", on ? "border-fg bg-surface" : "border-line bg-surface hover:border-line-strong")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold">{MECHANISM[m].label}</span>
                    <span className="font-mono text-[12px] text-fg-3 tnum">{byMech[m]}</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-fg-2">{MECHANISM[m].plain}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-12">
        {products.map((p) => {
          const cats = p.cats.filter((c) => !focus || c === focus);
          const groups = cats.map((c) => ({ cat: categoryById(c), items: list(c) })).filter((g) => g.items.length);
          if (!groups.length) return null;
          const n = groups.reduce((s, g) => s + g.items.length, 0);
          const on = groups.reduce((s, g) => s + g.items.filter((a) => connected[a.id]).length, 0);
          return (
            <section key={p.id}>
              <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-[19px] font-semibold tracking-tight">{p.name}</h2>
                  <p className="mt-1 text-[13px] text-fg-2 max-w-[64ch]">{p.sub}</p>
                </div>
                <span className="text-[12.5px] text-fg-3 tnum">
                  {on} of {n} connected
                </span>
              </div>
              <div className="space-y-8">
                {groups.map(({ cat, items }) => (
                  <div key={cat.id}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-4">
                      {groups.length > 1 ? <h3 className="text-[14px] font-semibold">{cat.name.split(" · ")[1]?.replace(/^\w/, (s) => s.toUpperCase()) ?? cat.name}</h3> : null}
                      <Chip tone={cat.timing === "NOW" ? "allow" : cat.timing === "NEXT" ? "accent" : "muted"}>{cat.timing}</Chip>
                      <span className="text-[12.5px] text-fg-3">{cat.method}</span>
                      {labs && (
                        <a href={`#/flows/${cat.scenario}`} className="ml-auto text-[12.5px] font-medium text-accent inline-flex items-center gap-1">
                          Happy flow <ArrowRight className="size-3" />
                        </a>
                      )}
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((a) => (
                        <AgentCard key={a.id} a={a} mine={mine} allowed={allowed} requested={!!requests.find((r) => r.agentId === a.id && r.person.id === EMPLOYEE.id)} onRequest={() => setReq(a)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <RequestModal agent={req} onClose={() => setReq(null)} />
    </div>
  );
}

function AgentCard({ a, mine, allowed, requested, onRequest }: { a: Agent; mine: boolean; allowed: string[]; requested: boolean; onRequest: () => void }) {
  const on = useStore((s) => s.connected[a.id]);
  const roadmap = enforcementOf(a) === "roadmap";
  const isAllowed = !mine || allowed.includes(a.id);
  const m = mechanismOf(a);
  return (
    <div className={cn("group flex flex-col rounded-2xl border bg-surface p-5 transition-all", on ? "border-line hover:border-line-strong hover:shadow-card" : roadmap ? "border-line" : "border-dashed border-line-strong")}>
      <div className="flex items-start gap-3.5">
        <Logo name={a.logo} bleed={a.bleed} size={44} rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold leading-tight truncate">{a.name}</div>
          <div className="text-[12px] text-fg-3 mt-0.5">{a.vendor}</div>
        </div>
        {on ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-allow-soft px-2.5 py-1 text-[11px] font-medium text-allow">
            <span className="size-1.5 rounded-full bg-allow" /> Connected
          </span>
        ) : roadmap ? (
          <span className="rounded-full bg-surface-2 border border-line px-2.5 py-1 text-[11px] text-fg-2">On roadmap</span>
        ) : (
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-3">Available</span>
        )}
      </div>

      <dl className="mt-5 space-y-2 text-[12px]">
        <div className="flex gap-3">
          <dt className="w-[64px] shrink-0 text-fg-3">Runs in</dt>
          <dd className="min-w-0 text-fg-2 truncate" title={(a.surfaces ?? []).join(" · ")}>
            {(a.surfaces ?? [a.surface]).join(" · ")}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[64px] shrink-0 text-fg-3">Plugs in</dt>
          <dd className="min-w-0 text-fg-2 truncate">{roadmap ? PLANNED_MECHANISM[a.adapter] : MECHANISM[m].label}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[64px] shrink-0 text-fg-3">Config</dt>
          <dd className="min-w-0 font-mono text-[11.5px] text-fg-2 truncate" title={a.file}>
            {a.file}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.hookEvents.slice(0, 3).map((h) => (
          <span key={h} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-fg-3">
            {h}
          </span>
        ))}
      </div>

      <div className="mt-auto pt-5 flex items-center justify-between gap-3">
        {on ? <AssuranceBadge a={on.assurance} /> : roadmap ? <span className="text-[11.5px] text-fg-3">Inventory &amp; evidence only</span> : <span className="text-[11.5px] text-fg-3">{METHODS[a.category].find((x) => x.recommended)?.name}</span>}
        {isAllowed ? (
          <Button size="sm" variant={on ? "secondary" : roadmap ? "ghost" : "primary"} onClick={() => go(`/agents/${a.id}`)}>
            {on ? "Manage" : roadmap ? "Details" : "Connect"}
          </Button>
        ) : requested ? (
          <Chip tone="review">Requested</Chip>
        ) : (
          <Button size="sm" onClick={onRequest}>
            <Lock className="size-3" /> Request
          </Button>
        )}
      </div>
    </div>
  );
}

function RequestModal({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={!!agent} onClose={onClose}>
      {agent && (
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Logo name={agent.logo} bleed={agent.bleed} size={36} />
            <div>
              <div className="text-[15px] font-semibold">Request access to {agent.name}</div>
              <div className="text-[12.5px] text-fg-3">Your admin will see this in Team &amp; devices.</div>
            </div>
          </div>
          <label className="block mt-5">
            <span className="text-[12px] font-medium">What will you use it for?</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Generating integration tests for the claims service"
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>
          <p className="mt-2 text-[12px] text-fg-3">Once approved, the same contract applies to it automatically — no new rules to learn.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setState((s) => ({
                  requests: [{ id: "rq-" + Date.now(), kind: "agent" as const, person: EMPLOYEE, agentId: agent.id, reason: reason || "Requested from My agents", status: "pending", at: Date.now() }, ...s.requests],
                }));
                toast("Request sent", `${agent.name} · waiting for ${adminPerson().name}`, "review");
                setReason("");
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

/* ================= Detail ================= */

export function AgentDetail({ id, query }: { id: string; query: URLSearchParams }) {
  const agent = AGENTS.find((a) => a.id === id);
  const conn = useStore((s) => (agent ? s.connected[agent.id] : undefined));
  const role = useStore((s) => s.role);
  const allowed = useStore((s) => s.allowed[EMPLOYEE.id] ?? NONE);
  const { labs } = useWorkspace();
  const [tab, setTab] = useState<"connect" | "flow" | "activity">((query.get("tab") as "flow") ?? "connect");
  if (!agent) return <div className="p-10">Unknown agent.</div>;
  const cat = categoryById(agent.category);
  const product = productOf(agent.category);
  const roadmap = enforcementOf(agent) === "roadmap";
  const locked = role === "employee" && !allowed.includes(agent.id);

  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <a href="#/agents" className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg mb-5">
        <ArrowLeft className="size-3.5" /> All agents
      </a>
      <div className="flex flex-wrap items-center gap-5 mb-6">
        <Logo name={agent.logo} bleed={agent.bleed} size={60} rounded="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-semibold tracking-tight">{agent.name}</h1>
            {conn ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-allow-soft px-2.5 py-1 text-[11.5px] font-medium text-allow">
                <span className="size-1.5 rounded-full bg-allow live-dot" /> Connected {ago(conn.at)}
              </span>
            ) : roadmap ? (
              <span className="rounded-full bg-surface-2 border border-line px-2.5 py-1 text-[11.5px] text-fg-2">Enforcement on roadmap</span>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-fg-3">Not connected</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
            <span>{agent.vendor}</span>
            <span>·</span>
            <a href={`#/agents?c=${cat.id}`} className="hover:text-fg">
              {product.name}
              {cat.name.includes(" · ") ? ` · ${cat.name.split(" · ")[1]}` : ""}
            </a>
            <span>·</span>
            <span>{MECHANISM[mechanismOf(agent)].label}</span>
            {conn && (
              <>
                <span>·</span>
                <span>owner {agent.owner}</span>
                <span>·</span>
                <span>{agent.env}</span>
                <AssuranceBadge a={conn.assurance} />
              </>
            )}
          </div>
          {agent.surfaces && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {agent.surfaces.map((s) => (
                <span key={s} className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11.5px] text-fg-2">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {conn && role === "admin" && (
            <Button
              variant="ghost"
              onClick={() => {
                disconnectAgent(agent.id);
                toast(`${agent.name} disconnected`, "Its hook now fails closed until reconnected.", "block");
              }}
            >
              <Unplug className="size-3.5" /> Disconnect
            </Button>
          )}
          {labs ? (
            <Button variant="primary" onClick={() => setTab("flow")}>
              <Play className="size-3.5 fill-current" /> Run happy flow
            </Button>
          ) : (
            conn && (
              <Button variant="primary" onClick={() => setTab("activity")}>
                Activity <ArrowRight className="size-3.5" />
              </Button>
            )
          )}
        </div>
      </div>

      <div className="mb-6 border-b border-line flex gap-6">
        {(
          [
            ["connect", conn ? "Connection" : roadmap ? "Plan" : "Connect"],
            ["flow", "Happy flow"],
            ["activity", "Activity"],
          ] as const
        )
          .filter(([k]) => labs || k !== "flow")
          .map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("relative pb-3 text-[13.5px] font-medium transition-colors", tab === k ? "text-fg" : "text-fg-3 hover:text-fg-2")}>
            {l}
            {tab === k && <motion.span layoutId="agent-tab" className="absolute left-0 right-0 -bottom-px h-0.5 bg-fg rounded-full" />}
          </button>
        ))}
      </div>

      {tab === "connect" &&
        (locked ? (
          <Card className="p-10 text-center">
            <Lock className="mx-auto size-6 text-fg-3" />
            <div className="mt-3 font-semibold">Not enabled for you</div>
            <p className="mt-1 text-[13px] text-fg-3">Request access from My agents. Your admin connects it once for the org.</p>
          </Card>
        ) : roadmap ? (
          <RoadmapPlan agent={agent} />
        ) : (
          <ConnectWizard agent={agent} onRun={() => setTab(labs ? "flow" : "activity")} runLabel={labs ? "Run the happy flow" : "See its activity"} />
        ))}
      {tab === "flow" && labs && <FlowRunner key={agent.id} scenario={scenarioFor(agent)} agent={agent} />}
      {tab === "activity" && <AgentActivity agent={agent} />}
    </div>
  );
}

/** Honest page for platforms without a verified enforcement mechanism yet: what exists today, what is planned. */
function RoadmapPlan({ agent }: { agent: Agent }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5 min-w-0">
        <Card className="p-6">
          <div className="text-[14.5px] font-semibold">What Wrapbox can do with {agent.name} today</div>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2 max-w-[70ch]">{agent.fileNote}</p>
          <div className="mt-5">
            <div className="text-[12px] font-medium text-fg-2 mb-2">Inventory &amp; evidence registration</div>
            <InlineCmd cmd={agent.install} />
          </div>
          <div className="mt-4">
            <CodeBlock file={agent.file} lang={agent.lang} code={agent.snippet} numbers />
          </div>
        </Card>
        <Card className="p-6">
          <div className="text-[14.5px] font-semibold">Planned enforcement</div>
          <p className="mt-2 text-[13px] text-fg-2">{PLANNED_MECHANISM[agent.adapter]}</p>
          <ol className="mt-4 space-y-2.5 text-[12.5px] text-fg-2">
            {[
              "Inventory: the agent is listed, owned and scoped like every other agent.",
              "Evidence: decisions the platform makes are mirrored into Wrapbox, SIEM and GRC.",
              "Enforcement: consequential actions are authorized by Wrapbox before the platform executes them.",
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className={cn("grid size-5 place-items-center rounded-full text-[10.5px] font-semibold shrink-0", i < 2 ? "bg-allow-soft text-allow" : "bg-surface-3 text-fg-3")}>{i < 2 ? <Check className="size-3" /> : 3}</span>
                {t}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card className="p-6 h-fit">
        <div className="text-[13.5px] font-semibold">Where it runs</div>
        <ul className="mt-3 space-y-1.5 text-[12.5px] text-fg-2">
          {(agent.surfaces ?? [agent.surface]).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <div className="mt-5 text-[13.5px] font-semibold">Vendor docs</div>
        <div className="mt-1.5 font-mono text-[12px] text-fg-2 break-all">{agent.docs}</div>
      </Card>
    </div>
  );
}

function AgentActivity({ agent }: { agent: Agent }) {
  const events = useStore((s) => s.events);
  const { labs } = useWorkspace();
  const [open, setOpen] = useState<Evt | null>(null);
  const mine = useMemo(() => events.filter((e) => e.agentId === agent.id), [events, agent.id]);
  const c = { ALLOW: 0, CONSTRAIN: 0, REVIEW: 0, BLOCK: 0 };
  mine.forEach((e) => c[e.decision]++);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <Card className="overflow-hidden">
        {mine.length ? <DecisionStream events={mine} limit={30} onPick={setOpen} /> : <div className="p-12 text-center text-[13px] text-fg-3">{labs ? "No decisions yet. Run the happy flow or send an action from the playground." : "No decisions yet — they appear here the moment this agent acts."}</div>}
      </Card>
      <Card className="p-6 h-fit space-y-3">
        <div className="text-[13.5px] font-semibold">In this workspace</div>
        {(["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"] as const).map((d) => (
          <div key={d} className="flex items-center justify-between">
            <DecisionPill d={d} size="sm" />
            <span className="font-mono tnum">{c[d]}</span>
          </div>
        ))}
      </Card>
      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ================= Connect wizard ================= */

/* Test events per surface. The DECISION is never typed in here — each act goes through
   evaluateNow(), the same evaluator the playground, the stream and the flows use. */
const PROBES: Record<CategoryId, { display: string; act: Act }[]> = {
  ide: [
    { display: "Read README.md", act: { effect: "filesystem.read", path: "/repo/README.md", env: "development" } },
    { display: "Read .env.production", act: { effect: "filesystem.read", path: "/repo/.env.production", env: "development" } },
    { display: "git push --force origin feat/ledger", act: { effect: "git.push", branch: "feat/ledger", command: "git push --force origin feat/ledger", env: "development" } },
  ],
  cli: [
    { display: "Bash(git status)", act: { effect: "shell.exec", command: "git status", env: "development" } },
    { display: "Read(.env.production)", act: { effect: "filesystem.read", path: "/repo/.env.production", env: "development" } },
    { display: "Bash(kubectl delete deployment payments-api -n prod)", act: { effect: "shell.exec", command: "kubectl delete deployment payments-api -n prod", env: "production" } },
  ],
  cloud: [
    { display: "git push origin copilot/test-branch", act: { effect: "git.push", branch: "copilot/test-branch", command: "git push origin copilot/test-branch", env: "staging" } },
    { display: "git push origin main", act: { effect: "git.push", branch: "main", command: "git push origin main", env: "staging" } },
    { display: "postgres-prod · apply_migration", act: { effect: "database.migrate", env: "production" } },
  ],
  custom: [
    { display: "pay_claim(amount=5000)", act: { effect: "claims.payout", amount: 5000, env: "production" } },
    { display: "pay_claim(amount=300000)", act: { effect: "claims.payout", amount: 300000, env: "production" } },
  ],
  mcp: [
    { display: "tools/list", act: { effect: "tools.list", env: "production" } },
    { display: "create_refund(amount=300)", act: { effect: "payments.refund", amount: 300, env: "production" } },
    { display: "create_refund(amount=8000)", act: { effect: "payments.refund", amount: 8000, env: "production" } },
  ],
  saas: [
    { display: "Apply Discount 5%", act: { effect: "crm.apply_discount", amount: 5, env: "production" } },
    { display: "Apply Discount 40%", act: { effect: "crm.apply_discount", amount: 40, env: "production" } },
  ],
  browser: [
    { display: "navigate vendor.example", act: { effect: "browser.navigate", env: "production" } },
    { display: "payment.submit $50,000", act: { effect: "payment.submit", amount: 50000, env: "production" } },
  ],
  a2a: [
    { display: "delegate(budget=$10,000)", act: { effect: "agent.delegate", budget: 10000, env: "production" } },
    { display: "place_order($100,000)", act: { effect: "purchase.order", amount: 100000, env: "production" } },
  ],
};

function ConnectWizard({ agent, onRun, runLabel }: { agent: Agent; onRun: () => void; runLabel: string }) {
  const conn = useStore((s) => s.connected[agent.id]);
  // v2 is the live Control-Plane-backed workspace: no per-agent token is issued from the browser and
  // rule conditions are evaluated on the device, not here. The simulated workspaces script both flows.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const version = useStore((s) => s.version);
  const published = useStore((s) => s.published.length);
  const domain = useStore((s) => s.domain);
  const methods = METHODS[agent.category];
  const [method, setMethod] = useState(conn?.method ?? (methods.find((m) => m.recommended) ?? methods[0]).id);
  const [reveal, setReveal] = useState(false);
  const [log, setLog] = useState<{ t: string; d?: "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK"; ms?: number; ok?: boolean }[]>([]);
  const [verifying, setVerifying] = useState(false);
  const m = methods.find((x) => x.id === method) ?? methods.find((x) => x.recommended) ?? methods[0];
  const org = domain.replace(/\..*$/, "");
  const token = `wbx_agt_${agent.id.replace(/-/g, "")}_7Hq29fKc3xT1c9f2`;
  const masked = token.slice(0, 13) + "•".repeat(14) + token.slice(-4);

  async function verify() {
    setVerifying(true);
    setLog([]);
    const push = (l: (typeof log)[number]) => setLog((x) => [...x, l]);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(350);
    push({ t: `→ wrapbox ping · ${agent.hookEvents[0]} adapter` });
    await wait(500);
    push({ t: `✓ token valid · org ${org} · agent ${agent.id}`, ok: true });
    for (const { display, act } of PROBES[agent.category]) {
      await wait(520);
      push({ t: `→ ${agent.hookEvents[0]} · ${display}` });
      await wait(420);
      const t0 = performance.now();
      const v = evaluateNow(act, agent.id);
      const ms = Math.max(1, Math.round(performance.now() - t0));
      push({ t: `← ${v.decision} · rule ${v.rule}${v.observed ? ` · observe mode (would ${v.observed})` : ""}`, d: v.decision, ms });
    }
    await wait(500);
    push({ t: `✓ Connected · ${ASSURANCE[m.assurance].label.toLowerCase()} · decisions answered in ${agent.name}'s own format`, ok: true });
    connectAgent(agent.id, method, m.assurance);
    toast(`${agent.name} connected`, `Contract v${getState().version} now applies · ${ASSURANCE[m.assurance].label}`, "allow");
    setVerifying(false);
  }

  const done = !!conn && !verifying;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5 min-w-0">
        {/* Step 1 */}
        <WizardStep n={1} title="Choose how Wrapbox enforces" done>
          <div className="grid gap-3 md:grid-cols-3">
            {methods.map((x) => (
              <button
                key={x.id}
                onClick={() => setMethod(x.id)}
                className={cn("text-left rounded-xl border p-4 transition-all", method === x.id ? "border-fg ring-1 ring-fg" : "border-line hover:border-line-strong")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{x.name}</span>
                  {x.recommended && <Chip tone="accent">Recommended</Chip>}
                </div>
                <p className="mt-1.5 text-[12px] text-fg-2 leading-relaxed">{x.desc}</p>
                <AssuranceBadge a={x.assurance} className="mt-3" />
              </button>
            ))}
          </div>
        </WizardStep>

        {/* Step 2 */}
        <WizardStep n={2} title={`Install into ${agent.name}`} done>
          <div className="space-y-4">
            <div>
              <div className="text-[12px] font-medium text-fg-2 mb-2">Option A — one command</div>
              <InlineCmd cmd={agent.install} />
            </div>
            <div>
              <div className="text-[12px] font-medium text-fg-2 mb-2">Option B — copy the config into the agent's own file</div>
              <CodeBlock file={agent.file} note={agent.fileNote} lang={agent.lang} code={agent.snippet} numbers />
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-medium">
                <KeyRound className="size-3.5 text-accent" /> {agent.category === "cloud" && agent.adapter === "cloud" ? "COPILOT_MCP_WRAPBOX_TOKEN" : "WRAPBOX_TOKEN"}
                <span className="ml-auto text-[11.5px] text-fg-3 font-normal">{cpBacked ? "read from the device's Wrapbox runtime — not issued from this screen" : `scoped to ${agent.id} · rotates every 30 days`}</span>
              </div>
              {cpBacked ? (
                // Live CP path: the Control Plane never returns an agent token to the browser, so we show
                // the env-var the agent reads at runtime — no reveal, no copy, no invented rotation interval.
                <>
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-surface-2 border border-line px-3 h-9">
                    <code className="flex-1 font-mono text-[12px] truncate">$WRAPBOX_TOKEN</code>
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-fg-3">
                    The Control Plane issues a device credential during <span className="font-mono">wrapbox enroll</span>, from a single-use enrollment token; it is stored hashed and never displayed. The agent reads it from the environment. Wrapbox listens on: <span className="font-mono">{agent.hookEvents.join(" · ")}</span> · docs <span className="font-mono">{agent.docs}</span>
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-surface-2 border border-line px-3 h-9">
                    <code className="flex-1 font-mono text-[12px] truncate">{reveal ? token : masked}</code>
                    <button onClick={() => setReveal(!reveal)} className="text-fg-3 hover:text-fg" aria-label="Reveal token">
                      {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <CopyButton text={token} />
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-fg-3">
                    Agent token for this workspace. Wrapbox listens on: <span className="font-mono">{agent.hookEvents.join(" · ")}</span> · docs <span className="font-mono">{agent.docs}</span>
                  </p>
                </>
              )}
            </div>
          </div>
        </WizardStep>

        {/* Step 3 */}
        <WizardStep n={3} title="Verify the connection" done={done}>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <Button variant={done ? "secondary" : "accent"} onClick={verify} disabled={verifying}>
              {verifying ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
              {verifying ? "Talking to the agent…" : done ? "Re-run verification" : "Send test events"}
            </Button>
            <span className="text-[12px] text-fg-3">
              {cpBacked
                ? `Evaluates sample actions locally, in this browser, against the rules loaded from contract v${version}. It does not contact the agent or the device — and in this release Control Plane rule conditions are not evaluated here, so these results will not match what the runtime enforces. See Evidence for real decisions.`
                : `Wrapbox fires test actions through the adapter and evaluates each one against contract v${version}.`}
            </span>
          </div>
          <div className="rounded-xl bg-code border border-code-line p-4 font-mono text-[12px] leading-[1.8] min-h-[120px]">
            {!log.length && <div className="text-[#5f6a88]">{conn ? `Last verified ${ago(conn.at)} · ${ASSURANCE[conn.assurance].label}` : "Waiting for the first test event…"}</div>}
            <AnimatePresence>
              {log.map((l, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cn("flex items-center gap-2", l.ok ? "text-[#3fd49b]" : l.d === "BLOCK" ? "text-[#ff6e8a]" : l.d === "REVIEW" ? "text-[#f4b453]" : l.d === "CONSTRAIN" ? "text-[#a78bff]" : l.d ? "text-[#3fd49b]" : "text-[#a2acc5]")}>
                  <span className="truncate">{l.t}</span>
                  {l.ms && <span className="ml-auto text-[#5f6a88] shrink-0">{l.ms} ms</span>}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </WizardStep>
      </div>

      {/* Summary rail */}
      <div className="space-y-5">
        <Card className={cn("p-6", done && "border-allow/40")}>
          <div className="flex items-center gap-2">
            {done ? <CheckCircle2 className="size-5 text-allow" /> : <span className="size-5 rounded-full border-2 border-dashed border-line-strong" />}
            <span className="text-[14px] font-semibold">{done ? "Connected" : "Not connected yet"}</span>
          </div>
          <dl className="mt-5 space-y-2.5 text-[12.5px]">
            {[
              ["Method", m.name],
              ["Assurance", ASSURANCE[m.assurance].label],
              ["Contract", published ? `v${version} · ${published} ${published === 1 ? "rule" : "rules"}` : "no rules published yet"],
              ["Fail mode", agent.adapter === "cursor" ? "failClosed: true" : agent.adapter === "claude" ? "managed · deny on timeout" : "closed"],
              ["Identity", `${agent.id}@${org}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-fg-3">{k}</dt>
                <dd className="font-medium text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <Button className="mt-5 w-full" variant={done ? "primary" : "secondary"} onClick={onRun} disabled={!done}>
            <Play className="size-3.5 fill-current" /> {runLabel}
          </Button>
        </Card>
        <Card className="p-6">
          <div className="text-[13px] font-semibold">What happens after connecting</div>
          <ol className="mt-4 space-y-3 text-[12.5px] text-fg-2">
            {[
              `${agent.name} calls Wrapbox before every ${agent.hookEvents[0]}.`,
              "Wrapbox normalizes it and matches wrapbox.yaml.",
              "The agent gets ALLOW / REVIEW / BLOCK in its own format.",
              "Approved actions carry a 60-second permit the executor verifies.",
              "Every decision appears in Evidence and the live stream.",
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold shrink-0">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function WizardStep({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <span className={cn("grid size-6 place-items-center rounded-full text-[12px] font-semibold", done ? "bg-ink text-ink-fg" : "border border-line-strong text-fg-3")}>{done && n === 3 ? <Check className="size-3.5" /> : n}</span>
        <span className="text-[14.5px] font-semibold">{title}</span>
      </div>
      {children}
    </Card>
  );
}
