// ============================================================================
// Safety Kernel — Wrapbox-managed, versioned baseline rule pack.
//
// WHO WRITES THESE: Wrapbox's own security team (not the customer). Customers
// see every rule but cannot edit or delete one — the same model as Microsoft
// Purview built-in sensitive info types, Amazon Macie managed data
// identifiers, and AWS WAF managed rule groups.
//
// HOW THEY SHIP: as versioned releases with notes. Following AWS WAF's
// guidance for new managed-rule versions ("set rules to count … while you
// figure out how you want to handle the new behavior"), a rule that arrives in
// an update starts in OBSERVE mode: it records "would have blocked" without
// changing any decision, then moves to ENFORCE — automatically after the
// observation window, or earlier if the admin chooses.
//
// TO ADD A RULE (Wrapbox developer): add a KERNEL_RULES entry and list it in a
// new KERNEL_RELEASES entry. The brain, Coverage Map, Safety Kernel page,
// evidence and tests pick it up from here.
// ============================================================================

import type {
  ActionVerb, BlastRadius, DestinationClass, Environment, EventContext,
  SafetyRuleHit, SimulationEvent,
} from "../model/types";

/** The facts a kernel rule looks at — available both at decision time and
 *  from a recorded event, so an observed rule can be replayed over history. */
export interface KernelFacts {
  action: ActionVerb;
  actionRaw?: string;
  environment: Environment;
  destinationClass?: DestinationClass;
  dataClasses: string[];
  sensitivity: EventContext["resourceSensitivity"];
  rows?: number;
  severity?: BlastRadius["severity"];
}

export interface KernelRule {
  ruleId: string;
  name: string;
  description: string;
  since: string; // release that introduced it
  needs: string[]; // capability ids it depends on (Coverage Map)
  test: (f: KernelFacts) => boolean;
}

const SENSITIVE = (c: string) =>
  c.startsWith("CREDENTIAL.") || c.startsWith("PCI.") || c.startsWith("HEALTH.") ||
  c.startsWith("FINANCIAL.") || c.startsWith("LEGAL.") || c.startsWith("HR.") ||
  c === "PII.SSN" || c === "CUSTOM.CUSTOMER_ID" || c === "COMPANY.TRADE_SECRET";

const SENDS = (a: ActionVerb) => a === "NETWORK_SEND" || a === "DATA_EXPORT";

export const KERNEL_RULES: KernelRule[] = [
  {
    ruleId: "sk-cred-exfil", since: "2026.09.1",
    name: "Credential exfiltration",
    description: "Credentials must not leave the device to any external destination.",
    needs: ["cap-net-https", "cap-net-file"],
    test: (f) => f.dataClasses.some((c) => c.startsWith("CREDENTIAL.")) && SENDS(f.action)
      && f.destinationClass !== undefined && f.destinationClass !== "INTERNAL",
  },
  {
    ruleId: "sk-destructive-prod", since: "2026.09.1",
    name: "Destructive production mutation",
    description: "Irreversible destructive operations against customer-impacting production resources.",
    needs: ["cap-gw-sql", "cap-gw-cloud"],
    test: (f) => f.action === "DELETE" && f.environment === "production" && f.sensitivity === "customer-impacting",
  },
  {
    ruleId: "sk-security-change", since: "2026.09.1",
    name: "Security-control change",
    description: "Disabling or weakening a security control (SIP, Gatekeeper, EDR, Wrapbox itself).",
    needs: ["cap-ep-exec"],
    test: (f) => f.action === "SECURITY_CHANGE",
  },
  {
    ruleId: "sk-perm-escalation", since: "2026.09.1",
    name: "Dangerous permission change",
    description: "Granting broad administrative authority to an identity or role.",
    needs: ["cap-gw-cloud"],
    test: (f) => f.action === "PERMISSION_CHANGE" && f.severity === "critical",
  },
  {
    ruleId: "sk-mass-export", since: "2026.09.1",
    name: "Mass data export",
    description: "Bulk export of records far beyond normal working scope.",
    needs: ["cap-gw-sql"],
    test: (f) => f.action === "DATA_EXPORT" && (f.rows ?? 0) >= 100_000,
  },
  {
    ruleId: "sk-unknown-highrisk", since: "2026.09.1",
    name: "Unknown high-risk external transfer",
    description: "Sensitive data classes flowing to an unclassified external endpoint.",
    needs: ["cap-net-https"],
    test: (f) => f.destinationClass === "UNKNOWN_EXTERNAL" && f.dataClasses.some(SENSITIVE),
  },
  {
    ruleId: "sk-history-rewrite", since: "2026.09.2",
    name: "Protected history rewrite",
    description: "Force-pushing over a production branch rewrites shared history and can erase other people's work.",
    needs: ["cap-gw-github"],
    test: (f) => f.action === "WRITE" && f.environment === "production"
      && /--force(-with-lease)?\b|push\s+-f\b/.test(f.actionRaw ?? ""),
  },
];

export interface KernelRelease {
  version: string;
  date: string; // ISO date
  adds: string[]; // rule ids introduced
  notes: string[];
}

export const KERNEL_RELEASES: KernelRelease[] = [
  {
    version: "2026.09.1", date: "2026-09-02",
    adds: ["sk-cred-exfil", "sk-destructive-prod", "sk-security-change", "sk-perm-escalation", "sk-mass-export", "sk-unknown-highrisk"],
    notes: ["Initial baseline: six always-on protections for credentials, destructive changes, security controls, permissions, bulk export and unknown destinations."],
  },
  {
    version: "2026.09.2", date: "2026-09-23",
    adds: ["sk-history-rewrite"],
    notes: [
      "New rule: Protected history rewrite — blocks force-pushes over production branches.",
      "Why: coding agents can rewrite shared git history in one command; recovery needs every collaborator's local copy.",
      "Safer path Wrapbox suggests: push a new branch and open a pull request, or revert instead of rewriting.",
    ],
  },
];

export type KernelMode = "enforcing" | "observing";

export interface KernelState {
  version: string;
  modes: Record<string, KernelMode>; // installed rules only
  observeUntil: Record<string, number>; // when an observing rule starts enforcing on its own
}

export const OBSERVE_WINDOW_DAYS = 7;

export const BASELINE_KERNEL: KernelState = {
  version: "2026.09.1",
  modes: Object.fromEntries(KERNEL_RELEASES[0].adds.map((id) => [id, "enforcing"])),
  observeUntil: {},
};

const vnum = (v: string) => v.split(".").map(Number).reduce((a, n) => a * 1000 + n, 0);

export function kernelRule(id: string): KernelRule | undefined {
  return KERNEL_RULES.find((r) => r.ruleId === id);
}

export function installedRules(k: KernelState): KernelRule[] {
  return KERNEL_RULES.filter((r) => k.modes[r.ruleId]);
}

/** The next release this customer hasn't installed yet, if any. */
export function pendingRelease(k: KernelState): KernelRelease | undefined {
  return KERNEL_RELEASES.find((r) => vnum(r.version) > vnum(k.version));
}

/** Installing adds the release's new rules in OBSERVE mode. */
export function installRelease(k: KernelState, rel: KernelRelease, now: number): KernelState {
  const modes = { ...k.modes };
  const observeUntil = { ...k.observeUntil };
  for (const id of rel.adds) {
    if (!modes[id]) {
      modes[id] = "observing";
      observeUntil[id] = now + OBSERVE_WINDOW_DAYS * 24 * 3600 * 1000;
    }
  }
  return { version: rel.version, modes, observeUntil };
}

export function enforceRule(k: KernelState, ruleId: string): KernelState {
  if (k.modes[ruleId] !== "observing") return k;
  const observeUntil = { ...k.observeUntil };
  delete observeUntil[ruleId];
  return { ...k, modes: { ...k.modes, [ruleId]: "enforcing" }, observeUntil };
}

/** An observing rule whose window has passed is enforcing. */
export function effectiveMode(k: KernelState, ruleId: string, now: number): KernelMode | undefined {
  const m = k.modes[ruleId];
  if (m === "observing" && (k.observeUntil[ruleId] ?? Infinity) <= now) return "enforcing";
  return m;
}

const hit = (r: KernelRule): SafetyRuleHit => ({ ruleId: r.ruleId, name: r.name, description: r.description });

/** Which installed rules fire: enforcing ones change the decision, observing
 *  ones are only recorded as "would have blocked". */
export function kernelHits(f: KernelFacts, k: KernelState, now: number) {
  const enforced: SafetyRuleHit[] = [];
  const observed: SafetyRuleHit[] = [];
  for (const r of installedRules(k)) {
    if (!r.test(f)) continue;
    (effectiveMode(k, r.ruleId, now) === "enforcing" ? enforced : observed).push(hit(r));
  }
  return { enforced, observed };
}

/** Rebuild the facts from a recorded event (for replaying a rule over history). */
export function factsFromEvent(e: SimulationEvent): KernelFacts {
  return {
    action: e.action,
    actionRaw: e.actionRaw,
    environment: e.environment,
    destinationClass: e.destinationClass,
    dataClasses: e.inspection?.inspectable ? e.inspection.findings.map((x) => x.dataClass) : [],
    sensitivity: e.context.resourceSensitivity,
    rows: e.blastRadius?.rows,
    severity: e.blastRadius?.severity,
  };
}
