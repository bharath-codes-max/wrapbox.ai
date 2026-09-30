/* @wrapbox/sdk — the one governance interface a customer adds around ANY agent.
 *
 * Wrapbox does not replace the customer's agent framework (OpenAI Agents SDK, the
 * Anthropic SDK, LangGraph, or hand-written code). It is an added policy + enforcement
 * layer: every consequential tool call is checked against the SAME normalized contract
 * and evaluator Wrapbox uses in Describe, Build, the tester and the runtime — and on an
 * allow (or after human approval) it issues a signed, single-use, argument-bound permit
 * the target service verifies independently with @wrapbox/verify.
 *
 * This is real prototype code: guard() runs the canonical evaluate(); permits are minted
 * with the real ECDSA permit lifecycle. Only the transport (a network call to the policy
 * service) is simulated — the host supplies the contract through `policy()`.
 */
import { evaluate, type Act, type Ctx, type Env } from "../lib/engine";
import { mintPermit, newDecisionId, type Permit } from "../lib/permit";
import type { CategoryId, Decision } from "../data/agents";
import type { Rule } from "../data/contract";

export type { Permit } from "../lib/permit";
export type { Decision } from "../data/agents";

export interface WrapboxConfig {
  /** Workspace / tenant the agent belongs to. */
  org: string;
  /** Stable identity of the calling agent. */
  agent: string;
  /** Agent class used for rule scoping. Defaults to "custom" (your own agents). */
  category?: CategoryId;
  /** The human principal the agent is acting for. */
  onBehalfOf?: string;
  /** Where the published contract comes from. In production this is a call to the
   *  Wrapbox policy service; in the prototype the host provides it. */
  policy: () => Rule[] | Promise<Rule[]>;
  /** When the contract cannot be resolved, deny instead of allowing. Default true. */
  failClosed?: boolean;
  /** Default permit lifetime, seconds. Default 60. */
  ttlSeconds?: number;
}

export interface GuardInput {
  /** What is being touched — a claim id, file path, PR, destination, etc. */
  resource?: string;
  /** The exact call arguments. Hashed into the permit so nothing else can run under it. */
  args?: Record<string, unknown>;
  /** Provenance / delegation / CI facts the rules may require (absent = unverifiable). */
  ctx?: Ctx;
  env?: Env;
  amount?: number;
  amountUsd?: number;
  path?: string;
  command?: string;
  branch?: string;
  columns?: string[];
  destination?: string;
  credentials?: boolean;
  budget?: number;
  sql?: string;
}

export interface GuardResult {
  decision: Decision;
  /** Id of the matched rule, or "default" when nothing matched. */
  rule: string;
  reason: string;
  /** True only when the target service may proceed now (ALLOW with a permit). */
  allowed: boolean;
  /** Named approver group / quorum when the decision is REVIEW. */
  approvers?: string;
  quorum?: number;
  /** Issued immediately on ALLOW. For REVIEW, call approve() after human sign-off. */
  permit?: Permit;
}

/** Thrown by guarded executors when the contract does not allow the call. */
export class WrapboxDenied extends Error {
  constructor(public result: GuardResult) {
    super(`wrapbox: ${result.decision} · ${result.rule} — ${result.reason}`);
    this.name = "WrapboxDenied";
  }
}

export interface WrapboxClient {
  readonly config: WrapboxConfig;
  /** Check one action against the contract. Mints a permit when it is allowed outright. */
  guard(effect: string, input?: GuardInput): Promise<GuardResult>;
  /** Wrap a tool executor so it runs only on ALLOW, throwing WrapboxDenied otherwise. */
  guardTool<A extends Record<string, unknown>, R>(
    effect: string,
    impl: (args: A, permit?: Permit) => Promise<R> | R,
    map?: (args: A) => GuardInput,
  ): (args: A) => Promise<R>;
  /** After humans approve a REVIEW, mint the bound, single-use permit for the exact call. */
  approve(effect: string, input: GuardInput, approvedBy: string[], opts?: { ttlSeconds?: number }): Promise<Permit>;
}

function toAct(effect: string, input: GuardInput): Act {
  const { resource: _resource, args: _args, ...actFields } = input;
  return { effect, ...actFields };
}

export function createClient(cfg: WrapboxConfig): WrapboxClient {
  const failClosed = cfg.failClosed ?? true;
  const category = cfg.category ?? "custom";
  const defaultTtl = cfg.ttlSeconds ?? 60;

  async function resolveRules(): Promise<Rule[] | null> {
    try {
      return await cfg.policy();
    } catch {
      return null;
    }
  }

  function mint(effect: string, input: GuardInput, decisionId: string, approvedBy: string[], ttl: number): Promise<Permit> {
    return mintPermit({
      decision_id: decisionId,
      subject_agent: cfg.agent,
      on_behalf_of: cfg.onBehalfOf ?? "system",
      action: effect,
      resource: input.resource ?? effect,
      environment: input.env ?? "production",
      approved_by: approvedBy,
      args: input.args ?? {},
      ttl,
    });
  }

  async function guard(effect: string, input: GuardInput = {}): Promise<GuardResult> {
    const rules = await resolveRules();
    if (rules === null && failClosed) {
      return { decision: "BLOCK", rule: "policy.unavailable", reason: "fail-closed: the contract could not be resolved", allowed: false };
    }
    const v = evaluate(toAct(effect, input), rules ?? [], category, {});
    const result: GuardResult = {
      decision: v.decision,
      rule: v.rule,
      reason: v.reason,
      allowed: v.decision === "ALLOW",
      approvers: v.approvers,
      quorum: v.quorum,
    };
    if (v.decision === "ALLOW") result.permit = await mint(effect, input, newDecisionId(), [], defaultTtl);
    return result;
  }

  function guardTool<A extends Record<string, unknown>, R>(
    effect: string,
    impl: (args: A, permit?: Permit) => Promise<R> | R,
    map?: (args: A) => GuardInput,
  ): (args: A) => Promise<R> {
    return async (args: A) => {
      const input = map ? map(args) : { args };
      const result = await guard(effect, input);
      if (!result.allowed) throw new WrapboxDenied(result);
      return impl(args, result.permit);
    };
  }

  function approve(effect: string, input: GuardInput, approvedBy: string[], opts?: { ttlSeconds?: number }): Promise<Permit> {
    return mint(effect, input, newDecisionId(), approvedBy, opts?.ttlSeconds ?? defaultTtl);
  }

  return { config: cfg, guard, guardTool, approve };
}
