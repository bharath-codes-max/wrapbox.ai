/* @wrapbox/verify — what the TARGET service runs before it performs the effect.
 *
 * The permit is verified independently of the SDK: an agent that skips guard() and calls
 * the service directly presents no valid permit and is refused. Verification checks the
 * ECDSA signature, expiry, the argument binding (the exact call that was approved) and the
 * single-use nonce — the real permit lifecycle, not a decorative check.
 */
import { verifyPermit as verifyPermitChecks, type Check, type Permit } from "../lib/permit";

export type { Permit, Check } from "../lib/permit";

export interface VerifyResult {
  ok: boolean;
  checks: Check[];
}

/** Verify a permit authorizes exactly `attemptedArgs`. Consumes the nonce on success
 *  (single-use) unless `consume: false`. Use `probe: true` to test without consuming. */
export async function verifyPermit(
  permit: Permit,
  attemptedArgs: Record<string, unknown>,
  opts: { consume?: boolean; probe?: boolean } = {},
): Promise<VerifyResult> {
  const checks = await verifyPermitChecks(permit, attemptedArgs, opts);
  return { ok: checks.every((c) => c.ok), checks };
}

/** Throw unless the permit authorizes exactly this call. */
export async function assertPermit(permit: Permit, attemptedArgs: Record<string, unknown>, opts: { consume?: boolean } = {}): Promise<void> {
  const { ok, checks } = await verifyPermit(permit, attemptedArgs, opts);
  if (!ok) throw new Error("wrapbox: permit rejected — " + checks.filter((c) => !c.ok).map((c) => c.label).join(", "));
}
