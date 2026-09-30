/**
 * Seatbelt (SBPL) profile compiler.
 *
 * Profile shape VERIFIED working on this Mac (macOS 26.x / Darwin 25.x):
 * allow-default + targeted (deny file-read* ...) blocks cat/python3/node/cp,
 * survives symlinks (kernel enforces on the RESOLVED path) and inherits into
 * every child process. See research/seatbelt.md.
 *
 * SBPL parser limits (enforced by sandbox-exec itself): in
 * (remote ip "HOST:PORT") the HOST may ONLY be "localhost" or "*" — anything
 * else fails to parse ("host must be * or localhost in network address").
 * Domain/IP egress policy therefore requires a local proxy; Seatbelt only
 * pins the agent to it.
 */

import os from "node:os";
import path from "node:path";

/** Secret-file regexes (valid both as SBPL #"..." regexes and JS RegExp). */
export const SECRET_PATTERNS: string[] = [
  "(^|/)\\.env$",
  "(^|/)\\.env\\.[^/]*$",
  "\\.pem$",
  "\\.key$",
  "(^|/)id_rsa$",
  "(^|/)id_ed25519$",
];

/** Directories always denied by subpath (resolved against the real home). */
export function secretSubpaths(): string[] {
  const home = os.homedir();
  return [path.join(home, ".ssh"), path.join(home, ".aws")];
}

export function matchesSecretPattern(p: string): boolean {
  return SECRET_PATTERNS.some((re) => new RegExp(re).test(p));
}

/** Escape a path for an SBPL double-quoted string literal ((subpath "...")):
 *  backslash and double-quote must be escaped. */
function sbplEscapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape a regex for an SBPL #"..." literal. SURPRISING: backslashes must be
 *  emitted verbatim — doubling them changes the pattern (verified: #"(^|/)\\.env$"
 *  fails to match .env while #"(^|/)\.env$" blocks it). Only the double quote,
 *  which would terminate the literal, is escaped. */
function sbplEscapeRegex(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Escape regex metacharacters so a literal path fragment becomes a safe regex. */
function regexEscapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type NetworkMode = "on" | "off" | { loopbackPort: number };

export interface CompileOpts {
  cwd: string;
  /** Extra file-read deny regexes (raw regex source strings). */
  extraDenyRead: string[];
  /** Extra file-read deny subpaths (absolute paths). */
  denySubpaths: string[];
  network: NetworkMode;
}

export function compileProfile(opts: CompileOpts): string {
  const regexes = [...SECRET_PATTERNS, ...opts.extraDenyRead];
  const subpaths = [...secretSubpaths(), ...opts.denySubpaths];

  const lines: string[] = [];
  lines.push("(version 1)");
  lines.push(`; wrapboxd profile — cwd ${opts.cwd}`);
  lines.push("(allow default)");
  lines.push("(deny file-read*");
  for (const re of regexes) lines.push(`  (regex #"${sbplEscapeRegex(re)}")`);
  for (const sp of subpaths) lines.push(`  (subpath "${sbplEscapeString(sp)}")`);
  lines.push(")");

  if (opts.network === "off") {
    lines.push("(deny network*)");
  } else if (typeof opts.network === "object") {
    const port = Math.floor(opts.network.loopbackPort);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(`invalid loopback port: ${String(opts.network.loopbackPort)}`);
    }
    lines.push("(deny network-outbound)");
    // Only "localhost" or "*" are valid hosts here (parser-enforced) — never emit anything else.
    lines.push(`(allow network-outbound (remote ip "localhost:${port}"))`);
    // Keeps DNS (mDNSResponder) and local IPC alive.
    lines.push("(allow network-outbound (remote unix-socket))");
  }
  // network "on": no network clauses — allow-default covers it.

  return lines.join("\n") + "\n";
}

interface RuleLike {
  effect: string;
  condition?: unknown;
}

/**
 * Derive extra kernel-level file denies from cached BLOCK rules whose
 * condition (a single condition or any member of an AND array) targets
 * field "tool_input.path":
 *   - op contains    -> regex of the escaped literal
 *   - op starts_with (absolute path) -> subpath
 *   - op regex       -> as-is
 * Everything else is hook-layer-only — do not guess a kernel translation.
 */
export function rulesToDenies(rules: RuleLike[]): { extraDenyRead: string[]; denySubpaths: string[] } {
  const extraDenyRead: string[] = [];
  const denySubpaths: string[] = [];

  for (const rule of rules) {
    if (rule.effect !== "block" || rule.condition == null) continue;
    const members = Array.isArray(rule.condition) ? rule.condition : [rule.condition];
    for (const m of members) {
      if (!m || typeof m !== "object") continue;
      const { field, op, value } = m as { field?: string; op?: string; value?: unknown };
      if (field !== "tool_input.path" || typeof value !== "string" || value === "") continue;
      if (op === "contains") {
        extraDenyRead.push(regexEscapeLiteral(value));
      } else if (op === "starts_with" && value.startsWith("/")) {
        denySubpaths.push(value);
      } else if (op === "regex") {
        extraDenyRead.push(value);
      }
    }
  }
  return { extraDenyRead, denySubpaths };
}
