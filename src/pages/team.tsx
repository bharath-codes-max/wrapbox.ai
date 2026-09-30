import { AlertTriangle, Check, KeyRound, Laptop, Lock, RefreshCcw, ShieldAlert, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AGENTS, agentById } from "../data/agents";
import { personById, type Person } from "../data/people";
import { DecisionStream } from "../components/stream";
import { Avatar, Button, Card, CardHead, Chip, Drawer, Logo, PageHeader, Segmented, cn } from "../components/ui";
import { ago, go } from "../lib/router";
import { adminPerson, deriveAlerts, pushEvent, resolveAlert, setState, syncDirectory, toast, useStore, useWorkspace, type Device } from "../lib/store";
import { orgSlug } from "../data/contract";

function deviceHealth(d: Device) {
  if (d.agents.some((a) => a.state === "shadow")) return "shadow";
  if (d.agents.some((a) => a.state === "degraded")) return "degraded";
  return "healthy";
}

export function Team() {
  const requests = useStore((s) => s.requests);
  const connected = useStore((s) => s.connected);
  const events = useStore((s) => s.events);
  const members = useStore((s) => s.members);
  const devices = useStore((s) => s.devices);
  const alerts = useMemo(() => deriveAlerts(devices), [devices]);
  const groups = useStore((s) => s.groups);
  const allowed = useStore((s) => s.allowed);
  const ws = useWorkspace();
  const domain = useStore((s) => s.domain);
  const [tab, setTab] = useState<"members" | "devices" | "groups" | "identities">("members");
  const [open, setOpen] = useState<Person | null>(null);
  const pending = requests.filter((r) => r.status === "pending");
  const stats = useMemo(() => {
    const m: Record<string, { n: number; b: number }> = {};
    for (const e of events) {
      m[e.human] ??= { n: 0, b: 0 };
      m[e.human].n++;
      if (e.decision === "BLOCK") m[e.human].b++;
    }
    return m;
  }, [events]);
  const healthy = devices.filter((d) => deviceHealth(d) === "healthy").length;
  const shadow = devices.flatMap((d) => d.agents).filter((a) => a.state === "shadow").length;

  const decide = (id: string, ok: boolean) => {
    const r = requests.find((x) => x.id === id)!;
    setState((s) => ({
      requests: s.requests.map((x) => (x.id === id ? { ...x, status: ok ? "approved" : "denied" } : x)),
      allowed: ok && r.kind === "agent" ? { ...s.allowed, [r.person.id]: [...(s.allowed[r.person.id] ?? []), r.agentId] } : s.allowed,
    }));
    if (ok && r.kind === "exception") pushEvent({ agentId: r.agentId, human: r.person.id, action: r.action ?? "", effect: "exception.grant", decision: "ALLOW", rule: "exception", reason: "time-boxed exception · 30 min · single command", latency: 2, source: "flow" });
    toast(
      ok ? (r.kind === "exception" ? "Exception granted for 30 minutes" : "Access granted") : "Request denied",
      r.kind === "exception" ? `${r.person.name} · permit scoped to “${r.action}” only` : `${r.person.name} · ${agentById(r.agentId).name} now follows the contract`,
      ok ? "allow" : "block",
    );
  };

  const kpis = [
    { l: "Members", v: members.length, s: `${members.filter((m) => m.status === "active").length} active · ${members.filter((m) => m.status === "invited").length} invited` },
    { l: "Laptops", v: devices.length, s: devices.length ? "reporting to Wrapbox" : "none installed yet" },
    { l: "Protected", v: `${healthy}/${devices.length}`, s: "hooks healthy + runtime", tone: devices.length && healthy < devices.length ? "text-review" : "" },
    { l: "Shadow agents", v: shadow, s: "found, not governed", tone: shadow ? "text-block" : "" },
    { l: "Open requests", v: pending.length, s: "access + exceptions", tone: pending.length ? "text-review" : "" },
  ];

  const onlyOwner = members.length <= 1;

  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="People, laptops and approvers"
        title="Team & devices"
        sub="See who uses which agent, whether every laptop is actually protected, and what people are asking for. Least privilege for humans and agents in one place."
        right={
          <>
            <Button
              onClick={() => {
                syncDirectory();
                toast("Directory synced from Okta", "People arrive as invited; they turn active when they install Wrapbox", "allow");
              }}
            >
              <RefreshCcw className="size-3.5" /> Sync Okta
            </Button>
            <Button variant="primary" onClick={() => toast("Invite link copied", "app.wrapbox.ai/join/7Hq2-dK4v · expires in 7 days")}>
              <UserPlus className="size-3.5" /> Invite
            </Button>
          </>
        }
      />

      <Card className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-4">
        {kpis.map((k) => (
          <div key={k.l} className="px-6 py-5">
            <div className="text-[12px] text-fg-3">{k.l}</div>
            <div className={cn("mt-1 text-[22px] font-semibold tnum", k.tone)}>{k.v}</div>
            <div className="text-[11.5px] text-fg-3">{k.s}</div>
          </div>
        ))}
      </Card>

      {onlyOwner && (
        <Card className="mb-4 p-6 flex flex-wrap items-center gap-4">
          <span className="grid size-10 place-items-center rounded-xl bg-surface-2">
            <Users className="size-5 text-fg-2" />
          </span>
          <div className="flex-1 min-w-[260px]">
            <div className="text-[14px] font-semibold">It's just you so far</div>
            <div className="text-[12.5px] text-fg-2">Sync your directory to bring in the team. They show up as invited, and turn active — with their laptop — when they run the installer.</div>
          </div>
          <Button variant="primary" onClick={() => syncDirectory()}>
            <RefreshCcw className="size-3.5" /> Sync Okta
          </Button>
          <Button onClick={() => go("/onboarding/employee")}>Walk through the employee side</Button>
        </Card>
      )}

      {(alerts.length > 0 || pending.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-2 mb-4">
          <Card className="overflow-hidden">
            <CardHead title="Needs attention" sub="Signals from the endpoint runtime and hook heartbeats" />
            <div className="border-t border-line">
              {alerts.map((a) => {
                const Icon = a.kind === "hook" ? ShieldAlert : a.kind === "shadow" ? AlertTriangle : KeyRound;
                return (
                  <div key={a.id} className="flex items-start gap-3 px-6 py-4 border-b border-line last:border-0">
                    <span className={cn("grid size-8 place-items-center rounded-lg shrink-0", a.tone === "block" ? "bg-block-soft text-block" : "bg-review-soft text-review")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold">{a.title}</div>
                      <div className="text-[12px] text-fg-2 leading-relaxed">{a.body}</div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        resolveAlert(a.id);
                        toast(a.action, a.kind === "shadow" ? `${a.agentName} blocked on ${a.deviceId}` : a.kind === "key" ? `${a.agentName} on ${a.deviceId} · new token valid 30 days` : `${a.agentName} on ${a.deviceId} is protected again`, "allow");
                      }}
                    >
                      {a.action}
                    </Button>
                  </div>
                );
              })}
              {!alerts.length && <div className="px-6 py-8 text-[12.5px] text-fg-3">All clear.</div>}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHead title={`Requests · ${pending.length}`} sub="New agents, and time-boxed exceptions to a rule" />
            <div className="border-t border-line">
              {pending.map((r) => {
                const a = agentById(r.agentId);
                return (
                  <div key={r.id} className="flex flex-wrap items-start gap-3 px-6 py-4 border-b border-line last:border-0">
                    <Avatar p={r.person} size={30} />
                    <div className="min-w-[220px] flex-1">
                      <div className="text-[13px]">
                        <b>{r.person.name}</b> {r.kind === "exception" ? "asks for an exception on" : "wants"}{" "}
                        <span className="inline-flex items-center gap-1 align-middle">
                          <Logo name={a.logo} bleed={a.bleed} size={16} rounded="rounded" /> <b>{a.name}</b>
                        </span>
                      </div>
                      {r.kind === "exception" && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-surface-2 border border-line px-1.5 py-px font-mono text-[11px]">{r.action}</span>
                          <span className="font-mono text-[11px] text-fg-3">rule {r.rule}</span>
                        </div>
                      )}
                      <div className="mt-1 text-[12px] text-fg-3">
                        “{r.reason}” · {ago(r.at)}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => decide(r.id, false)}>
                        <X className="size-3.5" /> Deny
                      </Button>
                      <Button size="sm" variant="allow" onClick={() => decide(r.id, true)}>
                        <Check className="size-3.5" /> {r.kind === "exception" ? "Grant 30 min" : "Approve"}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {!pending.length && <div className="px-6 py-8 text-[12.5px] text-fg-3">No open requests.</div>}
            </div>
          </Card>
        </div>
      )}

      <div className="mb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "members", label: `Members · ${members.length}` },
            { value: "devices", label: `Laptops · ${devices.length}` },
            { value: "groups", label: "Approver groups" },
            { value: "identities", label: "Agent identities" },
          ]}
        />
      </div>

      {tab === "members" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="text-[11.5px] text-fg-3 border-b border-line">
                  <th className="font-medium px-6 py-3.5">Person</th>
                  <th className="font-medium px-3 py-3.5">Roles</th>
                  <th className="font-medium px-3 py-3.5">Agents</th>
                  <th className="font-medium px-3 py-3.5 text-right">Actions</th>
                  <th className="font-medium px-3 py-3.5 text-right">Blocked</th>
                  <th className="font-medium px-6 py-3.5">Laptops</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const p = personById(m.id);
                  if (!p) return null;
                  const agents = m.roles.includes("Admin") ? ["*"] : allowed[m.id] ?? [];
                  const st = stats[m.id] ?? { n: 0, b: 0 };
                  const devs = devices.filter((d) => d.ownerId === m.id);
                  return (
                    <tr key={m.id} onClick={() => setOpen(p)} className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar p={p} size={28} className={m.status === "invited" ? "opacity-60" : ""} />
                          <div>
                            <div className="text-[13px] font-medium flex items-center gap-1.5">
                              {p.name}
                              {m.status === "invited" && <Chip>invited</Chip>}
                            </div>
                            <div className="text-[11.5px] text-fg-3">
                              {p.id}@{domain}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {m.roles.map((r) => (
                            <Chip key={r} tone={r === "Admin" ? "accent" : r.startsWith("Approver") ? "review" : "muted"}>
                              {r}
                            </Chip>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {agents[0] === "*" ? (
                          <span className="text-[12px] text-fg-2">All agents</span>
                        ) : agents.length ? (
                          <div className="flex -space-x-1">
                            {agents.map((id) => {
                              const a = agentById(id);
                              return <Logo key={id} name={a.logo} bleed={a.bleed} size={22} rounded="rounded-full" className="ring-2 ring-surface" />;
                            })}
                          </div>
                        ) : (
                          <span className="text-[12px] text-fg-3">{m.roles.some((r) => r.startsWith("Approver")) && !m.roles.includes("Developer") ? "Approves only" : "None yet"}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono text-[12.5px] tnum">{st.n}</td>
                      <td className={cn("px-3 py-3.5 text-right font-mono text-[12.5px] tnum", st.b ? "text-block" : "text-fg-3")}>{st.b}</td>
                      <td className="px-6 py-3.5">
                        <div className="flex gap-1.5">
                          {devs.map((d) => {
                            const h = deviceHealth(d);
                            return (
                              <span key={d.id} title={d.id} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] border", h === "healthy" ? "border-allow/30 text-allow" : h === "degraded" ? "border-review/40 text-review" : "border-block/40 text-block")}>
                                <Laptop className="size-3" /> {h}
                              </span>
                            );
                          })}
                          {!devs.length && <span className="text-[11.5px] text-fg-3">{m.status === "invited" ? "not installed" : "SaaS only"}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "devices" &&
        (devices.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center text-[13px] text-fg-3">No laptops yet. They appear here when an employee runs the installer — try the employee setup.</Card>
        ))}

      {tab === "groups" && (
        <Card className="overflow-hidden">
          {Object.entries(groups).map(([g, ids]) => (
            <div key={g} className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-line last:border-0">
              <span className="font-mono text-[12.5px] text-review w-[170px]">{g}</span>
              <div className="flex -space-x-1.5 flex-1">
                {ids.map((id) => {
                  const p = personById(id);
                  return p ? <Avatar key={id} p={p} size={24} /> : null;
                })}
              </div>
              <span className="text-[12px] text-fg-2">{ids.map((id) => personById(id)?.name).join(", ")}</span>
            </div>
          ))}
          {!Object.keys(groups).length && <div className="px-6 py-8 text-[12.5px] text-fg-3">No approver groups yet — they're created in admin setup or when you sync the directory. Until then REVIEW goes to the admin.</div>}
          <div className="px-5 py-3 text-[12px] text-fg-3 bg-surface-2">Separation of duties is on: whoever requested an action can never approve it, even if they're in the group.</div>
        </Card>
      )}

      {tab === "identities" && (
        <Card className="overflow-hidden">
          {AGENTS.filter((a) => connected[a.id]).map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-6 py-3.5 border-b border-line last:border-0">
              <Logo name={a.logo} bleed={a.bleed} size={24} rounded="rounded-md" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px] truncate">{a.id}@{orgSlug(domain)}</div>
                <div className="text-[11.5px] text-fg-3">
                  {a.owner} · {a.env} · connected {ago(connected[a.id].at)}
                </div>
              </div>
              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                <KeyRound className="size-3" /> rotates in {30 - (Math.floor((Date.now() - connected[a.id].at) / 86_400_000) % 30)}d
              </span>
            </div>
          ))}
          {!Object.keys(connected).length && <div className="px-6 py-8 text-[12.5px] text-fg-3">No agent identities yet — every connected agent gets its own scoped credential.</div>}
        </Card>
      )}

      <MemberDrawer p={open} onClose={() => setOpen(null)} />
      {ws.kind === "fresh" && <p className="mt-4 text-[11.5px] text-fg-3">Fresh workspace: everything on this page was created by what you did.</p>}
    </div>
  );
}

function DeviceCard({ d }: { d: Device }) {
  const h = deviceHealth(d);
  const owner = personById(d.ownerId);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Logo name={d.osLogo} size={32} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] font-medium">{d.id}</div>
          <div className="text-[11.5px] text-fg-3">
            {owner?.name} · {d.os} · MDM {d.mdm}
          </div>
        </div>
        <Chip tone={h === "healthy" ? "allow" : h === "degraded" ? "review" : "block"}>{h}</Chip>
      </div>
      <div className="mt-3 space-y-1.5">
        {d.agents.map((a) => (
          <div key={a.name} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
            <Logo name={a.logo} size={22} rounded="rounded-md" bleed={a.logo === "browseruse"} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{a.name}</div>
              <div className="text-[11px] text-fg-3 truncate">{a.note}</div>
            </div>
            {a.state === "protected" ? <ShieldCheck className="size-4 text-allow" /> : a.state === "degraded" ? <AlertTriangle className="size-4 text-review" /> : <Lock className="size-4 text-block" />}
          </div>
        ))}
        {!d.agents.length && <div className="text-[12px] text-fg-3 px-1">No local agents enabled.</div>}
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-fg-3">
        <span>wrapbox CLI {d.cli}</span>
        <span>checked in {ago(d.seen)}</span>
      </div>
    </Card>
  );
}

function MemberDrawer({ p, onClose }: { p: Person | null; onClose: () => void }) {
  const events = useStore((s) => s.events);
  const devices = useStore((s) => s.devices);
  const domain = useStore((s) => s.domain);
  const mine = useMemo(() => (p ? events.filter((e) => e.human === p.id) : []), [events, p]);
  const devs = p ? devices.filter((d) => d.ownerId === p.id) : [];
  return (
    <Drawer open={!!p} onClose={onClose} width={600} title={p ? <span className="flex items-center gap-2"><Avatar p={p} size={24} /> {p.name}</span> : ""}>
      {p && (
        <div className="p-5 space-y-5">
          <div className="text-[12.5px] text-fg-2">
            {p.role} · {p.id}@{domain}
          </div>
          <div>
            <div className="eyebrow mb-2">Laptops</div>
            <div className="grid gap-2">{devs.length ? devs.map((d) => <DeviceCard key={d.id} d={d} />) : <div className="text-[12.5px] text-fg-3">No laptop reporting yet.</div>}</div>
          </div>
          <div>
            <div className="eyebrow mb-2">Their agents' actions</div>
            <Card className="overflow-hidden">{mine.length ? <DecisionStream events={mine} limit={12} compact /> : <div className="p-5 text-[12.5px] text-fg-3">No actions yet.</div>}</Card>
          </div>
          <p className="text-[11.5px] text-fg-3">Admins see actions and decisions — not source code, file contents or chat history.</p>
        </div>
      )}
    </Drawer>
  );
}

export function Locked({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface-2 border border-line">
        <Lock className="size-5 text-fg-3" />
      </span>
      <h1 className="mt-4 text-[22px] font-semibold">{what} is admin-only</h1>
      <p className="mt-2 text-[13.5px] text-fg-2 leading-relaxed">
        Employees don't see org-wide configuration. In Admin mode this page lets {adminPerson().name.split(" ")[0]}{" "}
        {what === "MCP gateway" ? "wrap Stripe, Razorpay, GitHub and database MCP servers behind one policy" : "see every laptop's hook health, shadow agents, requests and approver groups"}.
      </p>
      <Button className="mt-5" variant="primary" onClick={() => setState({ role: "admin" })}>
        Switch to Admin view
      </Button>
    </div>
  );
}
