import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AGENTS, agentById, type Decision } from "../data/agents";
import { personById } from "../data/people";
import { CodeBlock, json } from "../components/code";
import { Avatar, Button, Card, DecisionPill, Drawer, EvidenceChain, Logo, PageHeader, Segmented, cn } from "../components/ui";
import { clock } from "../lib/router";
import { EMPLOYEE, getState, toast, useStore, useWorkspace, type Evt } from "../lib/store";

/** The device a decision came from: the Runtime records its id on every action it observes. */
function useDeviceOf(e: Evt | null) {
  const fleet = useStore((s) => s.fleet);
  const id = e?.act?.ctx?.["device.id"];
  return typeof id === "string" ? fleet.find((d) => d.id === id) : undefined;
}

export function EvidenceDrawer({ e, onClose }: { e: Evt | null; onClose: () => void }) {
  return (
    <Drawer open={!!e} onClose={onClose} title={e ? <span className="flex items-center gap-2"><DecisionPill d={e.decision} size="sm" /> Decision {e.id}</span> : ""}>
      {e && <EvidenceBody e={e} />}
    </Drawer>
  );
}

function EvidenceBody({ e }: { e: Evt }) {
  const a = agentById(e.agentId);
  const p = personById(e.human);
  const device = useDeviceOf(e);
  const approvers = (e.approvers ?? []).map((id) => personById(id)).filter(Boolean);
  // A receipt-derived (live) event carries the enforcement point and the raw
  // effect the runtime recorded. tamper/violation both collapse to a BLOCK
  // decision but are NOT policy denials, so the Outcome/Permit rows describe the
  // real effect rather than "Effect never executed". Both fall back to the
  // decision-based text when the field is absent (simulated workspaces).
  const enforcement = typeof e.act?.ctx?.enforcement === "string" ? (e.act.ctx.enforcement as string) : "";
  const receiptEffect = typeof e.act?.ctx?.receiptEffect === "string" ? (e.act.ctx.receiptEffect as string) : undefined;
  const live = e.source === "live";
  const chain: { label: string; value: React.ReactNode; tone?: string }[] = [
    // Receipts carry no human identity, so the Human link only appears when a
    // person is actually attributed (simulated workspaces) — never as a blank row
    // implying an identity the record does not hold.
    ...(p || e.human
      ? [{ label: "Human", value: p ? <span className="flex items-center gap-2"><Avatar p={p} size={20} />{p.name} <span className="text-fg-3">· {p.role}</span></span> : e.human }]
      : []),
    { label: "Agent", value: <span className="flex items-center gap-2"><Logo name={a.logo} bleed={a.bleed} size={20} rounded="rounded" />{a.name}</span> },
    ...(device
      ? [{ label: "Device", value: <span className="flex items-center gap-2"><Logo name={device.osLogo} size={20} rounded="rounded" /><span className="font-mono text-[12px]">{device.hostname}</span> <span className="text-fg-3">· {device.os}</span></span> }]
      : []),
    { label: "Action", value: <span className="font-mono text-[12px]">{e.action}</span> },
    { label: "Effect", value: <span className="font-mono text-[12px]">{e.effect}</span> },
    { label: "Policy", value: <span className="font-mono text-[12px]">rule {e.rule} · {e.reason}</span> },
    ...(e.rewritten ? [{ label: "Rewritten", value: <span className="font-mono text-[12px] text-constrain">{e.rewritten}</span> }] : []),
    ...(e.decision === "REVIEW" || approvers.length
      ? [{ label: "Approver", value: approvers.length ? approvers.map((x) => x!.name).join(" + ") : <span className="text-review">waiting for a human</span> }]
      : []),
    // A live receipt carries no environment (the runtime never records one), so
    // show the real enforcement point instead of an invented "production".
    { label: "Decision", value: <span className="flex items-center gap-2"><DecisionPill d={e.decision} size="sm" /><span className="font-mono text-[12px] text-fg-3">{e.latency > 0 ? `${e.latency} ms · ` : ""}{live ? `${enforcement ? `enforced by ${enforcement}` : "enforcement not reported"} · environment not reported` : e.env}</span>{e.observed && <span className="text-[11.5px] text-review">observe mode: would {e.observed}</span>}</span> },
    // Only describe a permit that exists. An allow with no permit means none was
    // minted — saying "auto-minted, 60s" would invent a control that never ran.
    // tamper/violation are not policy decisions, so no permit is minted for them.
    { label: "Permit", value:
      receiptEffect === "tamper" ? <span className="text-fg-3">none — this is a tamper record, not a policy decision</span>
      : receiptEffect === "violation" ? <span className="text-fg-3">none — no permit is minted for a sandbox denial</span>
      : e.permit ? <span className="font-mono text-[12px] text-accent">{e.permit} · verified · used once</span>
      : <span className="text-fg-3">{e.decision === "BLOCK" ? "none — denied before execution" : e.decision === "REVIEW" ? "pending approval" : "none minted for this decision"}</span> },
    // Wrapbox observes its own decision, not the outcome of the action it let
    // through: "Executed once" would assert a completion nothing reported. A
    // tamper receipt did NOT block anything; a kernel violation was denied by the
    // sandbox after the fact — neither is "Effect never executed".
    { label: "Outcome", value:
      receiptEffect === "tamper" ? <span className="text-review font-medium">Enforcement config was modified and restored — this action was not blocked</span>
      : receiptEffect === "violation" ? <span className="text-block font-medium">Denied by the kernel sandbox — recorded from the system log after the fact</span>
      : e.decision === "BLOCK" ? <span className="text-block font-medium">{receiptEffect === "block" ? "Refused before the tool ran" : "Effect never executed"}</span>
      : e.decision === "REVIEW" ? <span className="text-review font-medium">Paused</span>
      : e.decision === "CONSTRAIN" ? <span className="text-constrain font-medium">Safer variant allowed to proceed</span>
      : <span className="text-allow font-medium">Allowed to proceed</span> },
  ];
  return (
    <div className="p-5 space-y-5">
      <div>
        <div className="eyebrow mb-3">Evidence chain</div>
        <EvidenceChain rows={chain} />
      </div>
      <div>
        {/* "Immutable record" is only earned when the signer's chain fields are
            present. For a live receipt that carries `prev`, this is a real
            hash-chained record; otherwise it is a plain decision record. Nothing
            in a hash/signature position is ever synthesized. */}
        <div className="eyebrow mb-2">{e.prev ? "Signed receipt — hash-chained on the device" : "Decision record"}</div>
        <CodeBlock
          file={`evidence/${e.id}.json`}
          lang="json"
          code={json({
            decision_id: e.id,
            timestamp: new Date(e.ts).toISOString(),
            org: getState().domain.replace(/\..*$/, ""),
            human: e.human,
            subject_agent: e.agentId,
            // Which machine the action came from. Part of the signed record, not just the UI.
            ...(device ? { device: { id: device.id, hostname: device.hostname, os: device.os } } : {}),
            action: e.action,
            effect: e.effect,
            rule: e.rule,
            decision: e.decision,
            reason: e.reason,
            latency_ms: e.latency > 0 ? e.latency : null,
            // The receipt carries no environment; report the real enforcement
            // point instead of stamping "production" on it.
            environment: live ? null : e.env,
            enforced_by: enforcement || null,
            observe_mode_would: e.observed ?? null,
            permit_id: e.permit ?? null,
            approved_by: e.approvers ?? [],
            rewritten_to: e.rewritten ?? null,
            contract_version: getState().version,
            // Chain fields exactly as the signer returned them — omitted entirely
            // when this event is not a signed receipt (never fabricated).
            ...(typeof e.seq === "number" ? { seq: e.seq } : {}),
            ...(e.prev ? { prev_hash: e.prev } : {}),
            ...(e.sig ? { signature: e.sig } : {}),
            ...(e.keyId ? { signing_key_id: e.keyId } : {}),
            ...(e.verified !== undefined ? { signature_verified: e.verified } : {}),
          })}
        />
      </div>
    </div>
  );
}

/**
 * SIEM pushes (Splunk/Datadog) are simulated integrations to systems the user
 * cannot see — the two-step queued/delivered feedback mirrors a real push.
 * The evidence pack is different: it is a local artifact built from decisions
 * already in the store, so we generate the real file and hand it to the user
 * rather than announce a signed PDF this build does not produce or sign.
 */
function exportTo(target: "splunk" | "datadog" | "pack", rows: Evt[]) {
  const n = rows.length;
  if (target === "pack") {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wrapbox-evidence-${n}-decisions.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Evidence pack downloaded", `${n} ${n === 1 ? "decision" : "decisions"} · JSON · unsigned`, "allow");
    return;
  }
  const label = target === "splunk" ? "Splunk" : "Datadog";
  toast(`${label} export started`, `${n} decisions queued · ${target === "splunk" ? "HEC index wrapbox_decisions" : "logs pipeline wrapbox-decisions"}`);
  setTimeout(() => toast(`Exported to ${label}`, `${n} decisions delivered · 0 failed`, "allow"), 1500);
}

export function Evidence({ query }: { query?: URLSearchParams }) {
  const role = useStore((s) => s.role);
  const allRaw = useStore((s) => s.events);
  const envFilter = useStore((s) => s.envFilter);
  // v2 is the live Control-Plane-backed workspace: its receipts carry no human,
  // approver, permit or environment. Copy that is true of simulated workspaces
  // is scoped away from live data rather than asserted over it.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  // A live receipt reports no environment, so it must never be filed under a
  // specific env bucket — it appears only under "All environments".
  const all = useMemo(() => (envFilter === "all" ? allRaw : allRaw.filter((e) => e.source !== "live" && e.env === envFilter)), [allRaw, envFilter]);
  const [d, setD] = useState<"all" | Decision>("all");
  const [agent, setAgent] = useState(query?.get("agent") || "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Evt | null>(null);
  const [limit, setLimit] = useState(80);
  const { labs } = useWorkspace();
  const mine = role === "employee";
  const rows = useMemo(
    () =>
      all.filter(
        (e) =>
          (!mine || e.human === EMPLOYEE.id) &&
          (d === "all" || e.decision === d) &&
          (agent === "all" || e.agentId === agent) &&
          (!q || (e.action + e.rule + e.id).toLowerCase().includes(q.toLowerCase())),
      ),
    [all, d, agent, q, mine],
  );
  const agentsInLog = useMemo(() => Array.from(new Set(all.map((e) => e.agentId))), [all]);
  const fleet = useStore((s) => s.fleet);
  // The column only appears where devices report — workspaces without a Runtime have nothing to show.
  const showDevice = fleet.length > 0;
  return (
    <div className="mx-auto max-w-[1240px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={mine ? "Your actions only" : "Audit & evidence"}
        title={mine ? "My activity" : "Evidence"}
        sub={
          mine
            ? "Everything your agents tried, what Wrapbox decided, and why. Only you and your admins can see this."
            : cpBacked
              ? "Every decision with the chain that produced it: device → agent → tool → resource → policy → outcome — each one a signed, hash-chained receipt from the endpoint. Approver and permit appear on the decisions that had them."
              : "Every decision with the chain that produced it: human → agent → tool → resource → policy → approver → permit → outcome."
        }
        right={
          !mine && (
            <>
              <Button size="sm" onClick={() => exportTo("splunk", all)}>
                <Logo name="splunk" size={16} rounded="rounded" /> Export to Splunk
              </Button>
              <Button size="sm" onClick={() => exportTo("datadog", all)}>
                <Logo name="datadog" size={16} rounded="rounded" /> Datadog
              </Button>
              <Button size="sm" onClick={() => exportTo("pack", all)}>
                <Download className="size-3.5" /> Evidence pack
              </Button>
            </>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-line">
          <Segmented
            size="sm"
            value={d}
            onChange={setD}
            options={[
              { value: "all", label: "All" },
              { value: "ALLOW", label: "Allowed" },
              { value: "CONSTRAIN", label: "Rewritten" },
              { value: "REVIEW", label: "Review" },
              { value: "BLOCK", label: "Blocked" },
            ]}
          />
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="h-7 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-2 outline-none">
            <option value="all">All agents</option>
            {[...AGENTS.filter((a) => agentsInLog.includes(a.id)), ...agentsInLog.filter((id) => !AGENTS.some((a) => a.id === id)).map(agentById)].map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-[12px] text-fg-3 tnum">{rows.length.toLocaleString("en-US")} {rows.length === 1 ? "decision" : "decisions"}</span>
          <div className="ml-auto flex items-center gap-2 h-7 rounded-full border border-line bg-surface px-3 w-[240px] max-w-full">
            <Search className="size-3.5 text-fg-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, rule or id" className="flex-1 bg-transparent outline-none text-[12.5px] placeholder:text-fg-3" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="text-[11.5px] text-fg-3 border-b border-line">
                <th className="font-medium px-4 py-2 w-[80px]">Time</th>
                <th className="font-medium px-2 py-2 w-[90px]">Decision</th>
                <th className="font-medium px-3 py-3">Agent · action</th>
                {showDevice && <th className="font-medium px-3 py-3">Device</th>}
                <th className="font-medium px-3 py-3">{mine ? "Why" : "Rule"}</th>
                {!mine && <th className="font-medium px-3 py-3">Human</th>}
                <th className="font-medium px-4 py-2 text-right">Latency</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((e) => {
                const a = agentById(e.agentId);
                const p = personById(e.human);
                return (
                  <tr key={e.id} onClick={() => setOpen(e)} className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer">
                    <td className="px-5 py-3.5 font-mono text-[11.5px] text-fg-3 tnum">{clock(e.ts)}</td>
                    <td className="px-3 py-3.5"><DecisionPill d={e.decision} size="sm" /></td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Logo name={a.logo} bleed={a.bleed} size={22} rounded="rounded-md" />
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium truncate">{a.name}</div>
                          <div className="font-mono text-[11.5px] text-fg-2 truncate max-w-[420px]">{e.action}</div>
                        </div>
                      </div>
                    </td>
                    {showDevice && (
                      <td className="px-3 py-3.5 font-mono text-[11.5px] text-fg-3">
                        {(() => {
                          const id = e.act?.ctx?.["device.id"];
                          const d = typeof id === "string" ? fleet.find((x) => x.id === id) : undefined;
                          return d ? <span title={`${d.hostname} · ${d.os}`}>{d.hostname.split(".")[0]}</span> : <span className="text-fg-3/60">—</span>;
                        })()}
                      </td>
                    )}
                    <td className={cn("px-3 py-3.5 text-[12px]", mine ? "text-fg-2" : "font-mono text-fg-3")}>{mine ? e.reason : e.rule}</td>
                    {!mine && <td className="px-3 py-3.5">{p && <span className="flex items-center gap-2 text-[12.5px]"><Avatar p={p} size={20} />{p.name}</span>}</td>}
                    <td className="px-5 py-3.5 text-right font-mono text-[11.5px] text-fg-3 tnum">{e.latency > 0 ? `${e.latency} ms` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="px-4 py-12 text-center text-[13px] text-fg-3">{allRaw.length ? "No decisions match these filters." : labs ? "No decisions yet — they appear here the moment an agent acts. Try the playground." : "No decisions yet — they appear here the moment an agent acts."}</div>}
          {rows.length > limit && (
            <button onClick={() => setLimit(limit + 120)} className="w-full border-t border-line px-4 py-3 text-[12.5px] text-fg-2 hover:bg-surface-2">
              Show {Math.min(120, rows.length - limit)} more · {(rows.length - limit).toLocaleString("en-US")} older
            </button>
          )}
        </div>
      </Card>
      <EvidenceDrawer e={open} onClose={() => setOpen(null)} />
    </div>
  );
}
