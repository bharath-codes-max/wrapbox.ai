/* The SAME Wrapbox client wraps agents from different vendors. Only the thin adapter
 * differs — the contract, the decision object and the permit lifecycle are identical.
 * Each customer keeps their own vendor SDK (@openai/agents, @anthropic-ai/sdk, LangGraph);
 * Wrapbox is the common governance layer added around it. */
import { createClient } from "@wrapbox/sdk";
import { guardFunctionTool } from "@wrapbox/openai";
import { guardNode } from "@wrapbox/langgraph";
import { INITIAL_RULES } from "../../data/contract";

const wrapbox = createClient({ org: "acme", agent: "claims-agent-prod", policy: () => INITIAL_RULES });

// OpenAI Agents SDK — keep `import { tool } from "@openai/agents"`; wrap the executor.
export const payClaimTool = guardFunctionTool(
  wrapbox,
  "claims.payout",
  async (a: { claimId: string; amountInr: number }) => ({ paid: a.claimId }),
  (a) => ({ resource: `claim:${a.claimId}`, amount: a.amountInr, args: a }),
);

// Anthropic SDK — keep `import Anthropic from "@anthropic-ai/sdk"`; guard the tool the
// model asked to run before you execute it.
export async function runAnthropicTool(a: { claimId: string; amountInr: number }) {
  const decision = await wrapbox.guard("claims.payout", { resource: `claim:${a.claimId}`, amount: a.amountInr, args: a });
  return decision.allowed ? { paid: a.claimId, permit: decision.permit } : { blocked: decision.reason };
}

// LangGraph — a REVIEW surfaces as an interrupt the graph resumes on approval.
export async function payClaimNode(a: { claimId: string; amountInr: number }) {
  return guardNode(wrapbox, "claims.payout", { resource: `claim:${a.claimId}`, amount: a.amountInr, args: a });
}
