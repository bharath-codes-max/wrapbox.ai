// ============================================================================
// Coverage — ONE place that answers "can Wrapbox really keep this promise?"
// Derived live from (a) the Capability Registry and (b) the contracts as they
// are right now. Intent Studio (contract badge + activation lock), the
// Coverage Map, and the store's activation guard all call this, so no screen
// can show a stale or contradictory coverage claim.
// ============================================================================

import type { ContractClause, CoverageStatus, DestinationClass, IntentContract } from "../model/types";
import { CAPABILITIES, type CapabilityDef } from "../model/registries";
import { BASELINE_KERNEL, effectiveMode, installedRules, type KernelState } from "./kernel";

type Plane = CapabilityDef["plane"];

const RANK: Record<CoverageStatus, number> = {
  ENFORCED: 0, DEGRADED: 1, UNDERSTOOD_ONLY: 2, PENDING: 3, UNINSPECTABLE: 3,
};

export function capability(id: string): CapabilityDef | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/** Worst status across the skills a promise depends on. A skill that doesn't
 *  exist, or content Wrapbox cannot inspect, means the promise can't be kept → PENDING. */
export function coverageOf(requiredCapabilities: string[]): CoverageStatus {
  let worst: CoverageStatus = "ENFORCED";
  for (const id of requiredCapabilities) {
    const raw = capability(id)?.status ?? "PENDING";
    const st: CoverageStatus = raw === "UNINSPECTABLE" ? "PENDING" : raw;
    if (RANK[st] > RANK[worst]) worst = st;
  }
  return worst;
}

export function clauseCoverage(cl: ContractClause): CoverageStatus {
  return coverageOf(cl.requiredCapabilities);
}

/** A contract is only as strong as its weakest rule. */
export function contractCoverage(c: Pick<IntentContract, "clauses">): CoverageStatus {
  return coverageOf(c.clauses.flatMap((cl) => cl.requiredCapabilities));
}

/** Activation would be a false security claim if a required skill is missing. */
export function canActivate(c: Pick<IntentContract, "clauses">): boolean {
  return contractCoverage(c) !== "PENDING";
}

// ---------------------------------------------------------------------------
// Coverage matrix
// ---------------------------------------------------------------------------

export interface CoverageRow {
  id: string;
  group: "rule" | "safety" | "gap" | "inactive";
  title: string; // plain-language promise
  source: string; // contract name / "Safety Kernel" / "Capability registry"
  dataClasses: string[];
  destination: string;
  planes: Plane[];
  needs: { id: string; label: string; status: CoverageStatus }[];
  status: CoverageStatus; // what Wrapbox can deliver for this promise
  inactiveReason?: string; // for group === "inactive"
  // For group === "gap": the live promises this weak skill is holding back.
  affects?: { rules: CoverageRow[]; safety: CoverageRow[] };
}


const DEST_LABEL: Record<DestinationClass, string> = {
  APPROVED_AI: "approved AI",
  UNAPPROVED_AI: "unapproved AI",
  APPROVED_SAAS: "approved SaaS",
  INTERNAL: "internal",
  PARTNER: "partners",
  GENERIC_EXTERNAL: "external sites",
  UNKNOWN_EXTERNAL: "unknown destinations",
};

/** "approved AI, unapproved AI, …" — a rule's "where to" in plain words. */
export function destinationText(d: ContractClause["destinations"]): string {
  if (d === "ANY") return "Anywhere";
  return d.map((x) => DEST_LABEL[x]).join(", ");
}

function needsOf(ids: string[]) {
  return ids.map((id) => {
    const c = capability(id);
    return { id, label: c?.label ?? id, status: (c?.status ?? "PENDING") as CoverageStatus };
  });
}

function planesOf(ids: string[]): Plane[] {
  const p = new Set<Plane>();
  for (const id of ids) {
    const c = capability(id);
    if (c && c.plane !== "BRAIN") p.add(c.plane);
  }
  return p.size ? [...p] : ["BRAIN"];
}

function ruleRow(c: IntentContract, cl: ContractClause, group: "rule" | "inactive"): CoverageRow {
  return {
    id: `${c.id}:${cl.id}`,
    group,
    title: cl.text,
    source: c.name,
    dataClasses: cl.dataClasses,
    destination: destinationText(cl.destinations),
    planes: planesOf(cl.requiredCapabilities),
    needs: needsOf(cl.requiredCapabilities),
    status: clauseCoverage(cl),
    inactiveReason: group === "inactive"
      ? c.status === "DRAFT" ? "Draft — not switched on" : "Switched off"
      : undefined,
  };
}

export function buildCoverageMatrix(contracts: IntentContract[], kernel: KernelState = BASELINE_KERNEL, now = Date.now()) {
  const rules = contracts
    .filter((c) => c.status === "ACTIVE")
    .flatMap((c) => c.clauses.map((cl) => ruleRow(c, cl, "rule")));

  const inactive = contracts
    .filter((c) => c.status !== "ACTIVE")
    .flatMap((c) => c.clauses.map((cl) => ruleRow(c, cl, "inactive")));

  const safety: CoverageRow[] = installedRules(kernel).map((r) => {
    const ids = r.needs;
    const observing = effectiveMode(kernel, r.ruleId, now) === "observing";
    return {
      id: r.ruleId,
      group: "safety" as const,
      title: `${r.name} — ${r.description}`,
      source: observing ? `Safety Kernel · observing (not blocking yet) · v${r.since}` : `Safety Kernel · always on · v${r.since}`,
      dataClasses: [],
      destination: "Anywhere",
      planes: planesOf(ids),
      needs: needsOf(ids),
      status: coverageOf(ids),
    };
  });

  // Every skill that is not fully enforced is a gap, whether or not a rule uses
  // it. Each gap lists the switched-on promises it holds back, and gaps are
  // sorted so the one hurting the most promises comes first (fix-first order).
  const uses = (r: CoverageRow, capId: string) => r.needs.some((n) => n.id === capId);
  const gaps: CoverageRow[] = CAPABILITIES.filter((c) => c.status !== "ENFORCED")
    .map((c) => ({
      id: c.id,
      group: "gap" as const,
      title: c.label,
      source: c.note,
      dataClasses: [],
      destination: "—",
      planes: [c.plane],
      needs: [{ id: c.id, label: c.label, status: c.status }],
      status: c.status,
      affects: { rules: rules.filter((r) => uses(r, c.id)), safety: safety.filter((r) => uses(r, c.id)) },
    }))
    .sort((a, b) =>
      (b.affects.rules.length + b.affects.safety.length) - (a.affects.rules.length + a.affects.safety.length));

  // Summary counts cover everything live: switched-on rules, always-on safety,
  // and known skill gaps. Drafts / switched-off rules are not counted.
  const counts: Record<CoverageStatus, number> = {
    ENFORCED: 0, DEGRADED: 0, UNDERSTOOD_ONLY: 0, PENDING: 0, UNINSPECTABLE: 0,
  };
  for (const r of [...rules, ...safety, ...gaps]) counts[r.status] += 1;

  return { rules, safety, gaps, inactive, counts };
}
