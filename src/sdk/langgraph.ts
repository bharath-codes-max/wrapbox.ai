/* @wrapbox/langgraph — LangGraph ergonomics over the SAME Wrapbox client.
 *
 * A REVIEW decision becomes a graph interrupt the run resumes on approval; ALLOW carries a
 * permit; BLOCK stops the node. Same contract, same permit lifecycle as every other adapter.
 */
import type { GuardInput, GuardResult, WrapboxClient } from "./wrapbox";

export interface GraphGuard {
  result: GuardResult;
  /** True when the graph should interrupt() and wait for a human approver. */
  interrupt: boolean;
  /** True when the node may proceed now (ALLOW with a permit). */
  proceed: boolean;
}

/** Check an action inside a LangGraph node. */
export async function guardNode(client: WrapboxClient, effect: string, input?: GuardInput): Promise<GraphGuard> {
  const result = await client.guard(effect, input);
  return { result, interrupt: result.decision === "REVIEW", proceed: result.allowed };
}
