// Shared event detail drawer — the single inspection view every screen opens.
import { Drawer, DecisionChip, Payload, EvidenceChain, names, RiskChip, StatusChip, Chip, EntityCard, CardGrid } from "./kit";
import { describe } from "./describe";
import type { ReactNode } from "react";
import type { SimulationEvent } from "../model/types";
import { resolveReview, approverFor, stopOf, useAppState } from "../state/store";
import { agentById, deviceById, supplierById, userById } from "../model/org";
import { mcpServerById, planeLabel } from "../model/registries";
import {
  Info, Lightbulb, ScanSearch, FileDiff, ArrowLeftRight, UserCheck,
  ScrollText, ShieldAlert, Link2, ShieldCheck, Ban, AlertTriangle, Workflow, OctagonX,
} from "lucide-react";

/** Consistent, spacious section label used throughout the drawer. */
function SectionLabel({ icon, children, meta }: {
  icon: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="row" style={{ gap: 9, marginBottom: 14 }}>
      <span style={{ display: "inline-flex", color: "var(--fg-3)", flexShrink: 0 }}>{icon}</span>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{children}</h3>
      {meta && <span className="faint small" style={{ marginLeft: "auto", textAlign: "right" }}>{meta}</span>}
    </div>
  );
}

export function EventDetail({ e, onClose, onNavigate }: {
  e: SimulationEvent;
  onClose: () => void;
  onNavigate?: (route: string) => void;
}) {
  const s = useAppState();
  const n = names(e);
  const pending = e.reviewState?.status === "pending";
  const stopped = stopOf(e.agent, s);
  const supplier = supplierById(e.operator);
  const agentic = !!(e.mcp || e.delegation?.length || supplier || e.taint || e.untrustedRead || e.outputCheck || e.resultSeal || e.decidedBy?.layer === "killswitch");
  return (
    <Drawer onClose={onClose}>
      <div className="spread" style={{ marginBottom: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 7 }}>{planeLabel(e.plane)} event</div>
          <h2 style={{ fontSize: 20, fontWeight: 650, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {describe(e)}
          </h2>
          <div className="mono faint" style={{ fontSize: 11.5, marginTop: 6 }}>{e.action} · {n.resource}</div>
        </div>
        <DecisionChip d={e.decision} />
      </div>
      <div className="row small dim" style={{ marginBottom: 24, gap: 9 }}>
        <span className="mono">{e.id}</span>
        <span className="faint">·</span>
        <span>{new Date(e.timestamp).toLocaleString()}</span>
        <RiskChip r={e.risk} />
        {e.breakGlass && <Chip tone="critical">BREAK-GLASS</Chip>}
      </div>

      <SectionLabel icon={<Info size={15} />}>Request context</SectionLabel>
      <dl className="kv">
        <dt>User</dt><dd>{n.user}</dd>
        <dt>Device</dt><dd>{deviceById(e.device)?.name ?? e.device}</dd>
        <dt>Agent</dt><dd>{onNavigate ? <a onClick={() => onNavigate("agents")}>{n.agent}</a> : n.agent}</dd>
        {e.application && <><dt>Tool</dt><dd>{e.application}</dd></>}
        <dt>Plane</dt><dd>{planeLabel(e.plane)}</dd>
        <dt>Action</dt><dd className="mono">{e.actionRaw ?? e.action} <span className="faint">→ {e.action}</span></dd>
        <dt>Environment</dt><dd>{e.environment}</dd>
        {n.destination && <><dt>Destination</dt><dd className="row" style={{ gap: 8 }}>{n.destination} <Chip tone="neutral">{e.destinationClass}</Chip></dd></>}
        {e.dataClasses.length > 0 && (
          <><dt>Data classes</dt><dd className="row">{e.dataClasses.map((c) => <Chip key={c} tone="violet">{c}</Chip>)}</dd></>
        )}
        {e.blastRadius && <><dt>Blast radius</dt><dd className="row" style={{ gap: 8 }}>{e.blastRadius.label} <Chip tone={e.blastRadius.severity}>{e.blastRadius.severity}</Chip></dd></>}
        <dt>Capability</dt><dd><StatusChip s={e.capabilityState} /></dd>
      </dl>

      {agentic && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<Workflow size={15} />}>Agent context</SectionLabel>
          <dl className="kv agent-context">
            {e.decidedBy?.layer === "killswitch" && <><dt>Kill switch</dt><dd className="row" style={{ gap: 6 }}><OctagonX size={14} style={{ color: "var(--bad)" }} />{e.decidedBy.label.replace(/^Kill switch — /, "")}</dd></>}
            {e.mcp && <><dt>MCP call</dt><dd><span className="mono">tools/call {e.mcp.tool}</span> <span className="faint">on {mcpServerById(e.mcp.server)?.label ?? e.mcp.server}</span>{!e.mcp.registered && <> <Chip tone="critical">UNREGISTERED</Chip></>}<div className="mono small dim" style={{ marginTop: 4 }}>{Object.entries(e.mcp.args).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></dd></>}
            {e.delegation && e.delegation.length > 0 && <><dt>Delegated via</dt><dd>{[...e.delegation.map((h) => `${agentById(h.agent)?.name ?? h.agent} (“${h.asked}”)`), n.agent].join(" → ")}<div className="small faint" style={{ marginTop: 3 }}>Every agent in the chain was checked — the strictest answer wins.</div></dd></>}
            {supplier && <><dt>Operated by</dt><dd>{supplier.name} <span className="faint">· supplier · contract until {supplier.contractEnds} · scope {supplier.scopeActions.join("/")} only</span></dd></>}
            {e.taint && <><dt>Read before this</dt><dd>{e.taint.label} <span className="faint">· untrusted, {Math.max(0, Math.round((e.timestamp - e.taint.at) / 60000))} min earlier</span></dd></>}
            {e.untrustedRead && <><dt>Untrusted input</dt><dd>{e.untrustedRead.label} <span className="faint">· this agent's next risky action goes to a person</span></dd></>}
            {e.outputCheck && <><dt>Output check</dt><dd><Chip tone={e.outputCheck.status === "MATCH" ? "allow" : "review"}>{e.outputCheck.status}</Chip>{e.outputCheck.claims.map((c, i) => <div key={i} className="small" style={{ marginTop: 4 }}>{c.field}: agent says <b>{c.claimed}</b>{c.sealed !== undefined ? <> · sealed <b>{c.sealed}</b> <span className="faint">({c.source})</span></> : <span className="faint"> · nothing sealed to compare</span>}</div>)}</dd></>}
            {e.resultSeal && <><dt>Result sealed</dt><dd>{e.resultSeal.field} = <b>{e.resultSeal.value}</b> <span className="faint">· {e.resultSeal.source}</span> <span className="mono faint">{e.resultSeal.hash}</span></dd></>}
          </dl>
        </>
      )}

      <hr className="divider" />
      <SectionLabel icon={<Lightbulb size={15} />}>Why this decision</SectionLabel>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.65 }} className="small">
        {e.decisionReasons.map((r, i) => <li key={i} style={{ marginBottom: 5 }}>{r}</li>)}
      </ul>
      {e.safeAlternative && (
        <div className="card" style={{ marginTop: 14, borderColor: "var(--border-strong)", background: "var(--bg-inset)" }}>
          <div className="row" style={{ gap: 9, alignItems: "flex-start" }}>
            <ShieldCheck size={16} style={{ color: "var(--good)", flexShrink: 0, marginTop: 1 }} />
            <span className="small"><b>Safe alternative:</b> {e.safeAlternative.replace(/^Safer alternative:\s*/i, "")}</span>
          </div>
        </div>
      )}

      {e.inspection && e.inspection.inspectable && e.inspection.findings.length > 0 && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<ScanSearch size={15} />} meta={<span className="mono">{e.inspection.parser}</span>}>
            Detector findings
          </SectionLabel>
          <CardGrid cols={1}>
            {e.inspection.findings.map((f) => (
              <EntityCard
                key={f.dataClass}
                icon={<ScanSearch size={15} />}
                eyebrow={<span className="mono">{f.detector} v{f.detectorVersion}</span>}
                title={<Chip tone="violet">{f.dataClass}</Chip>}
                fields={[
                  { label: "Confidence", value: <span className="mono">{f.confidence.toFixed(2)}</span> },
                  { label: "Count", value: <span className="mono">{f.count.toLocaleString()}</span> },
                  { label: "Sample", value: <span className="mono small dim">{f.sample}</span> },
                ]}
              />
            ))}
          </CardGrid>
        </>
      )}
      {e.inspection && !e.inspection.inspectable && (
        <>
          <hr className="divider" />
          <div className="card" style={{ borderColor: "var(--bad)", background: "var(--bad-soft)" }}>
            <div className="row" style={{ gap: 9, alignItems: "flex-start" }}>
              <AlertTriangle size={16} style={{ color: "var(--bad)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <b className="small">UNINSPECTABLE</b>
                <div className="small dim" style={{ marginTop: 2 }}>{e.inspection.reason}. Inability to inspect is never treated as clean — protected requirements fail closed.</div>
              </div>
            </div>
          </div>
        </>
      )}

      {e.payloadBefore && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<FileDiff size={15} />}>
            {e.payloadAfter ? "Original vs what left the device" : e.decision === "BLOCK" ? "Original (never transmitted)" : "Payload"}
          </SectionLabel>
          <div className="grid">
            <Payload title="ORIGINAL" text={e.payloadBefore} highlight="sensitive" />
            {e.payloadAfter && <Payload title="WHAT LEFT THE DEVICE" text={e.payloadAfter} highlight="tokens" />}
            {!e.payloadAfter && e.decision === "BLOCK" && (
              <div className="row small" style={{ gap: 8, color: "var(--bad)", fontWeight: 600 }}>
                <Ban size={15} style={{ flexShrink: 0 }} />
                Blocked before transmission — the destination did not receive this content.
              </div>
            )}
          </div>
        </>
      )}

      {e.transformation && e.transformation.length > 0 && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<ArrowLeftRight size={15} />} meta={e.transformation[0].kind}>
            Transformations
          </SectionLabel>
          <CardGrid cols={1}>
            {e.transformation.map((t, i) => (
              <EntityCard
                key={i}
                icon={<ArrowLeftRight size={15} />}
                eyebrow={t.kind}
                title={t.dataClass}
                fields={[
                  { label: "Before", value: <span className="mono small">{t.before}</span> },
                  { label: "After", value: <span className="mono small"><span className="hl-tok">{t.after}</span></span> },
                ]}
              />
            ))}
          </CardGrid>
          {e.transformation.some((t) => t.tokenId) && onNavigate && (
            <div className="small dim" style={{ marginTop: 10 }}>
              Reversible tokens stored in <a onClick={() => onNavigate("vault")}>Token Vault</a> — authorized restoration only.
            </div>
          )}
        </>
      )}

      {e.reviewState && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<UserCheck size={15} />}>Review</SectionLabel>
          {pending ? (
            <>
              <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.6 }}>
                Waiting for <b>{userById(approverFor(e))?.name}</b> ({userById(approverFor(e))?.role}) · expires {new Date(e.reviewState.expiresAt).toLocaleTimeString()} · the person who asked can't approve their own request.
              </div>
              {stopped && (
                <div className="small" style={{ marginBottom: 12, color: "var(--bad)" }}>
                  {n.agent} is stopped everywhere (by {userById(stopped.by)?.name}) — this can only be denied until someone resumes it.
                </div>
              )}
              <div className="row">
                <button className="btn btn-good btn-sm" disabled={!!stopped} onClick={() => resolveReview(e.id, "approved", approverFor(e), "Approved once")}>Approve once</button>
                <button className="btn btn-sm" disabled={!!stopped} onClick={() => resolveReview(e.id, "approved_scoped", approverFor(e), "Scoped approval", "This resource only · 4h")}>Approve scoped</button>
                <button className="btn btn-warn btn-sm" disabled={!!stopped} onClick={() => resolveReview(e.id, "constrained", approverFor(e), "Constrained to safe alternative")}>Constrain</button>
                <button className="btn btn-danger btn-sm" onClick={() => resolveReview(e.id, "denied", approverFor(e), "Denied")}>Deny</button>
              </div>
            </>
          ) : (
            <dl className="kv">
              <dt>Outcome</dt><dd><StatusChip s={e.reviewState.status} /></dd>
              {e.reviewState.reviewer && <><dt>Reviewer</dt><dd>{userById(e.reviewState.reviewer)?.name ?? e.reviewState.reviewer}</dd></>}
              {e.reviewState.scope && <><dt>Scope</dt><dd>{e.reviewState.scope}</dd></>}
              {e.reviewState.note && <><dt>Note</dt><dd>{e.reviewState.note}</dd></>}
            </dl>
          )}
        </>
      )}

      {e.matchedContracts.length > 0 && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<ScrollText size={15} />}>Matched Intent Contract clauses</SectionLabel>
          <div className="grid" style={{ gap: 10 }}>
            {e.matchedContracts.map((m) => {
              const decided = e.decidedBy?.layer === "contract" && e.decidedBy.clauseId === m.clauseId;
              return (
                <div key={m.clauseId} className={`rule-item ${decided ? "decided" : ""}`}>
                  {m.effect && <DecisionChip d={m.effect} small />}
                  <div style={{ minWidth: 0 }}>
                    <div className="rule-text">“{m.clauseText}”</div>
                    <div className="rule-source">
                      {onNavigate ? <a onClick={() => onNavigate("intent")}>{m.contractName}</a> : m.contractName} · {m.clauseId}
                      {decided && <span className="rule-decided"> · this rule decided</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {e.decidedBy && e.decidedBy.layer !== "contract" && (
              <div className="small dim">Final decision came from: <b>{e.decidedBy.label}</b></div>
            )}
          </div>
        </>
      )}
      {e.safetyRules.length > 0 && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<ShieldAlert size={15} />}>Safety Kernel</SectionLabel>
          <div className="grid" style={{ gap: 10 }}>
            {e.safetyRules.map((s) => (
              <div key={s.ruleId} className="card" style={{ borderColor: "var(--bad)" }}>
                <b className="small">{s.name}</b>
                <div className="small dim" style={{ marginTop: 2 }}>{s.description}</div>
                <div className="small faint" style={{ marginTop: 4 }}>{e.decidedBy?.layer === "safety" && e.decidedBy.ruleId === s.ruleId ? "This rule made the decision — no Intent Contract was needed." : "Second lock — another rule decided this, but this rule would have blocked it on its own."}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {(e.safetyObserved?.length ?? 0) > 0 && (
        <>
          <hr className="divider" />
          <SectionLabel icon={<ShieldAlert size={15} />}>Safety Kernel — observing</SectionLabel>
          <div className="grid" style={{ gap: 10 }}>
            {e.safetyObserved!.map((s) => (
              <div key={s.ruleId} className="card kernel-observing">
                <b className="small">{s.name}</b>
                <div className="small dim" style={{ marginTop: 2 }}>{s.description}</div>
                <div className="small faint" style={{ marginTop: 4 }}>
                  New rule from a Wrapbox update, still in observe mode: it <b>would have blocked</b> this, but did not change the decision.
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <hr className="divider" />
      <SectionLabel icon={<Link2 size={15} />} meta={<span className="mono">hash {e.evidence.hash} ← {e.evidence.prevHash}</span>}>
        Evidence chain
      </SectionLabel>
      <EvidenceChain e={e} />
    </Drawer>
  );
}
