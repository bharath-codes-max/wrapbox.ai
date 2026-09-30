/**
 * Live Seatbelt violation telemetry from the unified log (no sudo needed).
 *
 * Record format:
 *   <ts> E kernel[0:<tid>] (Sandbox) Sandbox: <proc>(<pid>) deny(1) <op> <target>
 *
 * Counts are APPROXIMATE: the kernel coalesces rapid repeats into
 * "N duplicate reports for Sandbox: ..." lines, so per-event counts are lossy.
 */

import { spawn, execFileSync } from "node:child_process";

export interface Violation {
  proc: string;
  pid: number;
  op: string;
  path: string;
}

const DENY_RE = /Sandbox: (\S+?)\((\d+)\) deny\(\d+\) (\S+)(?: (.+))?$/;
const PREDICATE = 'sender == "Sandbox" AND eventMessage CONTAINS "deny"';

export function violationKey(v: Violation): string {
  return `${v.pid}|${v.op}|${v.path}`;
}

function parseLines(text: string, onDeny: (v: Violation) => void): void {
  for (const line of text.split("\n")) {
    const m = DENY_RE.exec(line);
    if (m) onDeny({ proc: m[1], pid: Number(m[2]), op: m[3], path: m[4] ?? "" });
  }
}

/**
 * Backfill from the persisted log store. `log stream` takes a moment to attach,
 * so a denial from a fast-exiting child (cat .env) can fire before the stream
 * is listening; `log show` reads what the store has already persisted.
 */
export function showViolationsSince(since: Date, onDeny: (v: Violation) => void): void {
  const d = new Date(since.getTime() - 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  // `log show --start` expects local time, "YYYY-MM-DD HH:MM:SS".
  const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  try {
    const out = execFileSync(
      "/usr/bin/log",
      ["show", "--start", start, "--style", "compact", "--predicate", PREDICATE],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 },
    );
    parseLines(out, onDeny);
  } catch {
    // Best-effort telemetry: a failed backfill must never fail the session.
  }
}

export function startViolationWatch(onDeny: (v: Violation) => void): () => void {
  // MUST be /usr/bin/log — plain `log` is a zsh builtin that shadows it.
  const child = spawn(
    "/usr/bin/log",
    ["stream", "--style", "compact", "--predicate", PREDICATE],
    { stdio: ["ignore", "pipe", "ignore"] },
  );

  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf-8");
    const nl = buf.lastIndexOf("\n");
    if (nl === -1) return;
    parseLines(buf.slice(0, nl), onDeny);
    buf = buf.slice(nl + 1);
  });

  return function stop() {
    child.kill("SIGTERM");
  };
}
