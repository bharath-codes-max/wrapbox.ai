/**
 * `wrapboxd protect claude-code` / `wrapboxd unprotect claude-code`
 * Installs the PreToolUse governor hooks into ~/.claude/settings.json.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256hex } from "../canonical.js";
import { loadState, saveState } from "../receipts.js";

const MATCHERS = ["Bash", "Edit|Write|NotebookEdit", "Read", "WebFetch|WebSearch", "mcp__.*"];

export function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

/** A stable absolute command computed at install time — the hook must work
 *  from any cwd and any shell PATH. Prefer the built dist/cli.js; fall back
 *  to tsx + src for dev installs. */
export function checkCommand(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // src/commands or dist/commands
  const root = path.resolve(here, "..", "..");
  const node = process.execPath;
  const dist = path.join(root, "dist", "cli.js");
  if (fs.existsSync(dist)) return `${node} ${dist} check --agent claude-code`;
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  return `${tsx} ${path.join(root, "src", "cli.ts")} check --agent claude-code`;
}

function readSettings(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function isWrapboxEntry(entry: any): boolean {
  return Array.isArray(entry?.hooks) &&
    entry.hooks.some((h: any) => typeof h?.command === "string" && h.command.toLowerCase().includes("wrapbox"));
}

/** Idempotent: strips any existing wrapbox entries, then appends ours. */
export function installHooks(): { file: string; hash: string } {
  const file = claudeSettingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const backup = file + ".wrapbox-backup";
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);

  const settings = readSettings(file);
  settings.hooks = settings.hooks ?? {};
  const existing: any[] = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  const kept = existing.filter((e) => !isWrapboxEntry(e));
  const command = checkCommand();
  const ours = MATCHERS.map((matcher) => ({
    matcher,
    hooks: [{ type: "command", command, timeout: 10 }],
  }));
  settings.hooks.PreToolUse = [...kept, ...ours];

  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  const hash = sha256hex(fs.readFileSync(file, "utf-8"));
  const state = loadState();
  saveState({ ...state, hooks_hash: hash, hooks_path: file });
  return { file, hash };
}

export function removeHooks(): { file: string; removed: number } {
  const file = claudeSettingsPath();
  const settings = readSettings(file);
  const existing: any[] = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
  const kept = existing.filter((e) => !isWrapboxEntry(e));
  const removed = existing.length - kept.length;
  if (settings.hooks) {
    if (kept.length > 0) settings.hooks.PreToolUse = kept;
    else delete settings.hooks.PreToolUse;
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  const state = loadState();
  delete state.hooks_hash;
  delete state.hooks_path;
  saveState(state);
  return { file, removed };
}

export async function cmdProtect(args: string[]): Promise<number> {
  if (args[0] !== "claude-code") {
    console.error("Usage: wrapboxd protect claude-code");
    return 64;
  }
  const { file } = installHooks();
  console.log(`✔ Wrapbox PreToolUse hooks installed in ${file}`);
  console.log(`  Matchers: ${MATCHERS.join(", ")}`);
  console.log("Note: user-level settings are self-healing (the daemon restores them on drift)");
  console.log("and tamper-evidenced (drift is recorded as a signed receipt). The non-removable");
  console.log("enterprise path is managed-settings.json in /Library/Application Support/ClaudeCode/");
  console.log("with allowManagedHooksOnly — documented, not written by this build.");
  return 0;
}

export async function cmdUnprotect(args: string[]): Promise<number> {
  if (args[0] !== "claude-code") {
    console.error("Usage: wrapboxd unprotect claude-code");
    return 64;
  }
  const { file, removed } = removeHooks();
  console.log(`✔ Removed ${removed} Wrapbox hook entr${removed === 1 ? "y" : "ies"} from ${file}`);
  return 0;
}
