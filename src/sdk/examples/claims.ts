/* A hand-written claims agent governed by @wrapbox/sdk, and the payment service that
 * verifies the permit with @wrapbox/verify. This file compiles and is exercised by the
 * SDK tests; Step 4 renders it verbatim, so the UI can never drift from the real API. */
import { createClient, WrapboxDenied, type Permit } from "@wrapbox/sdk";
import { verifyPermit } from "@wrapbox/verify";
import { INITIAL_RULES } from "../../data/contract";

// In production this fetches your workspace contract from Wrapbox.
// Here it returns the same normalized contract the rest of Wrapbox evaluates.
const wrapbox = createClient({
  org: "acme",
  agent: "claims-agent-prod",
  onBehalfOf: "priya@acme.com",
  policy: () => INITIAL_RULES,
});

// 1 · Before it pays a claim, the agent asks Wrapbox.
export async function payClaim(claimId: string, amountInr: number) {
  const decision = await wrapbox.guard("claims.payout", {
    resource: `claim:${claimId}`,
    amount: amountInr,
    args: { claimId, amountInr },
  });

  // 2 · Wrapbox returns the real decision from the contract.
  if (decision.decision === "REVIEW") {
    // hand off to the approvers Wrapbox named; resume with a permit once signed off
    return { status: "held", approvers: decision.approvers } as const;
  }
  if (!decision.allowed) throw new WrapboxDenied(decision);

  // 3 · ALLOW → decision.permit is signed, single-use and bound to these exact args.
  return paymentService({ claimId, amountInr }, decision.permit!);
}

// After human approval of a REVIEW, mint the permit for the exact approved call.
export async function payApprovedClaim(claimId: string, amountInr: number, approvers: string[]) {
  const permit = await wrapbox.approve(
    "claims.payout",
    { resource: `claim:${claimId}`, args: { claimId, amountInr } },
    approvers,
  );
  return paymentService({ claimId, amountInr }, permit);
}

// 4 · The payment service verifies the permit before it moves money — independently of
//     the SDK, so an agent that skips the check is refused here.
export async function paymentService(args: { claimId: string; amountInr: number }, permit: Permit) {
  const { ok, checks } = await verifyPermit(permit, args); // signature · expiry · args · single-use
  if (!ok) return { status: "rejected", checks } as const;
  return { status: "paid", claimId: args.claimId } as const;
}
