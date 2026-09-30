import type { CategoryId, Decision } from "../data/agents";
import type { Rule } from "../data/contract";
import { evaluate, type Act } from "./engine";

export interface ReplayResult {
  total: number;
  changed: number;
  newlyBlocked: number;
  newlyReview: number;
  newlyAllowed: number;
  /** Span of the replayed log in days (0 when the log is empty). */
  days: number;
  samples: { rule: string; action: string; from: Decision; to: Decision }[];
}

/** Re-decide every recorded action under the draft and under what's live. The same evaluator the runtime uses, over
 *  the workspace's own decision log — so the numbers a person sees before publishing are the numbers they'd get. */
export function replayLog(draft: Rule[], published: Rule[], log: { act?: Act; action: string; ts: number; agentId: string }[], category: (agentId: string) => CategoryId): ReplayResult {
  const res: ReplayResult = { total: 0, changed: 0, newlyBlocked: 0, newlyReview: 0, newlyAllowed: 0, days: 0, samples: [] };
  const seen = new Set<string>();
  let oldest = Infinity;
  for (const e of log) {
    if (!e.act) continue;
    res.total++;
    oldest = Math.min(oldest, e.ts);
    const cat = category(e.agentId);
    const from = evaluate(e.act, published, cat).decision;
    const after = evaluate(e.act, draft, cat);
    if (from === after.decision) continue;
    res.changed++;
    if (after.decision === "BLOCK") res.newlyBlocked++;
    else if (after.decision === "REVIEW" || after.decision === "CONSTRAIN") res.newlyReview++;
    else res.newlyAllowed++;
    const key = `${e.action}|${from}|${after.decision}`;
    if (res.samples.length < 6 && !seen.has(key)) {
      seen.add(key);
      res.samples.push({ rule: after.rule, action: e.action, from, to: after.decision });
    }
  }
  res.days = res.total ? Math.max(1, Math.round((Date.now() - oldest) / 86_400_000)) : 0;
  return res;
}
