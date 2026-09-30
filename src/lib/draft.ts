/* Drafting a rule from plain English.
 *
 * Order of preference:
 *   1. the server function at /api/draft-rule, when an OpenAI key is configured on the server
 *   2. the built-in deterministic parser (src/lib/describe.ts)
 *
 * The browser never sees or holds an API key — it only ever calls our own endpoint. Whatever comes
 * back is validated again here before it can reach the rule builder.
 */

import { EFFECTS, effectInfo, type Rule } from "../data/contract";
import { describeToRule, type Chip, type Draft, type Requirement } from "./describe";

export type DraftSource = "openai" | "builtin";
export interface DraftResult extends Draft {
  source: DraftSource;
  model?: string;
  /** Set when the server was tried and could not answer — the built-in parser answered instead. */
  note?: string;
}

const PREFER_KEY = "wbx-ai-drafting";
export const aiPreferred = () => {
  try {
    return localStorage.getItem(PREFER_KEY) !== "off";
  } catch {
    return true;
  }
};
export const setAiPreferred = (on: boolean) => {
  try {
    localStorage.setItem(PREFER_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked — preference lasts for this visit */
  }
};

let statusCache: { configured: boolean; model: string | null } | null = null;
/** Does the server have a key? Status only — the key itself never leaves the server. */
export async function aiStatus(force = false): Promise<{ configured: boolean; model: string | null }> {
  if (statusCache && !force) return statusCache;
  try {
    const r = await fetch("/api/draft-rule", { method: "GET" });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { configured?: boolean; model?: string | null };
    statusCache = { configured: !!j.configured, model: j.model ?? null };
  } catch {
    statusCache = { configured: false, model: null };
  }
  return statusCache;
}

const DECISIONS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];

/** Second gate: the drafted rule must fit the schema the engine actually evaluates. */
export function validateRule(rule: unknown): { ok: true; rule: Rule } | { ok: false; why: string } {
  if (!rule || typeof rule !== "object") return { ok: false, why: "no rule" };
  const r = rule as Partial<Rule> & { when?: { effect?: unknown } };
  const effect = Array.isArray(r.when?.effect) ? (r.when!.effect as string[]) : [];
  if (!effect.length) return { ok: false, why: "no effect" };
  for (const e of effect) if (!EFFECTS.some((x) => x.id === e)) return { ok: false, why: `unknown effect ${e}` };
  if (!r.id || !r.title) return { ok: false, why: "missing id or title" };
  if (r.decision && !DECISIONS.includes(r.decision)) return { ok: false, why: `unknown decision ${r.decision}` };
  if (r.tiers) {
    if (!Array.isArray(r.tiers) || !r.tiers.length) return { ok: false, why: "empty tiers" };
    for (const t of r.tiers) {
      if (!DECISIONS.includes(t.decision)) return { ok: false, why: "unknown tier decision" };
      if (t.max !== null && typeof t.max !== "number") return { ok: false, why: "tier limit is not a number" };
    }
    if (r.tiers[r.tiers.length - 1].max !== null) return { ok: false, why: "tiers must end with an open band" };
  }
  if (!r.decision && !r.tiers) return { ok: false, why: "neither a decision nor tiers" };
  if (r.constrain && r.constrain !== effectInfo(effect[0])?.constrain) return { ok: false, why: "this effect has no such safe rewrite" };
  return { ok: true, rule: r as Rule };
}

/** Draft a rule: server first when available, deterministic parser otherwise. */
export async function draftRule(sentence: string, existingIds: string[], signal?: AbortSignal): Promise<DraftResult> {
  const builtin = (note?: string): DraftResult => ({ ...describeToRule(sentence, existingIds), source: "builtin", note });
  if (!sentence.trim()) return builtin();
  if (!aiPreferred()) return builtin();
  const status = await aiStatus();
  if (!status.configured) return builtin();

  try {
    const r = await fetch("/api/draft-rule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence, existingIds }),
      signal,
    });
    if (r.status === 501) {
      statusCache = { configured: false, model: null };
      return builtin();
    }
    if (!r.ok) return builtin(`the drafting service answered ${r.status} — used the built-in parser`);
    const j = (await r.json()) as { rule?: unknown; understood?: Chip[]; unsupported?: string[]; missing?: string[]; requirements?: Requirement[]; model?: string };

    if (!j.rule) return { rule: null, understood: j.understood ?? [], unsupported: j.unsupported ?? [], missing: j.missing ?? [], requirements: j.requirements ?? [], source: "openai", model: j.model };
    const check = validateRule(j.rule);
    if (!check.ok) return builtin(`the drafted rule failed validation (${check.why}) — used the built-in parser`);
    return { rule: check.rule, understood: j.understood ?? [], unsupported: j.unsupported ?? [], missing: j.missing ?? [], requirements: j.requirements ?? [], source: "openai", model: j.model };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return builtin("could not reach the drafting service — used the built-in parser");
  }
}
