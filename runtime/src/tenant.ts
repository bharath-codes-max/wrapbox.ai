/**
 * Tenant registries on the device.
 *
 * The control plane owns the tenant's destination configuration (approved AI
 * services, internal and partner domains, exemptions, named groups). The
 * daemon caches it at WRAPBOX_HOME/destinations.json — written whenever
 * /v1/rules/pull carries a `destinations` block — and builds the Destination
 * Registry from it. With no file, the seed catalogue applies and NOTHING is
 * approved: an uncatalogued or unapproved AI host classifies as
 * KNOWN_AI_UNAPPROVED / UNKNOWN_EXTERNAL, which is the safe reading.
 */

import fs from "node:fs";
import path from "node:path";
import { DestinationRegistry, EMPTY_TENANT, type TenantDestinationConfig } from "@wrapbox/registry";
import { PATHS } from "./config.js";

const FILE = () => path.join(PATHS.home, "destinations.json");

let registry: DestinationRegistry | null = null;
let loadedFrom: "file" | "seed" = "seed";

export function loadTenantDestinations(): TenantDestinationConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf-8")) as Partial<TenantDestinationConfig>;
    return { ...EMPTY_TENANT, ...raw, extraServices: raw.extraServices ?? [], exemptions: raw.exemptions ?? [], groups: raw.groups ?? [] };
  } catch {
    return EMPTY_TENANT;
  }
}

export function saveTenantDestinations(cfg: TenantDestinationConfig): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  const tmp = FILE() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  registry = null;
}

export function tenantDestinations(): DestinationRegistry {
  if (!registry) {
    const cfg = loadTenantDestinations();
    loadedFrom = cfg === EMPTY_TENANT ? "seed" : "file";
    registry = new DestinationRegistry(cfg);
  }
  return registry;
}

export function tenantDestinationSource(): "file" | "seed" { void tenantDestinations(); return loadedFrom; }

/** Test hook. */
export function resetTenantDestinations(): void { registry = null; }
