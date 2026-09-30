/**
 * Trusted Identity Provider Registry (§8, §25).
 *
 * Fixes the "employees → degraded" case GENERICALLY. Identity is never inferred
 * from a User-Agent, prompt text, filename, or any browser header — those are
 * attacker-controllable. A provider declares which identity signals it can
 * PROVE and at what assurance. The capability system then asks "can we prove
 * identity.user?" and derives status; there is no hand-written "if subject is
 * scoped" branch.
 *
 * For the Network MVP the only real provider is device enrollment: the daemon
 * runs on an enrolled device with a signing key, so it can prove the DEVICE,
 * not the human at the keyboard. That distinction is reported exactly:
 *   identity.device → provable        identity.user → not provable
 *
 * Entra/Okta, MDM, and workload identity plug into the same interface later
 * without touching intent parsing.
 */

export type AssuranceLevel = "none" | "low" | "medium" | "high";

export interface IdentityContext {
  deviceId?: string;
  userId?: string;
  groups?: string[];
  tenantId?: string;
  workloadId?: string;
  assuranceLevel: AssuranceLevel;
  source: string;
}

export interface IdentityProvider {
  id: string;
  /** The identity capabilities this provider can PROVE, e.g.
   *  ["identity.device"] for device enrollment, ["identity.user",
   *  "identity.group"] for an enterprise IdP. */
  proves: string[];
  assurance: AssuranceLevel;
  deployed: boolean;
  /** Resolve the identity for a request, at enforcement time. Optional here
   *  because authoring only needs `proves`. */
  resolve?: (signals: Record<string, unknown>) => IdentityContext | null;
}

const PROVIDERS = new Map<string, IdentityProvider>();

/**
 * Device enrollment — real today. The daemon is enrolled with a device key, so
 * it proves the device identity. It does NOT prove which human is using it.
 */
export const DEVICE_ENROLLMENT: IdentityProvider = {
  id: "wrapbox.device_enrollment",
  proves: ["identity.device", "identity.workload"],
  assurance: "medium",
  deployed: true,
};

registerIdentityProvider(DEVICE_ENROLLMENT);

export function registerIdentityProvider(p: IdentityProvider): void { PROVIDERS.set(p.id, p); }
export function unregisterIdentityProvider(id: string): void { PROVIDERS.delete(id); }
export function allIdentityProviders(): IdentityProvider[] { return [...PROVIDERS.values()]; }

/** Every identity capability some DEPLOYED provider can prove today. */
export function provableIdentities(): Set<string> {
  const out = new Set<string>();
  for (const p of PROVIDERS.values()) if (p.deployed) for (const c of p.proves) out.add(c);
  return out;
}

/** Can any deployed provider prove this identity capability? */
export function identityCanProve(capability: string): boolean {
  return provableIdentities().has(capability);
}
