/**
 * `wrapboxd pull` — force a rule sync; cache/rules.json stores the exact
 * /v1/rules/pull response body.
 */

import fs from "node:fs";
import { loadConfig, PATHS } from "../config.js";
import { pullRules } from "../api.js";

export async function cmdPull(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("✖ Not enrolled. Run: wrapboxd enroll --server URL --org ORG --token WBXE...");
    return 1;
  }
  let body;
  try {
    body = await pullRules(cfg);
  } catch (err) {
    console.error(`✖ Rule pull failed: ${(err as Error).message}`);
    return 1;
  }
  fs.mkdirSync(PATHS.cacheDir, { recursive: true });
  fs.writeFileSync(PATHS.rulesCache, JSON.stringify(body, null, 2) + "\n");
  console.log(`✔ Pulled ${body.rules.length} rule(s) at ${body.pulled_at}`);
  return 0;
}
