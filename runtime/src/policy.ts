/**
 * Policy loading + re-export of the shared evaluator.
 * The ONE matcher: @wrapbox/policy-core is the same engine the control plane
 * uses — never add a second, screen- or shim-local evaluator here.
 */

import fs from "node:fs";
import { evaluate, applyProjectFilter, parseConstraint } from "@wrapbox/policy-core";
import type { Rule, ToolCall, Decision, Condition } from "@wrapbox/policy-core";
import { PATHS, FRESH_HOURS } from "./config.js";

export { evaluate, applyProjectFilter };
export type { Rule, ToolCall, Decision, Condition };
export { FRESH_HOURS };

/** A rule as cached from /v1/rules/pull — engine Rule plus its project scope. */
export type CachedRule = Rule & {
  project_id: string | null; coverageNote?: string | null;
  /** v2 provenance for evidence. */
  clause_id?: string | null; contract_id?: string | null; description?: string | null;
  meta?: { clause_id?: string; contract_id?: string; kind?: "clause" | "carrier"; coverage?: string } | null;
};

export interface CachedRules {
  rules: CachedRule[];
  pulled_at: string;
  /** true when the cache is younger than FRESH_HOURS */
  fresh: boolean;
  ageHours: number;
}

/** Parse cache/rules.json (the exact /v1/rules/pull body) into evaluator shape. */
export function loadCachedRules(): CachedRules | null {
  let raw: string;
  try {
    raw = fs.readFileSync(PATHS.rulesCache, "utf-8");
  } catch {
    return null;
  }
  let body: { rules?: any[]; pulled_at?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(body.rules) || typeof body.pulled_at !== "string") return null;

  const rules: CachedRule[] = [];
  for (const row of body.rules) {
    let condition: Condition | null = null;
    if (typeof row.condition_json === "string" && row.condition_json.trim() !== "") {
      try {
        condition = JSON.parse(row.condition_json);
      } catch {
        // An unparseable condition must NOT become "no condition" (which matches
        // everything — a narrow allow would widen). Drop the rule: with the
        // engine's block-by-default, dropping is the fail-closed choice.
        continue;
      }
    } else if (row.condition != null) {
      condition = row.condition;
    }
    // A CONSTRAIN rule carries WHAT to protect. If that is missing or
    // unparseable the rule cannot be enforced as written — the evaluator
    // downgrades it to block rather than let it read as a silent allow.
    const constraint = parseConstraint(row.constraint_json ?? null);

    rules.push({
      id: row.id,
      name: row.name,
      effect: row.effect,
      priority: row.priority,
      condition,
      constraint,
      project_id: row.project_id ?? null,
      // A degraded rule carries an honest coverage note (the bypass it cannot
      // see) in its description; the proxy surfaces it in the receipt so
      // Evidence reports the gap, not just the block/allow.
      coverageNote: typeof row.description === "string" && row.description ? row.description : null,
      description: typeof row.description === "string" ? row.description : null,
      clause_id: typeof row.clause_id === "string" ? row.clause_id : null,
      contract_id: typeof row.contract_id === "string" ? row.contract_id : null,
      meta: parseMeta(row.meta_json ?? row.meta),
    } as CachedRule);
  }

  const ageHours = (Date.now() - Date.parse(body.pulled_at)) / 3_600_000;
  return { rules, pulled_at: body.pulled_at, fresh: Number.isFinite(ageHours) && ageHours < FRESH_HOURS, ageHours };
}

function parseMeta(raw: unknown): CachedRule["meta"] {
  if (!raw) return null;
  try {
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    return m && typeof m === "object" ? (m as CachedRule["meta"]) : null;
  } catch { return null; }
}

/**
 * Would this ruleset block ordinary traffic?
 *
 * The engine is fail-closed: an action matching no rule is blocked. That is
 * correct for security and catastrophic for usability if the contract has no
 * rule that can allow anything — every connection on the machine is refused
 * and the person cannot even reach the console to fix it.
 *
 * This has now happened twice in testing. A product that lets someone brick
 * their own machine with one click is a bad product, so the daemon refuses to
 * take over the system proxy when the ruleset cannot allow ordinary traffic.
 *
 * "Can allow" means: at least one ALLOW rule that a plain request could match —
 * either a catch-all (no condition), or one whose condition is not narrowly
 * pinned to a specific payload/filename/host.
 */
export function canAllowOrdinaryTraffic(rules: CachedRule[]): boolean {
  return rules.some((r) => {
    // "constrain" forwards the request (after transforming it), so a
    // constrain catch-all does keep ordinary traffic flowing. Only block and
    // review leave the machine unusable without a human in the loop.
    if (r.effect !== "allow" && r.effect !== "constrain") return false;
    if (!r.condition) return true;   // catch-all
    const parts = Array.isArray(r.condition) ? r.condition : [r.condition];
    // A condition on content/filename/host only matches particular requests, so
    // it cannot be relied on to keep the machine online.
    return !parts.some((c) => {
      const f = String((c as { field?: unknown }).field ?? "");
      return /content_kinds|filenames|host|path|bytes/.test(f);
    });
  });
}
