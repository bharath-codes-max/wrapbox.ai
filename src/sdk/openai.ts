/* @wrapbox/openai — a thin adapter that governs an OpenAI Agents SDK function tool.
 *
 * The customer keeps @openai/agents exactly as-is. This wraps a tool's implementation so
 * it runs only when the SAME Wrapbox contract allows it, and passes the issued permit
 * through to the implementation. There is no separate policy engine here — it delegates to
 * the canonical WrapboxClient.
 */
import type { GuardInput, Permit, WrapboxClient } from "./wrapbox";

/** Wrap a function-tool implementation with Wrapbox governance.
 *  Returns a drop-in async function you register as the tool's `execute`. */
export function guardFunctionTool<A extends Record<string, unknown>, R>(
  client: WrapboxClient,
  effect: string,
  impl: (args: A, permit?: Permit) => Promise<R> | R,
  map?: (args: A) => GuardInput,
): (args: A) => Promise<R> {
  return client.guardTool(effect, impl, map);
}
