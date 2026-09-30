/**
 * `wrapboxd sync` — drain the evidence spool to the control plane once.
 */

import { loadConfig } from "../config.js";
import { drainSpool, spoolDepth } from "../receipts.js";

export async function cmdSync(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("✖ Not enrolled. Run: wrapboxd enroll ...");
    return 1;
  }
  const before = spoolDepth();
  if (before.unsent === 0) {
    console.log("Spool empty — nothing to sync.");
    return 0;
  }
  try {
    const res = await drainSpool(cfg);
    console.log(`✔ Synced: ${res.accepted} accepted, ${res.duplicates} duplicate(s), ${res.rejected.length} rejected`);
    if (res.rejected.length > 0) console.log("  Rejected:", JSON.stringify(res.rejected));
    return 0;
  } catch (err) {
    console.error(`✖ Sync failed: ${(err as Error).message}`);
    return 1;
  }
}
