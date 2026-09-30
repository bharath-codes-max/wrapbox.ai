// Plain-language description of an event — "Sent checkout.ts to Claude".
// One function so every screen (Live Actions, Control Room, Agents, Evidence,
// Review Center, the detail panel) says the same thing. The technical verb
// (NETWORK_SEND…) stays available one level deeper, never first.
import type { SimulationEvent } from "../model/types";
import { resourceById } from "../model/org";
import { destById } from "../model/registries";

interface Verb { base: string; past: string; object: string }

function destinationName(e: SimulationEvent): string | undefined {
  if (!e.destination) return undefined;
  const d = destById(e.destination);
  if (!d) return e.destination;
  if (d.class === "UNKNOWN_EXTERNAL") return `an unknown address (${d.host})`;
  if (d.class === "GENERIC_EXTERNAL") return d.host;
  return d.label.replace(/\s*\(.*\)\s*$/, ""); // "Claude (approved)" → "Claude"
}

const n = (x: number) => x.toLocaleString("en-US");

function verbFor(e: SimulationEvent): Verb {
  const res = resourceById(e.resource)?.name ?? e.resource;
  const to = destinationName(e);
  const raw = e.actionRaw ?? "";
  const rows = e.blastRadius?.rows;

  if (e.mcp) {
    const detail = e.mcp.args.branch ? ` to ${e.mcp.args.branch}` : e.mcp.args.path ? ` on ${e.mcp.args.path}` : e.mcp.args.issue_number ? ` #${e.mcp.args.issue_number}` : "";
    const server = e.mcp.server === "mcp-github" ? "GitHub" : e.mcp.server === "mcp-filesystem" ? "the local filesystem server" : "an unregistered server";
    return { base: "call", past: "Called", object: `MCP ${e.mcp.tool}${detail} (${server})` };
  }
  if (/refunds|stripe_refund/.test(raw)) {
    const amount = raw.match(/\$[\d,.]+|amount=([\d,.]+)/);
    const amt = amount ? (amount[0].startsWith("$") ? amount[0] : `$${Number(amount[1]).toLocaleString("en-US")}`) : "";
    return { base: "issue a", past: "Issued a", object: `refund${amt ? ` of ${amt}` : ""} via ${res}` };
  }
  if (/place order/i.test(raw)) return { base: "place an order on", past: "Placed an order on", object: to ?? res };
  if (e.action === "NETWORK_SEND" && /\breply\b/.test(raw)) return { base: "send a reply via", past: "Sent a reply via", object: to ?? res };

  switch (e.action) {
    case "NETWORK_SEND":
      return { base: "send", past: "Sent", object: to ? `${res} to ${to}` : `${res} out` };
    case "DATA_EXPORT":
      return {
        base: "export", past: "Exported",
        object: `${rows ? `${n(rows)} rows from ` : ""}${res}${to ? ` to ${to}` : ""}`,
      };
    case "READ":
      if (/healthz|health|curl/.test(raw)) return { base: "check the health of", past: "Checked the health of", object: res };
      return rows && e.plane === "GATEWAY"
        ? { base: "query", past: "Queried", object: `${n(rows)} rows from ${res}` }
        : { base: "read", past: "Read", object: res };
    case "SECRET_ACCESS":
      return { base: "open", past: "Opened", object: `the secrets file ${res}` };
    case "EXECUTE":
      return { base: "run", past: "Ran", object: raw || res };
    case "DELETE":
      return {
        base: "delete", past: "Deleted",
        object: rows && rows > 1000 ? `${res} (${n(rows)} rows)` : res,
      };
    case "WRITE":
      if (/^refund\b/.test(raw)) return { base: "issue a", past: "Issued a", object: `${raw.replace(/^refund\s*/, "refund of ")} via ${res}` };
      if (/--force/.test(raw)) return { base: "force-push to", past: "Force-pushed to", object: res };
      if (/git push/.test(raw)) return { base: "push code to", past: "Pushed code to", object: res };
      if (/git commit/.test(raw)) return { base: "commit to", past: "Committed to", object: res };
      if (/^edit\b/.test(raw)) return { base: "edit", past: "Edited", object: res };
      return { base: "change", past: "Changed", object: res };
    case "PERMISSION_CHANGE":
      return /AdministratorAccess|admin/i.test(raw)
        ? { base: "give admin rights in", past: "Gave admin rights in", object: res }
        : { base: "change permissions in", past: "Changed permissions in", object: res };
    case "SECURITY_CHANGE":
      return { base: "turn off", past: "Turned off", object: res };
    case "DEPLOY":
      return { base: "deploy to", past: "Deployed to", object: res };
    default:
      return { base: "act on", past: "Acted on", object: res };
  }
}

/** Plain sentence whose tense follows what actually happened. */
export function describe(e: SimulationEvent): string {
  const v = verbFor(e);
  const review = e.reviewState?.status;
  if (e.status === "pending_review" || e.status === "parked") {
    return `Waiting for approval to ${v.base} ${v.object}`;
  }
  if (e.status === "blocked") {
    return `Tried to ${v.base} ${v.object}`;
  }
  if (review === "constrained") {
    return `${v.past} ${v.object} (safer version)`;
  }
  if (e.transformation && e.transformation.length > 0) {
    return `${v.past} ${v.object} — private data hidden`;
  }
  return `${v.past} ${v.object}`;
}
