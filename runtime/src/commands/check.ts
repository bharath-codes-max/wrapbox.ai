/**
 * `wrapboxd check` — THE HOOK SHIM (Claude Code PreToolUse contract).
 *
 * Hard rules:
 *  - NEVER touches the network. Decides from the local cache only. A Claude
 *    Code PreToolUse hook that TIMES OUT does not block (fail-open in the
 *    host), so this path must answer in milliseconds from disk.
 *  - stdout is EXACTLY one hookSpecificOutput JSON object, exit 0.
 *  - On ANY internal error: exit 2 with the reason on stderr — exit 2 always
 *    blocks in Claude Code, which is our fail-closed backstop.
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, PATHS } from "../config.js";
import { makeReceipt, appendToSpool, type ReceiptFields } from "../receipts.js";

interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  session_id?: string;
  [k: string]: unknown;
}

type PermissionDecision = "allow" | "deny" | "ask";

function emit(decision: PermissionDecision, reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
}

/** Read all of stdin, or null if nothing complete arrives within timeoutMs. */
function readStdin(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(null), timeoutMs);
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function targetOf(toolInput: Record<string, unknown>): string {
  for (const k of ["path", "file_path", "command", "url"]) {
    const v = toolInput[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return "";
}

function isInsideCwd(p: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, p);
  const base = path.resolve(cwd);
  return resolved === base || resolved.startsWith(base + path.sep);
}

export async function cmdCheck(args: string[]): Promise<never> {
  let agent = "claude-code";
  let project: string | undefined = process.env.WRAPBOX_PROJECT || undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) agent = args[++i];
    else if (args[i] === "--project" && args[i + 1]) project = args[++i];
  }

  try {
    // 1) stdin — 2s guard; missing/invalid input is treated as invalid → deny.
    const raw = await readStdin(2000);
    let input: HookInput | null = null;
    if (raw !== null) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = null;
      }
    }
    if (input === null || typeof input !== "object") {
      emit("deny", "Wrapbox: invalid hook input (fail closed)");
      process.exit(0);
    }

    const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
    const toolInput = (input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {}) as Record<string, unknown>;
    const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
    const session = process.env.WRAPBOX_SESSION || (typeof input.session_id === "string" ? input.session_id : "") || "";
    const target = targetOf(toolInput);

    // 2) fail closed with a clear remedy when this device has no policy.
    const cfg = loadConfig();
    const hasCache = fs.existsSync(PATHS.rulesCache);
    if (!cfg || !hasCache) {
      const reason = "Wrapbox: no policy on this device — run wrapboxd enroll / wrapboxd pull (fail closed)";
      if (cfg) {
        // Enrolled but no cache: we have keys, so this decision is evidenced.
        writeReceipt(cfg, {
          agent, session, tool_name: toolName, tool_input: toolInput, target,
          effect: "block", reason, rule_id: null, ruleset_pulled_at: null,
          enforcement: process.env.WRAPBOX_SESSION ? "both" : "hook", degraded: false,
        });
      }
      emit("deny", reason);
      process.exit(0);
    }

    // policy.ts (and @wrapbox/policy-core) is imported only past the
    // enrollment guard: a missing/broken engine is an internal error → exit 2.
    const policy = await import("../policy.js");
    const cached = policy.loadCachedRules();
    if (!cached) {
      const reason = "Wrapbox: no policy on this device — run wrapboxd enroll / wrapboxd pull (fail closed)";
      writeReceipt(cfg, {
        agent, session, tool_name: toolName, tool_input: toolInput, target,
        effect: "block", reason, rule_id: null, ruleset_pulled_at: null,
        enforcement: process.env.WRAPBOX_SESSION ? "both" : "hook", degraded: false,
      });
      emit("deny", reason);
      process.exit(0);
    }

    // 3) stale cache (>24h): read-only tools inside the project keep working
    //    (degraded, evidenced); everything else is denied.
    if (!cached.fresh) {
      const readTools = ["Read", "Grep", "Glob"];
      const p = typeof toolInput.path === "string" ? toolInput.path
        : typeof toolInput.file_path === "string" ? toolInput.file_path : "";
      if (readTools.includes(toolName) && p !== "" && isInsideCwd(p, cwd)) {
        const reason = "Wrapbox: policy stale — read-only access inside project allowed (degraded)";
        writeReceipt(cfg, {
          agent, session, tool_name: toolName, tool_input: toolInput, target,
          effect: "allow", reason, rule_id: null, ruleset_pulled_at: cached.pulled_at,
          enforcement: "hook-degraded", degraded: true,
        });
        emit("allow", reason);
        process.exit(0);
      }
      const reason = "Wrapbox: policy expired — reconnect to refresh (fail closed)";
      writeReceipt(cfg, {
        agent, session, tool_name: toolName, tool_input: toolInput, target,
        effect: "block", reason, rule_id: null, ruleset_pulled_at: cached.pulled_at,
        enforcement: "hook-degraded", degraded: true,
      });
      emit("deny", reason);
      process.exit(0);
    }

    // 4) fresh cache: the one shared matcher decides.
    //
    // Normalise the tool input first. Different agent tools name the same thing
    // differently — Read/Edit/Write send `file_path`, Grep/Glob send `path`,
    // NotebookEdit sends `notebook_path`. A rule written against `tool_input.path`
    // must catch a secret file no matter which tool touches it, so we synthesise
    // a canonical `path` (without discarding the original fields). Without this,
    // "block .env" silently misses every Read — the exact bug this fixes.
    const normalizedInput: Record<string, unknown> = { ...toolInput };
    if (typeof normalizedInput.path !== "string") {
      const alt = normalizedInput.file_path ?? normalizedInput.notebook_path;
      if (typeof alt === "string") normalizedInput.path = alt;
    }
    const rules = policy.applyProjectFilter(cached.rules, project);
    const decision = policy.evaluate({ tool_name: toolName, tool_input: normalizedInput, project_id: project }, rules);
    const matched = decision.matched_rule_id ? cached.rules.find((r) => r.id === decision.matched_rule_id) : undefined;
    const reason = matched ? `Wrapbox: ${matched.name}` : `Wrapbox: ${decision.reason}`;
    const map: Record<string, PermissionDecision> = { allow: "allow", block: "deny", review: "ask" };
    const permission = map[decision.effect] ?? "deny";

    writeReceipt(cfg, {
      agent, session, tool_name: toolName, tool_input: toolInput, target,
      effect: decision.effect as ReceiptFields["effect"], reason,
      rule_id: decision.matched_rule_id ?? null, ruleset_pulled_at: cached.pulled_at,
      enforcement: process.env.WRAPBOX_SESSION ? "both" : "hook", degraded: false,
    });
    emit(permission, reason);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Wrapbox: internal error — blocked (fail closed): ${(err as Error).message}\n`);
    process.exit(2); // exit 2 always blocks the tool call in Claude Code
  }
}

function writeReceipt(cfg: { device_id: string; key_id: string }, fields: ReceiptFields): void {
  const receipt = makeReceipt(cfg, fields);
  appendToSpool(receipt);
}
