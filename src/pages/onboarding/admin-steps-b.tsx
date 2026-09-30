// Admin onboarding — Steps 5–7: Approvers & alerts → Invite your team → Go live.
//
// Real (read from, or written through, the store and the engine):
//   · who approves what — each team job's approver and the store's approverFor(),
//     the same routing Review Center uses; requester separation is checked, not asserted
//   · the approval card preview — a REVIEW that is really waiting in this workspace,
//     or the force-push scenario evaluated by the Core Brain without recording it
//   · every self-test decision — simulateById() through the Core Brain on this
//     workspace's contracts, Safety Kernel and standing permissions, recorded in Evidence
//   · every row of the setup summary
// Simulated (labelled once per step): Slack / Teams / email delivery, the passkey
// prompt, the SCIM directory sync, the invite email, and the interception itself.
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight, Check, ChevronRight, CircleCheck, Clock, Copy, Info, KeyRound, Loader2, Mail, Minus, Play, RefreshCw, ShieldCheck,
} from "lucide-react";
import type { AdminStepProps } from "./types";
import { Segmented, StepFooter, StepHead, Tick, Toggle, sleep } from "../../ui/setup";
import {
  approverFor, getState, setOnboarding, shadowEvent, simulateById, useAppState, type AlertPrefs, type Region,
} from "../../state/store";
import { TASK_JOBS, scenarioById, type Scenario } from "../../engine/scenarios";
import { ORG, USERS, agentById, resourceById, userById } from "../../model/org";
import { destById } from "../../model/registries";
import { ROLLOUT, rolloutById, type AgentKind } from "../../model/rollout";
import type { SimulationEvent } from "../../model/types";
import { AgentMark, Avatar, CardGrid, Chip, DecisionChip, EntityCard, FilterBar, Pager, SimNote, timeAgo, useCardFilters, usePaged } from "../../ui/kit";
import { describe } from "../../ui/describe";
import { logoUrl } from "../../ui/logos";
import { WrapboxLogo } from "../../ui/logo";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Who is asked when `userId` makes a request outside a team job — answered by
 *  the store's own approverFor(), so this page can never drift from Review Center. */
const approverOf = (userId: string) => approverFor({ user: userId } as SimulationEvent);

/** Everyone who can be asked to approve: each team job's approver plus the default routes. */
const APPROVERS = new Set([...TASK_JOBS.map((j) => j.approver), ...USERS.map((u) => approverOf(u.id))]);

const ADMIN = USERS.find((u) => u.role === "Admin");
const nameOf = (id: string) => userById(id)?.name ?? id;
const firstName = (id: string) => nameOf(id).split(" ")[0];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type ChannelKey = "slack" | "teams" | "email";
const CHANNELS: { key: ChannelKey; logo: string; name: string; note: string }[] = [
  { key: "slack", logo: "slack", name: "Slack", note: "Direct message to the approver" },
  { key: "teams", logo: "teams", name: "Microsoft Teams", note: "Chat message to the approver" },
  { key: "email", logo: "gmail", name: "Email", note: "Link to the request in Review Center" },
];
const channelsOn = (a: AlertPrefs) => CHANNELS.filter((c) => a[c.key]);
const ESCALATE: { value: AlertPrefs["escalateMin"]; label: ReactNode }[] = ([5, 15, 30] as const).map((m) => ({
  value: m, label: <span style={{ whiteSpace: "nowrap" }}>{m} min</span>,
}));

const REGION: Record<Region, string> = { us: "US", eu: "EU", in: "India" };
const KIND: Record<AgentKind, string> = {
  coding: "coding agents", chat: "AI chat", copilot: "copilots", internal: "internal agents",
  browser: "browser agents", hosted: "hosted agents", supplier: "supplier agents", unknown: "unregistered agents",
};

/** Step card on the left, preview column on the right; stacks on narrow screens. */
function Split({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
      <div className="card" style={{ flex: "3 1 520px", minWidth: 0, padding: "24px 26px" }}>{main}</div>
      <div style={{ flex: "1 1 330px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>{side}</div>
    </div>
  );
}

function Person({ id, sub, size = 22 }: { id: string; sub?: ReactNode; size?: number }) {
  return (
    <span className="row" style={{ gap: 9, flexWrap: "nowrap", minWidth: 0 }}>
      <Avatar userId={id} size={size} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 550 }}>{nameOf(id)}</span>
        {sub !== undefined && <span className="small faint" style={{ display: "block" }}>{sub}</span>}
      </span>
    </span>
  );
}

function AvatarStack({ ids }: { ids: string[] }) {
  return (
    <span className="row" style={{ gap: 0, flexWrap: "nowrap" }}>
      {ids.map((id, i) => (
        <span key={id} title={nameOf(id)} style={{ marginLeft: i ? -6 : 0, display: "inline-flex" }}>
          <Avatar userId={id} size={20} />
        </span>
      ))}
      <span className="small faint" style={{ marginLeft: 8 }}>{ids.length === 1 ? nameOf(ids[0]) : `${ids.length} people`}</span>
    </span>
  );
}

function timeLeft(ts: number): string {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Step 5 — Approvers and alerts
// ---------------------------------------------------------------------------

export function Step5Approvers(p: AdminStepProps) {
  const s = useAppState();
  const a = p.draft.alerts;
  const setA = (patch: Partial<AlertPrefs>) => p.setDraft({ alerts: { ...a, ...patch } });
  const on = channelsOn(a);

  // Outside a team job: group everyone by who approverFor() sends them to.
  const defaults = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const u of USERS) {
      const ap = approverOf(u.id);
      by.set(ap, [...(by.get(ap) ?? []), u.id]);
    }
    return [...by.entries()].sort((x, y) => y[1].length - x[1].length);
  }, []);
  const usualApprover = defaults[0]?.[0];
  // Requester separation — checked over every route, not assumed.
  const selfRoutes =
    USERS.filter((u) => approverOf(u.id) === u.id).length + TASK_JOBS.filter((j) => j.approver === j.user).length;

  const pending = useMemo(
    () => s.events.filter((e) => e.reviewState?.status === "pending").sort((x, y) => y.timestamp - x.timestamp),
    [s.events],
  );
  const live = pending[0];
  // No request waiting? Evaluate the force-push scenario through the real brain
  // against this workspace's rules — a pure what-if, nothing is recorded.
  const sample = useMemo(() => {
    if (live) return undefined;
    const sc = scenarioById("gw-force-main");
    return sc ? shadowEvent(sc, s.contracts, s.kernel, s.standing) : undefined;
  }, [live, s.contracts, s.kernel, s.standing]);
  const shown = live ?? sample;
  const waitingBy = [...new Set(pending.map((e) => approverFor(e)))].map((id) => ({
    id, n: pending.filter((e) => approverFor(e) === id).length,
  }));

  return (
    <Split
      main={
        <>
          <StepHead n={p.n} total={p.total} title="Approvers and alerts" sub="REVIEW decisions go to people, not to a queue nobody watches." />

          <div className="card-title" style={{ marginBottom: 10 }}>Who approves what</div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Team jobs — a job's risky step goes to its team's approver</div>
          <CardGrid cols={2}>
            {TASK_JOBS.map((j) => (
              <EntityCard
                key={j.id}
                icon={<Avatar userId={j.approver} size={22} />}
                eyebrow={j.team}
                title={nameOf(j.approver)}
                fields={[
                  { label: "Request", value: j.title },
                  { label: "Asked by", value: <Person id={j.user} sub={userById(j.user)?.role} size={18} /> },
                  { label: "Role", value: j.approverRole },
                ]}
              />
            ))}
          </CardGrid>
          <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Outside a team job</div>
          <CardGrid cols={2}>
            {defaults.map(([ap, from], i) => (
              <EntityCard
                key={ap}
                icon={<Avatar userId={ap} size={22} />}
                eyebrow={i === 0 ? "Everyday exceptions" : `${from.map(firstName).join(", ")}'s own requests`}
                title={nameOf(ap)}
                fields={[
                  { label: "Request", value: i === 0 ? "Anything that needs a yes outside a team job" : from.includes(usualApprover) ? "The usual approver can't sign their own" : "Routed to someone else" },
                  { label: "Asked by", value: <AvatarStack ids={from} /> },
                  { label: "Role", value: userById(ap)?.role },
                ]}
              />
            ))}
          </CardGrid>
          <div className="row" style={{ gap: 10, flexWrap: "nowrap", marginTop: 12 }}>
            <ShieldCheck size={16} style={{ color: selfRoutes ? "var(--block)" : "var(--allow)", flexShrink: 0 }} />
            <span className="small" style={{ flex: 1 }}>
              The requester can never approve their own action.{" "}
              <span className="faint">Checked across {plural(USERS.length, "person", "people")} and {plural(TASK_JOBS.length, "team job")}.</span>
            </span>
            {selfRoutes === 0 ? <Chip tone="allow">always on</Chip> : <Chip tone="block">{plural(selfRoutes, "self-approval route")}</Chip>}
          </div>
          {waitingBy.length > 0 && (
            <div className="row small dim" style={{ gap: 6, marginTop: 8 }}>
              <Clock size={13} />
              {plural(pending.length, "request")} waiting in Review Center now —{" "}
              {waitingBy.map((w) => `${nameOf(w.id)} ${w.n}`).join(" · ")}
            </div>
          )}

          <div className="grid g2" style={{ marginTop: 20 }}>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Where approvers get asked</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {CHANNELS.map((c) => (
                  <div key={c.key} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                    <img src={logoUrl(c.logo)} alt="" className="logo-lg" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 550 }}>{c.name}</span>
                      <span className="small faint" style={{ display: "block" }}>{c.note}</span>
                    </span>
                    <Toggle on={a[c.key]} onChange={(v) => setA({ [c.key]: v })} label={c.name} />
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Approval safety</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                  <KeyRound size={16} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13 }}>Every approval is a passkey signature</span>
                  <Toggle on={a.passkey} onChange={(v) => setA({ passkey: v })} label="Every approval is a passkey signature" />
                </div>
                <div>
                  <div className="row" style={{ gap: 10, flexWrap: "nowrap", marginBottom: 8 }}>
                    <Clock size={16} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13 }}>Escalate to an admin after</span>
                  </div>
                  <Segmented value={a.escalateMin} options={ESCALATE} onChange={(v) => setA({ escalateMin: v })} />
                  {ADMIN && <div className="small faint" style={{ marginTop: 6 }}>Unanswered requests go to {ADMIN.name} ({ADMIN.role}).</div>}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <SimNote>Simulated: Slack, Teams and email delivery and the passkey prompt. Who gets asked is the real routing Review Center uses.</SimNote>
          </div>
          <StepFooter
            onBack={p.back}
            onNext={() => { setOnboarding({ alerts: a }); p.next(); }}
            disabled={on.length === 0}
            hint={on.length === 0
              ? "Turn on at least one channel — otherwise requests wait in a queue nobody watches"
              : `Approvers are asked via ${on.map((c) => c.name).join(", ")}`}
          />
        </>
      }
      side={
        <>
          <div className="eyebrow">What an approver sees in Slack</div>
          {shown ? (
            <SlackCard key={shown.id} e={shown} sample={!live} passkey={a.passkey} onOpen={live ? () => p.nav("reviews") : undefined} />
          ) : (
            <div className="card empty">No approval to preview.</div>
          )}
          {shown && (
            <div className="small faint" style={{ lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 6 }}>
              <span>
                {live
                  ? <>A real request waiting in this workspace (<span className="mono">{live.id}</span>). Decide it in Review Center.</>
                  : <>Sample — nothing is waiting in this workspace. This is the “Force push main” scenario evaluated against your current rules; nothing was recorded.</>}
              </span>
              <DeliveryNote e={shown} alerts={a} />
            </div>
          )}
        </>
      }
    />
  );
}

function DeliveryNote({ e, alerts }: { e: SimulationEvent; alerts: AlertPrefs }) {
  if (e.decision !== "REVIEW") return null;
  const ap = approverFor(e);
  const on = channelsOn(alerts);
  const others = on.filter((c) => c.key !== "slack").map((c) => c.name);
  return (
    <span>
      {on.length === 0
        ? "No channel is on — nobody would be told about this request."
        : !alerts.slack
          ? `Slack is off in your choices, so ${firstName(ap)} is asked by ${others.join(" and ")}.`
          : others.length > 0
            ? `${firstName(ap)} also gets it by ${others.join(" and ")}.`
            : null}
      {on.length > 0 && ADMIN && ap !== ADMIN.id && ` No answer in ${alerts.escalateMin} min → escalates to ${ADMIN.name}.`}
    </span>
  );
}

function SlackCard({ e, sample, passkey, onOpen }: { e: SimulationEvent; sample: boolean; passkey: boolean; onOpen?: () => void }) {
  const [msg, setMsg] = useState("");
  const ap = approverFor(e);
  const agent = agentById(e.agent)?.name ?? e.agent;
  const where = `${resourceById(e.resource)?.name ?? e.resource} · ${e.environment}`;
  const lines: [string, ReactNode][] = [
    ["What", describe(e)],
    ["Action", <span className="mono" style={{ fontSize: 11.5 }}>{e.actionRaw ?? e.action}</span>],
    ["Where", where],
    ["Rule", e.decidedBy?.label ?? e.decisionReasons[0] ?? "—"],
  ];
  if (e.blastRadius) lines.push(["Impact", e.blastRadius.label]);
  if (e.reviewState?.status === "pending") lines.push(["Expires", `in ${timeLeft(e.reviewState.expiresAt)}`]);
  const preview = () => setMsg("Preview — decide in Review Center.");

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="row" style={{ gap: 8, padding: "0 14px", height: 38, background: "var(--surface-2)", borderBottom: "1px solid var(--line)", flexWrap: "nowrap" }}>
        <img src={logoUrl("slack")} alt="" className="logo-img" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Slack</span>
        <span className="small faint" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>· direct message to {nameOf(ap)}</span>
        <span style={{ marginLeft: "auto" }}>{sample ? <Chip tone="neutral">sample</Chip> : <Chip tone="review">waiting now</Chip>}</span>
      </div>
      <div className="row" style={{ gap: 12, padding: 14, alignItems: "flex-start", flexWrap: "nowrap" }}>
        <span style={{ width: 36, height: 36, borderRadius: 8, background: "var(--header)", border: "1px solid var(--line)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <WrapboxLogo size={22} tone="dark" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, fontSize: 12.5 }}>
            <b>Wrapbox</b>
            <span className="chip c-neutral" style={{ fontSize: 9.5, padding: "0 5px" }}>APP</span>
            <span className="faint" style={{ fontSize: 11 }}>{sample ? "now" : timeAgo(e.timestamp)}</span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{agent} needs approval for {nameOf(e.user)}</span>
            <DecisionChip d={e.decision} small />
          </div>
          <div className="row small dim" style={{ gap: 6, marginTop: 4, flexWrap: "nowrap" }}>
            <Avatar userId={e.user} size={18} />
            <span>{nameOf(e.user)} · {userById(e.user)?.role} · using <AgentMark agentId={e.agent} size={12} /> {agent}</span>
          </div>
          <div style={{ marginTop: 8, borderLeft: "4px solid var(--review)", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 3 }}>
            {lines.map(([k, v]) => (
              <div key={k} style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                <span className="faint">{k}: </span>{v}
              </div>
            ))}
          </div>
          {e.decision === "REVIEW" ? (
            <>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                <button className="btn btn-good btn-sm" onClick={preview}>
                  {passkey && <KeyRound size={12} />} {passkey ? "Approve with passkey" : "Approve"}
                </button>
                <button className="btn btn-sm" onClick={preview}>Deny</button>
                {onOpen && <button className="btn btn-ghost btn-sm" onClick={onOpen}>Open in Wrapbox <ArrowUpRight size={12} /></button>}
              </div>
              {msg && <div className="small dim" style={{ marginTop: 8 }}>{msg}</div>}
            </>
          ) : (
            <div className="small dim" style={{ marginTop: 10 }}>
              With the rules in this workspace today this is decided <b>{e.decision}</b>, so no approver would be asked.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Invite your team
// ---------------------------------------------------------------------------

export function Step6Team(p: AdminStepProps) {
  const s = useAppState();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [copy, setCopy] = useState<"" | "ok" | "fail">("");
  const linkRef = useRef<HTMLInputElement>(null);

  const synced = p.draft.synced || s.onboarding.invited.length > 1;
  const idp = s.org.idp || "Okta";
  const idpLogo = idp === "Google Workspace" ? "google" : idp === "Microsoft Entra ID" ? "microsoft" : "okta";
  const domain = (s.org.domain || ORG.domain).trim().toLowerCase();
  const slug = domain.split(".")[0].replace(/[^a-z0-9-]/g, "") || "workspace";
  const link = `https://app.wrapbox.ai/join/${slug}`;
  const emailOf = (id: string) => `${(userById(id)?.email ?? id).split("@")[0]}@${domain}`;
  const me = ADMIN?.id ?? "u-priya";

  const directory = USERS.filter((u) => s.onboarding.invited.includes(u.id));
  const invitees = directory.filter((u) => u.id !== me);
  const dirFilter = useCardFilters(directory, {
    search: (u) => `${u.name} ${u.role} ${emailOf(u.id)}`,
    filters: [{ id: "role", label: "Role", get: (u) => u.role }],
  });
  const dirPg = usePaged(dirFilter.filtered, 8, dirFilter.resetKey);
  const connected = s.onboarding.connected.length;

  const sync = async () => {
    setBusy(true);
    await sleep(1000);
    setOnboarding({ invited: USERS.map((u) => u.id) });
    p.setDraft({ synced: true });
    setBusy(false);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("ok");
      setTimeout(() => setCopy(""), 1800);
    } catch {
      setCopy("fail");
      linkRef.current?.select();
    }
  };
  const onNext = async () => {
    if (synced && !p.draft.invitesSent && invitees.length > 0) {
      setSending(true);
      await sleep(600);
      p.setDraft({ invitesSent: true });
    }
    p.next();
  };

  const recipient = "u-daniel";
  const inviter = me;

  return (
    <Split
      main={
        <>
          <StepHead n={p.n} total={p.total} title="Invite your team" sub="Step 4 connected the tools; this step brings in the people who use them." />

          <div className="card">
            <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
              <img src={logoUrl(idpLogo)} alt="" className="logo-lg" style={{ width: 26, height: 26 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sync people from {idp} (SCIM)</div>
                <div className="small faint">Names, roles and work emails come from your directory — nobody is typed in by hand.</div>
              </div>
              <button className={`btn btn-sm ${synced ? "" : "btn-primary"}`} disabled={busy} onClick={sync}>
                {busy ? <Loader2 size={13} className="spin" /> : synced ? <RefreshCw size={13} /> : null}
                {busy ? "Syncing…" : synced ? "Sync again" : `Connect ${idp}`}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {directory.length > 4 && <FilterBar {...dirFilter.bar} placeholder="Search people, roles, emails…" />}
            <CardGrid cols={2}>
              {dirPg.rows.map((u) => (
                <EntityCard
                  key={u.id}
                  icon={<Avatar userId={u.id} size={22} />}
                  eyebrow={u.role}
                  title={nameOf(u.id)}
                  status={u.id === me ? <Chip tone="neutral">you · admin</Chip>
                    : p.draft.invitesSent ? <Chip tone="allow">invited</Chip>
                    : <Chip tone="allow">synced</Chip>}
                  fields={[
                    { label: "Email", value: <span className="mono" style={{ fontSize: 11.5 }}>{emailOf(u.id)}</span> },
                    ...(APPROVERS.has(u.id) ? [{ label: "Access", value: <Chip tone="review">approver</Chip> }] : []),
                  ]}
                />
              ))}
            </CardGrid>
            <Pager {...dirPg} />
            {!synced && (
              <div className="small faint" style={{ marginTop: 10 }}>
                Only you are in this workspace so far. Sync {idp} to bring in your team.
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Invite link</div>
            <div className="small faint">People sign in with {idp}; the link only admits accounts on @{domain}.</div>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "nowrap" }}>
              <input ref={linkRef} className="input mono" readOnly value={link} onFocus={(ev) => ev.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} aria-label="Invite link" />
              <button className="btn" onClick={copyLink}>
                {copy === "ok" ? <Check size={14} /> : <Copy size={14} />} {copy === "ok" ? "Copied" : "Copy"}
              </button>
            </div>
            {copy === "fail" && <div className="small faint" style={{ marginTop: 6 }}>The clipboard isn't available here — the link is selected, press ⌘C / Ctrl+C.</div>}
            <div className="row small faint" style={{ gap: 5, marginTop: 12 }}>
              You send the link <ChevronRight size={12} /> they sign in with {idp} <ChevronRight size={12} />
              {connected > 0
                ? <span>their agents are already governed by the {plural(connected, "target")} you connected in Step 4</span>
                : <span style={{ color: "var(--review)" }}>nothing is connected yet — their agents aren't governed until you connect a target in Step 4</span>}
            </div>
          </div>

          {p.draft.invitesSent && invitees.length > 0 && (
            <div className="row small" style={{ gap: 8, marginTop: 12 }}>
              <CircleCheck size={15} style={{ color: "var(--allow)" }} />
              Invites sent to {plural(invitees.length, "person", "people")} · they sign in with {idp}
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <SimNote>Simulated: the {idp} SCIM sync and the invite email. The people and roles are this workspace's real directory.</SimNote>
          </div>
          <StepFooter
            onBack={p.back}
            onNext={onNext}
            busy={sending}
            nextLabel={sending ? "Sending invites" : p.draft.invitesSent ? "Continue" : synced ? "Send invites & continue" : "Continue without inviting"}
            hint={!synced
              ? "Sync your directory to invite people — or share the link later"
              : p.draft.invitesSent ? `${plural(invitees.length, "person", "people")} invited`
              : `Sends ${plural(invitees.length, "invitation")}`}
          />
        </>
      }
      side={
        <>
          <div className="eyebrow">The email your team receives</div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row" style={{ gap: 8, padding: "0 16px", height: 40, background: "var(--surface-2)", borderBottom: "1px solid var(--line)", fontSize: 12, color: "var(--fg-2)", flexWrap: "nowrap" }}>
              <Mail size={14} /> Inbox · <span className="mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emailOf(recipient)}</span>
            </div>
            <div style={{ padding: 20 }}>
              <div className="small faint">From: {nameOf(inviter)} via Wrapbox &lt;no-reply@wrapbox.ai&gt;</div>
              <div style={{ marginTop: 4, fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>
                {firstName(inviter)} invited you to the {s.org.company || "Wrapbox"} workspace
              </div>
              <div style={{ marginTop: 16, borderRadius: 12, padding: 20, background: "var(--header)", border: "1px solid var(--line)", color: "var(--accent-fg)" }}>
                <div className="row" style={{ gap: 10 }}>
                  <WrapboxLogo size={26} tone="dark" />
                  <span style={{ fontFamily: "var(--brandfont)", fontSize: 16, fontWeight: 700 }}>Wrapbox</span>
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.6, color: "color-mix(in oklab, var(--accent-fg) 82%, transparent)" }}>
                  Hi {firstName(recipient)} — {s.org.company || "your company"} uses Wrapbox to keep the AI agents you work with safe to run.
                  Your agents keep working as they do today; Wrapbox steps in only when an action touches secrets, protected branches,
                  customer data or production.
                </p>
                <div style={{ marginTop: 10, fontSize: 12, color: "color-mix(in oklab, var(--accent-fg) 62%, transparent)" }}>
                  Your role: {userById(recipient)?.role} · risky actions you start go to {nameOf(approverOf(recipient))} for approval
                </div>
                <div className="row" style={{ gap: 8, marginTop: 14 }}>
                  <button className="btn btn-sm" disabled title="Preview — the real email opens the sign-in page"
                    style={{ background: "var(--accent-fg)", color: "var(--header)", borderColor: "transparent", fontWeight: 600, opacity: 0.85 }}>
                    Accept invitation
                  </button>
                  <span style={{ fontSize: 11, color: "color-mix(in oklab, var(--accent-fg) 55%, transparent)" }}>preview</span>
                </div>
              </div>
              <p className="small faint" style={{ margin: "12px 0 0" }}>
                They sign in with {idp} and register a passkey — about 3 minutes, nothing to configure.
              </p>
            </div>
          </div>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Go live
// ---------------------------------------------------------------------------

interface SelfTest { sid: string; target: string; label: (sc: Scenario) => string }
const agentName = (sc: Scenario) => agentById(sc.agent)?.name ?? sc.agent;
const SELF_TESTS: SelfTest[] = [
  { sid: "ep-read-env", target: "endpoint", label: (sc) => `${agentName(sc)} reads ${sc.resource}` },
  { sid: "net-pii-approved", target: "network", label: () => "An employee sends a customer list to an approved AI" },
  { sid: "gw-force-main", target: "gw-github", label: (sc) => `${agentName(sc)} force-pushes to main` },
];
const STAGE_MS = 380;

export function Step7GoLive(p: AdminStepProps) {
  const s = useAppState();
  const [runs, setRuns] = useState<Record<string, { eventId: string; stage: number }>>({});
  const [error, setError] = useState("");
  const byId = useMemo(() => new Map(s.events.map((e) => [e.id, e])), [s.events]);
  const recorded = s.onboarding.selfTests.map((id) => byId.get(id)).filter((e): e is SimulationEvent => !!e);
  const activeContracts = s.contracts.filter((c) => c.status === "ACTIVE");

  const run = async (sid: string) => {
    setError("");
    const e = simulateById(sid); // the real engine, recorded like any other decision
    if (!e) { setError(`Scenario ${sid} is missing from the scenario library.`); return; }
    setOnboarding({ selfTests: [...getState().onboarding.selfTests, e.id] });
    setRuns((r) => ({ ...r, [sid]: { eventId: e.id, stage: 0 } }));
    for (let i = 1; i <= 4; i++) {
      await sleep(STAGE_MS);
      setRuns((r) => ({ ...r, [sid]: { eventId: e.id, stage: i } }));
    }
  };

  return (
    <Split
      main={
        <>
          <StepHead
            n={p.n} total={p.total} title="Go live — check the rules are live"
            sub="A self-test you send from this console; nobody on your team has to do anything. Each one runs through the same engine live traffic uses, and lands in Evidence."
          />
          {activeContracts.length === 0 && (
            <div className="filter-bar" style={{ justifyContent: "flex-start" }}>
              <Info size={14} style={{ flexShrink: 0 }} />
              <span>No intent contract is active yet, so only the Safety Kernel and built-in limits apply. You'll see whatever the engine really decides with that — which is the point.</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SELF_TESTS.map((t) => {
              const sc = scenarioById(t.sid);
              const target = rolloutById(t.target);
              if (!sc || !target) return null;
              const connected = s.onboarding.connected.includes(t.target);
              const local = runs[t.sid];
              const e = local ? byId.get(local.eventId) : recorded.filter((x) => x.scenario === t.sid).at(-1);
              const stage = local ? local.stage : e ? 4 : -1;
              const busy = stage >= 0 && stage < 4;
              const detail = sc.actionRaw ?? (sc.fileName && sc.destination ? `${sc.fileName} → ${destById(sc.destination)?.label ?? sc.destination}` : sc.action);
              return (
                <div key={t.sid} className="card" style={{ padding: 0 }}>
                  <div className="row" style={{ gap: 12, padding: "14px 16px", alignItems: "flex-start" }}>
                    <span style={{ marginTop: 2 }}><AgentMark agentId={sc.agent} size={26} /></span>
                    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label(sc)}</div>
                      <div className="mono faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>
                      <div className="row small" style={{ gap: 6, marginTop: 6 }}>
                        <img src={logoUrl(target.logo)} alt="" className="logo-img" />
                        <span className="dim">{target.name}</span>
                        {connected
                          ? <Chip tone="allow">connected</Chip>
                          : <span className="faint">· decided like this once {target.name} is connected</span>}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {stage === 4 && e && <DecisionChip d={e.decision} />}
                      <button className="btn btn-sm" disabled={busy} onClick={() => run(t.sid)}>
                        {busy ? <Loader2 size={13} className="spin" /> : <Play size={12} />} {e ? "Run again" : "Run self-test"}
                      </button>
                    </div>
                  </div>
                  {e && stage >= 0 && (
                    <div style={{ borderTop: "1px solid var(--line)", padding: "12px 16px", display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                      <div style={{ minWidth: 0 }}>
                        {[
                          <>Intercepted by {target.name}</>,
                          <>Normalized to <span className="mono">{e.action}</span>{e.actionRaw && <span className="mono faint"> ← {e.actionRaw}</span>}</>,
                          <>Policy matched: <b style={{ fontWeight: 550 }}>{e.decidedBy?.label ?? e.decisionReasons[0] ?? "—"}</b></>,
                          <>Decided</>,
                        ].slice(0, Math.min(stage + 1, 4)).map((line, i) => (
                          <Tick key={i} done={stage > i}>{line}</Tick>
                        ))}
                      </div>
                      {stage === 4 && <SelfTestResult e={e} alerts={s.onboarding.alerts} nav={p.nav} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {error && <div className="small" style={{ color: "var(--block)", marginTop: 10 }}>{error}</div>}

          <div style={{ marginTop: 18 }}>
            <SimNote>Simulated: the laptop and gateway interception. The decision is the real engine on this workspace's rules, recorded in Evidence.</SimNote>
          </div>
          <StepFooter
            onBack={p.back}
            onNext={p.finish}
            nextLabel="Open the Control Room"
            hint={recorded.length > 0
              ? `${plural(recorded.length, "self-test decision")} recorded in Evidence`
              : "Run at least one self-test to confirm the rules fire end to end"}
          />
        </>
      }
      side={<SetupSummary />}
    />
  );
}

function SelfTestResult({ e, alerts, nav }: { e: SimulationEvent; alerts: AlertPrefs; nav: (r: string) => void }) {
  const rs = e.reviewState;
  const ap = approverFor(e);
  const via = channelsOn(alerts).map((c) => c.name);
  const t = e.transformation ?? [];
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <DecisionChip d={e.decision} />
        <span className="mono faint" style={{ fontSize: 11 }}>{e.id} · #{e.evidence.hash}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 550 }}>{describe(e)}</div>
      {rs?.status === "pending" && (
        <div className="small dim" style={{ marginTop: 4 }}>
          Waiting for {nameOf(ap)} ({userById(ap)?.role}){via.length > 0 ? ` — asked via ${via.join(", ")}` : " — no alert channel is on"}.
        </div>
      )}
      {rs && rs.status !== "pending" && rs.reviewer && (
        <div className="small dim" style={{ marginTop: 4 }}>Review {rs.status.replaceAll("_", " ")} by {nameOf(rs.reviewer)}.</div>
      )}
      {t.length > 0 && (
        <div className="small dim" style={{ marginTop: 4 }}>
          {plural(t.length, "value")} transformed before sending ({t[0].kind.toLowerCase().replaceAll("_", " ")}).
        </div>
      )}
      {e.decision === "BLOCK" && e.safeAlternative && (
        <div className="small dim" style={{ marginTop: 4 }}>Safer alternative: {e.safeAlternative.replace(/^safer alternative:\s*/i, "")}</div>
      )}
      {e.safetyObserved && e.safetyObserved.length > 0 && (
        <div className="small faint" style={{ marginTop: 4 }}>
          Safety Kernel (observing) would have blocked: {e.safetyObserved.map((r) => r.name).join(", ")}.
        </div>
      )}
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <button className="btn btn-sm" onClick={() => nav("evidence")}>View in Evidence <ArrowUpRight size={12} /></button>
        {rs?.status === "pending" && <button className="btn btn-ghost btn-sm" onClick={() => nav("reviews")}>Open Review Center</button>}
      </div>
    </div>
  );
}

function SetupSummary() {
  const s = useAppState();
  const o = s.onboarding;
  const active = s.contracts.filter((c) => c.status === "ACTIVE");
  const rules = active.reduce((n, c) => n + c.clauses.length, 0);
  const drafts = s.contracts.filter((c) => c.status === "DRAFT").length;
  const chans = channelsOn(o.alerts).map((c) => c.name);
  const people = o.invited.length;
  const tests = o.selfTests.filter((id) => s.events.some((e) => e.id === id)).length;

  const rows: { ok: boolean; label: string; text: string; sub?: string }[] = [
    {
      ok: !!s.org.keyThumb, label: "Workspace",
      text: s.org.keyThumb ? `${s.org.company} · ${s.org.idp || "no SSO"} · ${REGION[s.org.region] ?? s.org.region}` : "Not provisioned yet",
      sub: s.org.keyThumb ? `signing key ${s.org.keyThumb.slice(0, 16)}${s.org.keyThumb.length > 16 ? "…" : ""}` : undefined,
    },
    {
      ok: o.categories.length > 0, label: "Agents to govern",
      text: o.categories.length > 0 ? `${plural(o.categories.length, "category", "categories")} · ${o.categories.map((k) => KIND[k] ?? k).join(", ")}` : "None chosen",
    },
    {
      ok: active.length > 0, label: "Intent contract",
      text: active.length > 0
        ? `${plural(active.length, "active contract")} · ${plural(rules, "rule")}${drafts ? ` · ${drafts} draft` : ""}`
        : drafts ? `${plural(drafts, "draft")}, none active` : "No contract yet",
    },
    { ok: o.connected.length > 0, label: "Connected", text: `${o.connected.length} of ${ROLLOUT.length} rollout targets` },
    {
      ok: chans.length > 0, label: "Approvals",
      text: chans.length > 0
        ? `${chans.join(", ")} · passkey ${o.alerts.passkey ? "required" : "optional"} · escalate after ${o.alerts.escalateMin} min`
        : "No alert channel on",
    },
    { ok: people > 1, label: "Team", text: people > 1 ? `${people} people in the directory` : "Only you so far" },
  ];

  return (
    <div className="card">
      <div className="card-title">Setup summary</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 13 }}>
        {rows.map((r) => (
          <li key={r.label} className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
            {r.ok
              ? <CircleCheck size={16} style={{ color: "var(--allow)", flexShrink: 0, marginTop: 2 }} />
              : <Minus size={16} style={{ color: "var(--fg-4)", flexShrink: 0, marginTop: 2 }} />}
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow" style={{ fontSize: 10.5 }}>{r.label}</div>
              <div style={{ fontSize: 13, color: r.ok ? "var(--fg)" : "var(--fg-3)" }}>{r.text}</div>
              {r.sub && <div className="mono faint" style={{ fontSize: 11 }}>{r.sub}</div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="small faint" style={{ marginTop: 14 }}>
        {tests > 0 ? `${plural(tests, "self-test decision")} in Evidence.` : "No self-test run yet."}
      </div>
      <p className="small faint" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>Everything above is now real in this workspace — every page reflects it.</p>
    </div>
  );
}
