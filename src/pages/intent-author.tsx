/**
 * Intent Contract — the Describe-primary authoring experience (v2 workspace).
 *
 * The admin types intent in English; Wrapbox decomposes it into atomic clauses,
 * shows exactly what it understood and how honestly each clause can be enforced
 * TODAY (enforced / degraded / understood-only / pending), and only then lets
 * them activate. There is no Build tab: Describe is primary, and the compiled
 * rules are the Advanced view.
 *
 * Activation writes only the clauses that are ENFORCED or DEGRADED today as
 * runnable Control-Plane rules — the daemon pulls those. understood-only and
 * pending clauses are retained in the contract and shown, never silently
 * dropped and never pretended-enforced.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Loader2, ShieldCheck, Sparkles, X, Trash2 } from "lucide-react";
import { Button, Card, CardHead, Chip, DecisionPill, PageHeader, cn } from "../components/ui";
import { useStore } from "../lib/store";
import { getCpConfig } from "../lib/cp-config";
import { forceCpPoll } from "../lib/cp-sync";
import { createRule, deleteRule, getCapabilities } from "../lib/cp-api";
import { authorContract, compilerStatus, type AuthorResult } from "../lib/intent/author";
import { compileToRule, carrierRule } from "../lib/intent/compile";
import { handlerDef, INVARIANT_META, type IntentClause, type BindingStatus } from "../lib/intent/schema";
import { resolveDestination, resolveBinding } from "../lib/intent/resolve";
import { setContractGroups } from "../lib/intent/destinations";
import { setRuntimeSnapshot } from "../lib/intent/snapshot";
import type { RuntimeSnapshot } from "@wrapbox/registry";

const EXAMPLE = `Engineering agents can read and edit the Acme payments repo, but cannot read .env. Pushes to main require review. Customer emails and phone numbers sent to external AI services must be tokenized. Production SQL may be read, but writes require approval and destructive schema operations are blocked. Card payments over $500 are blocked.`;

/* ------------------------------------------------------------------ *
 * Status vocabulary → colour + human label
 * ------------------------------------------------------------------ */

const STATUS_META: Record<BindingStatus, { tone: "allow" | "review" | "muted" | "block" | "accent"; label: string }> = {
  enforced: { tone: "allow", label: "Enforced" },
  degraded: { tone: "review", label: "Degraded" },
  understood_only: { tone: "muted", label: "Understood only" },
  pending: { tone: "muted", label: "Pending" },
};

export function IntentAuthor() {
  const rules = useStore((s) => s.rules);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthorResult | null>(null);
  const [llm, setLlm] = useState<{ configured: boolean; model?: string } | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [snapshotInfo, setSnapshotInfo] = useState<{ source: "default" | "device"; device?: string | null; at?: string | null }>({ source: "default" });

  useEffect(() => { void compilerStatus().then(setLlm); }, []);

  // Coverage is judged against the REAL device snapshot (what wrapboxd reported
  // with its last heartbeat) whenever the control plane has one; otherwise the
  // compiler's conservative default (built-ins only, no sidecars) applies.
  useEffect(() => {
    const cfg = getCpConfig();
    if (!cfg.orgId) return;
    void getCapabilities(cfg.orgId).then((r) => {
      if (r.ok && r.data.capabilities && typeof r.data.capabilities === "object") {
        setRuntimeSnapshot(r.data.capabilities as RuntimeSnapshot);
        setSnapshotInfo({ source: "device", device: r.data.device_id, at: r.data.capabilities_at ?? null });
      } else {
        setRuntimeSnapshot(null);
        setSnapshotInfo({ source: "default" });
      }
    });
  }, []);

  const understand = async () => {
    setBusy(true); setActivateMsg(null);
    try { setResult(await authorContract(text)); }
    finally { setBusy(false); }
  };

  const coverage = useMemo(() => {
    const c = { enforced: 0, degraded: 0, understood_only: 0, pending: 0 };
    for (const cl of result?.clauses ?? []) c[cl.binding.status] += 1;
    return c;
  }, [result]);

  /**
   * Set the approver on one REVIEW clause (or on every REVIEW clause that still
   * lacks one). Activation is gated on this being filled in — fail-closed by
   * design — so the operator needs a control here, not just a warning.
   */
  const setApprover = (clauseId: string | "all", approver: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const clauses = prev.clauses.map((c) => {
        if (c.decision !== "REVIEW") return c;
        const target = clauseId === "all" ? !c.review?.approvers?.length : c.id === clauseId;
        if (!target) return c;
        const approvers = approver ? [approver] : [];
        return {
          ...c,
          review: { ...(c.review ?? {}), failClosed: true, ...(approvers.length ? { approvers } : {}) },
          // Clear the activation gate once an approver exists; restore it if cleared.
          issues: approvers.length
            ? (c.issues ?? []).filter((i) => i.code !== "review_needs_approver")
            : [...(c.issues ?? []).filter((i) => i.code !== "review_needs_approver"),
               { severity: "block_activation" as const, code: "review_needs_approver",
                 message: "Configuration required — this REVIEW clause needs an approver before the contract can go live." }],
        };
      });
      return { ...prev, clauses, activationBlocked: clauses.some((c) => c.issues?.some((i) => i.severity === "block_activation")) };
    });
  };

  /**
   * Resolve an unenforceable protection (invariant I1). The clause is re-bound
   * so its issues and the compiled outcome (carrier rule / held / accepted)
   * change together — the UI and the daemon can never disagree.
   */
  const setUnsupported = (clauseId: string, how: "hold_activation" | "block" | "review" | "accept_risk", reason?: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const cfg = getCpConfig();
      const clauses = prev.clauses.map((c) => {
        if (c.id !== clauseId) return c;
        const next: IntentClause = { ...c, onUnsupported: how, ...(how === "accept_risk" ? { acceptRisk: { by: cfg.adminKey ? "admin" : "unknown", reason: reason ?? "", at: new Date().toISOString() } } : {}) };
        delete (next as { acceptRisk?: unknown }).acceptRisk;
        if (how === "accept_risk") next.acceptRisk = { by: "admin", reason: reason ?? "", at: new Date().toISOString() };
        next.binding = resolveBinding(next);
        // Recompute the I1 issues exactly as the validator does.
        const issues = (next.issues ?? []).filter((i) => !["protection_unenforceable", "accept_risk_unsigned", "risk_accepted", "carrier_rule"].includes(i.code));
        if (next.binding.status !== "enforced" && next.binding.status !== "degraded") {
          if (how === "hold_activation") issues.push({ severity: "block_activation", code: "protection_unenforceable", message: `Cannot be enforced as written (${next.binding.rationale}). Choose: block the carrier, require review, or accept the risk with a reason.` });
          else if (how === "accept_risk") issues.push(reason?.trim() ? { severity: "warning", code: "risk_accepted", message: `risk accepted by admin: ${reason}` } : { severity: "block_activation", code: "accept_risk_unsigned", message: "Accepting the risk needs a reason — it is recorded in evidence." });
          else issues.push({ severity: "warning", code: "carrier_rule", message: `unenforceable as written; compiled as ${how.toUpperCase()} on uploads and uninspectable bodies to its destination scope` });
        }
        next.issues = issues;
        return next;
      });
      return { ...prev, clauses, activationBlocked: clauses.some((c) => c.issues?.some((i) => i.severity === "block_activation")) };
    });
  };

  const reviewNeedingApprover = (result?.clauses ?? []).filter((c) => c.decision === "REVIEW" && !c.review?.approvers?.length).length;
  const unenforceable = (result?.clauses ?? []).filter((c) => c.issues?.some((i) => i.code === "protection_unenforceable" || i.code === "accept_risk_unsigned")).length;

  const runnable = useMemo(() => {
    // The contract's own group definitions must be in force when compiling —
    // they were registered during validation, but a hot-reload or a later
    // render can start from a fresh module instance. Re-seed from the verdict
    // so compile never resolves a group differently from validate.
    if (result) setContractGroups(result.groups);
    return (result?.clauses ?? []).map((c) => {
      const out = compileToRule(c);
      if (out.runnable) return { clause: c, out };
      // An unenforceable protection the admin chose to BLOCK/REVIEW compiles
      // to a carrier rule (uploads + uninspectable bodies to its destination).
      const carrier = carrierRule(c);
      return carrier ? { clause: c, out: { runnable: true as const, rule: carrier } } : { clause: c, out };
    });
  }, [result]);
  const willEnforce = runnable.filter((r) => r.out.runnable);

  const activate = async () => {
    if (!result || result.activationBlocked) return;
    const cfg = getCpConfig();
    setActivating(true); setActivateMsg(null);
    let created = 0;
    try {
      for (const { out } of runnable) {
        if (!out.runnable) continue;
        await createRule(cfg.orgId, {
          name: out.rule.name,
          effect: out.rule.effect,
          priority: out.rule.priority,
          condition: out.rule.condition as never,
          ...(out.rule.constraint ? { constraint: out.rule.constraint } : {}),
          ...(out.rule.description ? { description: out.rule.description } : {}),
          clause_id: out.rule.clause_id,
          meta: out.rule.meta,
        });
        created += 1;
      }
      await forceCpPoll();
      const held = result.clauses.length - created;
      setActivateMsg(`Activated ${created} clause${created === 1 ? "" : "s"} on the live contract.${held > 0 ? ` ${held} clause${held === 1 ? " is" : "s are"} retained but not enforceable yet (see status).` : ""}`);
    } catch (e) {
      setActivateMsg(`Could not activate: ${(e as Error).message}`);
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="Live · Control Plane"
        title="Intent contract"
        sub="Describe what agents may do, in plain English. Wrapbox splits it into atomic permissions, tells you exactly what it can enforce today, and activates only what it can actually prove — nothing is silently allowed or blocked."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* ─────────────── LEFT: author + what was understood ─────────────── */}
        <div className="space-y-5 min-w-0">
          <Card className="overflow-hidden">
            <CardHead
              title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-accent" />Describe your intent</span>}
              sub="Plain English. One sentence per permission, or a whole paragraph — it is split into atomic clauses."
              right={<span className="font-mono text-[11px] text-fg-3">{llm ? (llm.configured ? llm.model ?? "llm" : "built-in") : ""}</span>}
            />
            <div className="border-t border-line p-5">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Engineering agents can edit the payments repo but not .env. Customer emails sent to external AI must be tokenized. Payments over $500 are blocked."
                className="w-full min-h-[132px] resize-y rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:border-line-strong"
              />
              <div className="mt-3 flex items-center gap-3">
                <Button variant="primary" onClick={understand} disabled={busy || text.trim().length < 8}>
                  {busy ? <><Loader2 className="size-3.5 animate-spin" /> Understanding…</> : <><ArrowRight className="size-3.5" /> Understand this</>}
                </Button>
                <button onClick={() => setText(EXAMPLE)} className="text-[12px] text-fg-3 hover:text-fg underline-offset-2 hover:underline">
                  Use the example
                </button>
              </div>
            </div>
          </Card>

          {result && (
            <Card className="overflow-hidden">
              <CardHead
                title={`${result.clauses.length} clause${result.clauses.length === 1 ? "" : "s"} understood`}
                sub="Draft — nothing here is enforcing yet. Highest-priority matching clause wins · default BLOCK (fail closed)"
                right={<span className="font-mono text-[11px] text-fg-3">{result.source === "llm" ? "llm-compiled" : "built-in segmenter"}</span>}
              />
              {(result.groups.length > 0 || result.invariants.length > 0) && (
                <div className="border-t border-line bg-surface-2 px-5 py-3 space-y-1.5">
                  {result.groups.map((g) => (
                    <div key={g.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="font-mono text-[11px] text-fg-3">group</span>
                      <span className="font-medium">{g.label}</span>
                      <span className="font-mono text-[11.5px] text-fg-2">= [{g.members.join(", ")}]</span>
                    </div>
                  ))}
                  {result.invariants.map((inv) => (
                    <div key={inv} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="font-mono text-[11px] text-fg-3">invariant</span>
                      <span className="font-medium">{INVARIANT_META[inv].label}</span>
                      <Chip tone="allow">Enforced by the runtime</Chip>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-line divide-y divide-line">
                {result.clauses.map((c) => (
                  <ClauseRow key={c.id} clause={c} onApprover={(v) => setApprover(c.id, v)} onUnsupported={(how, reason) => setUnsupported(c.id, how, reason)} />
                ))}
                {result.clauses.length === 0 && (
                  <div className="px-5 py-8 text-center text-[12.5px] text-fg-3">Nothing could be read as a permission.</div>
                )}
              </div>

              {result.rejected.length > 0 && (
                <div className="border-t border-line bg-surface-2 px-5 py-4">
                  <div className="text-[12px] font-medium text-fg-2">Not turned into a clause ({result.rejected.length})</div>
                  <div className="mt-2 space-y-1.5">
                    {result.rejected.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px] text-fg-3">
                        <X className="mt-0.5 size-3.5 shrink-0 text-block" />
                        <span>“{r.text}” — {r.reason}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-fg-3">Preserved as understood but not compiled — Wrapbox never guesses a permission it did not clearly read.</div>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="border-t border-line px-5 py-3 text-[11.5px] text-fg-3 space-y-1">
                  {result.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* ─────────────── RIGHT: coverage, activation, live contract ─────────────── */}
        <div className="space-y-5 min-w-0">
          {result && (
            <>
              <Card className="overflow-hidden">
                <CardHead title="What can be enforced today" sub={snapshotInfo.source === "device" ? `Judged against the runtime snapshot device ${snapshotInfo.device ?? ""} reported${snapshotInfo.at ? ` at ${snapshotInfo.at}` : ""}.` : "Judged against the compiler's conservative default runtime (built-in detectors only, no sidecars) — no device snapshot on the control plane yet."} />
                <div className="border-t border-line px-5 py-4">
                  <CoverageRows coverage={coverage} total={result.clauses.length} />
                  {result.note && <div className="mt-3 text-[11px] text-fg-3">{result.note}</div>}
                </div>
              </Card>

              <Card className="overflow-hidden">
                <CardHead
                  title="Activation"
                  sub={`${willEnforce.length} of ${result.clauses.length} clause${result.clauses.length === 1 ? "" : "s"} can be enforced now`}
                />
                <div className="border-t border-line p-5">
                  {result.activationBlocked && (
                    <div className="mb-4 rounded-lg border border-[#c98a1a]/40 bg-[#c98a1a]/10 px-3.5 py-3 text-[12.5px] text-[#8a5a0a] dark:text-[#e6b866]">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <span className="font-medium">Configuration required.</span>{" "}
                          {reviewNeedingApprover > 0 && <>{reviewNeedingApprover} REVIEW clause{reviewNeedingApprover === 1 ? "" : "s"} still need{reviewNeedingApprover === 1 ? "s" : ""} an approver. </>}
                          {unenforceable > 0 && <>{unenforceable} protection{unenforceable === 1 ? "" : "s"} cannot be enforced on the deployed runtime — choose what happens instead (block the carrier, review, or accept the risk). </>}
                          This stays a draft — your active contract is untouched.
                        </div>
                      </div>
                      {reviewNeedingApprover > 1 && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
                          <span className="text-[11.5px]">Apply to all {reviewNeedingApprover}:</span>
                          <ApproverSelect value="" onChange={(v) => v && setApprover("all", v)} />
                        </div>
                      )}
                    </div>
                  )}

                  <Button variant="primary" onClick={activate} disabled={activating || result.activationBlocked || willEnforce.length === 0}>
                    {activating ? <><Loader2 className="size-3.5 animate-spin" /> Activating…</> : <><ShieldCheck className="size-3.5" /> Activate {willEnforce.length} on the fleet</>}
                  </Button>
                  {willEnforce.length < result.clauses.length && (
                    <div className="mt-2.5 text-[11.5px] text-fg-3">
                      The remaining {result.clauses.length - willEnforce.length} are retained in the contract and begin enforcing the day their plane ships.
                    </div>
                  )}
                  {activateMsg && <div className="mt-3 text-[12px] text-allow">{activateMsg}</div>}

                  <button onClick={() => setShowAdvanced((v) => !v)} className="mt-4 flex items-center gap-1 text-[11.5px] text-fg-3 hover:text-fg">
                    <ChevronDown className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} /> Advanced · compiled rules
                  </button>
                  {showAdvanced && (
                    <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
{JSON.stringify(willEnforce.map((r) => (r.out.runnable ? r.out.rule : null)).filter(Boolean), null, 2)}
                    </pre>
                  )}
                </div>
              </Card>
            </>
          )}

          <Card className="overflow-hidden">
            <CardHead
              title="Active contract"
              sub={`${rules.length} rule${rules.length === 1 ? "" : "s"} enforcing on your fleet`}
              right={<span className="font-mono text-[11px] text-fg-3">default: BLOCK</span>}
            />
            <div className="border-t border-line">
              {rules.length === 0 ? (
                <div className="px-5 py-8 text-center text-[12.5px] text-fg-3">
                  Nothing active yet. Describe your intent and activate it.
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {rules.map((r) => <ActiveRuleRow key={r.id} id={r.id} title={r.title} decision={r.decision ?? "BLOCK"} />)}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/** Status breakdown as a small labelled bar + rows, matching the app's
 *  metric-row convention rather than a dense inline strip. */
function CoverageRows({ coverage, total }: { coverage: Record<BindingStatus, number>; total: number }) {
  const items: { k: BindingStatus; hint: string }[] = [
    { k: "enforced", hint: "running on the fleet now" },
    { k: "degraded", hint: "enforced where observed; a route bypasses it" },
    { k: "understood_only", hint: "retained; its plane is not deployed" },
    { k: "pending", hint: "no plane can host it yet" },
  ];
  const bar = [
    { n: coverage.enforced, cls: "bg-allow" },
    { n: coverage.degraded, cls: "bg-review" },
    { n: coverage.understood_only, cls: "bg-fg-3/35" },
    { n: coverage.pending, cls: "bg-fg-3/20" },
  ].filter((s) => s.n > 0);

  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
        {bar.map((s, i) => <div key={i} className={cn("h-full", s.cls)} style={{ width: `${(s.n / Math.max(total, 1)) * 100}%` }} />)}
      </div>
      <dl className="mt-3 space-y-2">
        {items.map(({ k, hint }) => (
          <div key={k} className="flex items-baseline gap-2.5">
            <span className={cn("mt-1 size-2 shrink-0 rounded-full", k === "enforced" ? "bg-allow" : k === "degraded" ? "bg-review" : "bg-fg-3/35")} />
            <dt className={cn("text-[12.5px] tnum font-medium w-6", coverage[k] ? "text-fg" : "text-fg-3")}>{coverage[k]}</dt>
            <dd className="min-w-0 flex-1">
              <span className={cn("text-[12.5px]", coverage[k] ? "text-fg-2" : "text-fg-3")}>{STATUS_META[k].label}</span>
              <span className="block text-[11px] text-fg-3">{hint}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Approver groups offered for a REVIEW clause. A real deployment would read
 * these from the org's directory; the point here is that the operator gets an
 * actual control on the clause rather than only being told it is missing.
 */
const APPROVER_GROUPS = ["secops", "security-oncall", "data-oncall", "sre-oncall", "eng-manager", "compliance", "admin"];

function ApproverSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] outline-none focus:border-line-strong"
    >
      <option value="">Select approver…</option>
      {APPROVER_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  );
}

function ClauseRow({ clause: c, onApprover, onUnsupported }: { clause: IntentClause; onApprover?: (v: string) => void; onUnsupported?: (how: "hold_activation" | "block" | "review" | "accept_risk", reason?: string) => void }) {
  const [riskReason, setRiskReason] = useState("");
  const unenforceableIssue = c.issues?.find((i) => i.code === "protection_unenforceable" || i.code === "accept_risk_unsigned" || i.code === "carrier_rule" || i.code === "risk_accepted");
  const meta = STATUS_META[c.binding.status];
  const verb = c.action.verbs?.[0] ?? (c.action.any ? "any action" : "—");
  const res = c.resource.ref?.[0] ?? (c.resource.path?.include?.join(", ")) ?? c.resource.type ?? "any";
  const subj = subjectLabel(c);
  const constraintText = c.constraint?.handlers.map((h) => handlerDef(h.handler)?.summary(h.params) ?? h.handler).join(" · ");
  const effDiffers = c.binding.effectiveDecision !== c.decision;
  const blockIssue = c.issues?.find((i) => i.severity === "block_activation");
  const warnIssues = (c.issues ?? []).filter((i) => i.severity === "warning");
  const dest = c.destination ? resolveDestination(c) : null;
  const destLabel = c.destination?.service?.length ? c.destination.service.join(", ")
    : c.destination?.classes?.length ? c.destination.classes.join("|").replace(/_/g, " ").toLowerCase()
    : c.destination?.group ? `group ${c.destination.group}`
    : c.destination?.notIn ? `NOT IN ${c.destination.notIn.group ?? c.destination.notIn.service?.join(", ") ?? c.destination.notIn.host?.join(", ")}`
    : c.destination?.category?.length ? `any ${c.destination.category.join(", ").replace(/_/g, " ")}`
    : c.destination?.namedSet ? c.destination.namedSet : null;

  return (
    <div className={cn("px-5 py-4", blockIssue && "bg-[#c98a1a]/[0.04]")}>
      <div className="flex items-start gap-3">
        <DecisionPill d={c.decision} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug">
            <span className="text-fg-3">{subj} · </span>{verb}{" "}
            <span className="font-mono text-[12px]">{res}</span>
            {destLabel && <span className="text-fg-3"> → {destLabel}</span>}
            {c.data?.classes?.length ? <span className="text-fg-3"> · {c.data.classes.join(", ")}{c.data.match && (c.data.match.minCount > 1 || c.data.match.origin === "clause") ? ` (≥${c.data.match.minCount}, ${c.data.match.minConfidence})` : ""}</span> : null}
            {c.scope?.environment?.length ? <span className="text-fg-3"> · {c.scope.environment.join(",")}</span> : null}
          </div>
          {constraintText && <div className="mt-0.5 text-[11.5px] text-constrain">↳ {constraintText}</div>}
          {c.source?.text && <div className="mt-1 text-[11px] text-fg-3 italic truncate">“{c.source.text}”</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip tone={meta.tone}>{meta.label}</Chip>
          <span className="font-mono text-[10.5px] text-fg-3">{c.binding.plane ?? "no plane"}</span>
        </div>
      </div>

      {/* honesty line */}
      <div className="mt-2 pl-[3.25rem] text-[11.5px] leading-relaxed text-fg-3">
        {effDiffers && (
          <div className="mb-0.5 text-block">Effective today: <span className="font-medium">{c.binding.effectiveDecision}</span> — {c.binding.status === "pending" ? "cannot be applied" : "the requested form cannot be enforced, so it fails closed"}.</div>
        )}
        {c.binding.status === "degraded" && c.binding.coverageGap && (
          <div><span className="font-medium text-review">Coverage gap:</span> {c.binding.coverageGap}</div>
        )}
        {c.binding.status !== "degraded" && <div>{c.binding.rationale}</div>}
        {dest && (dest.hosts.length > 0 || dest.notHosts.length > 0) && (
          <div className="mt-0.5 font-mono text-[10.5px]">
            host {dest.hosts.length ? `∈ {${dest.hosts.join(", ")}}` : `∉ {${dest.notHosts.join(", ")}}`}
          </div>
        )}
        {c.binding.unenforcedFacets?.length ? (
          <div className="mt-0.5"><span className="font-medium">Not enforced:</span> {c.binding.unenforcedFacets.join(", ")}</div>
        ) : null}
        {c.exceptions?.length ? <div className="mt-0.5">exceptions kept: {c.exceptions.join("; ")}</div> : null}
        {warnIssues.map((i) => <div key={i.code} className="mt-0.5 text-review">⚠ {i.message}</div>)}
      </div>

      {/* REVIEW needs a human. Give the operator the control, not just the warning. */}
      {c.decision === "REVIEW" && (
        <div className="mt-2.5 ml-[3.25rem] flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] text-fg-3">Approver:</span>
          <ApproverSelect value={c.review?.approvers?.[0] ?? ""} onChange={(v) => onApprover?.(v)} />
          {c.review?.approvers?.length ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-allow"><Check className="size-3" /> configured</span>
          ) : (
            <span className="text-[11.5px] text-[#8a5a0a] dark:text-[#e6b866]">required before this contract can go live</span>
          )}
        </div>
      )}

      {/* INVARIANT I1 — a protection the runtime cannot enforce never rides the
          catch-all silently. The operator chooses what happens instead. */}
      {c.decision !== "ALLOW" && unenforceableIssue && onUnsupported && (
        <div className="mt-2.5 ml-[3.25rem] rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[11.5px]">
          <div className="text-fg-2">This protection cannot be enforced as written on the deployed runtime. Until it can, Wrapbox will:</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <select
              value={c.onUnsupported ?? "hold_activation"}
              onChange={(e) => onUnsupported(e.target.value as "hold_activation" | "block" | "review" | "accept_risk", riskReason)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] outline-none focus:border-line-strong"
            >
              <option value="hold_activation">hold activation (default — contract stays a draft)</option>
              <option value="block">block uploads and uninspectable bodies to this destination</option>
              <option value="review">send uploads and uninspectable bodies to this destination for review</option>
              <option value="accept_risk">accept the risk (recorded in evidence with a reason)</option>
            </select>
            {c.onUnsupported === "accept_risk" && (
              <input value={riskReason} onChange={(e) => setRiskReason(e.target.value)} onBlur={() => onUnsupported("accept_risk", riskReason)} placeholder="reason (required)"
                className="min-w-[220px] rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] outline-none focus:border-line-strong" />
            )}
          </div>
          <div className="mt-1 text-[10.5px] text-fg-3">{c.binding.rationale}</div>
        </div>
      )}

      {/* Provenance: every sentence that collapsed into this one clause. */}
      {(c.sources?.length ?? 0) > 1 && (
        <div className="mt-2 ml-[3.25rem] text-[11px] text-fg-3">
          merged from {c.sources!.length} phrases: {c.sources!.map((s) => `“${s.text.slice(0, 28)}”`).join(", ")}
        </div>
      )}
    </div>
  );
}

function subjectLabel(c: IntentClause): string {
  const s = c.subject;
  if (s.any) return "any agent";
  const bits = [...(s.group ?? []), ...(s.agentId ?? []), ...(s.agentClass ?? []).map(prettyClass)];
  return bits.join("/") || "any agent";
}
function prettyClass(k: string): string {
  return ({ browser_chat: "browser", cli_agent: "CLI", ide_agent: "IDE", mcp_tool: "MCP", background_workload: "workload", human: "human" } as Record<string, string>)[k] ?? k;
}

function ActiveRuleRow({ id, title, decision }: { id: string; title: string; decision: Parameters<typeof DecisionPill>[0]["d"] }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    setRemoving(true);
    try { await deleteRule(id); await forceCpPoll(); } finally { setRemoving(false); setConfirming(false); }
  };
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <DecisionPill d={decision} size="sm" />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{title}</span>
      {confirming ? (
        <span className="flex items-center gap-1.5">
          <button onClick={remove} disabled={removing} className="rounded-md bg-block px-2 py-1 text-[11px] font-medium text-white hover:opacity-90">
            {removing ? "Removing…" : "Delete"}
          </button>
          <button onClick={() => setConfirming(false)} className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-3 hover:text-fg">Cancel</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-fg-3 hover:text-block" title="Remove rule">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
