// Derivations for the Enforcement Fabric: what a device covers, how an action is attributed, what the
// evidence records. Pure functions over workspace state and agent profiles. No agent id appears here —
// every decision about an agent comes from its profile or from the device that discovered it.

import { agentById, METHODS, type Assurance } from "../data/agents";
import { profileOf, type DeviceOs, type Kind, type LaunchMode } from "../data/profiles";
import type { Act } from "./engine";
import type { Destination, DiscoveredAgent, Evt, FleetDevice, GatewayNode, State } from "./store";
import { hash, type Tpl } from "./traffic";

export type CoverageSource = "os_exec" | "os_fs" | "os_net" | "native_hook" | "mcp_gateway" | "api_gateway";
export type CoverageClass = "Floor" | "Ceiling" | "Remote" | "Assured";

/** The v2 context keys an enforcement point puts in Act.ctx. Rules match them with `requires`. */
export const CTX = {
  launchMode: "agent.launch_mode",
  source: "provenance.source",
  device: "device.id",
  deviceState: "device.state",
  coverage: "coverage.class",
  inWorkspace: "path.in_workspace",
} as const;

export const LAUNCH: Record<LaunchMode, { label: string; plain: string; tone: "allow" | "review" | "block" | "muted" }> = {
  wrapbox: { label: "Wrapbox launch", plain: "Started by the Runtime under confinement. Files, processes and network are fenced below it.", tone: "allow" },
  "native-managed": { label: "Native · managed", plain: "Started normally; the vendor honours the adapter the Runtime wrote. Hooks ask Wrapbox before every tool call.", tone: "allow" },
  "native-unmanaged": { label: "Native · unmanaged", plain: "Its adapter was changed outside Wrapbox. Until the Runtime rewrites it, model calls are refused.", tone: "block" },
  unknown: { label: "Unknown process", plain: "Not matched to any agent profile, so no adapter was written. Wrapbox governs it only when it is launched through a shim.", tone: "review" },
};

/** Coverage classes are the existing assurance levels, read per action kind. */
export const COVERAGE: Record<Assurance, { cls: CoverageClass | "Gap"; plain: string }> = {
  "endpoint-enforced": { cls: "Floor", plain: "OS confinement (macOS Seatbelt) around a process the Runtime launched or attributes by ancestry — files, processes and network fenced below it, and a child it spawns cannot escape. An agent started outside Wrapbox is not inside it." },
  "hook-enforced": { cls: "Ceiling", plain: "The agent's own pre-tool hook, written by the Runtime. Sees tool and arguments; returns the reason to the model." },
  "gateway-enforced": { cls: "Remote", plain: "The Gateway sees the full request and brokers the credential. The agent never holds the real key." },
  "resource-verified": { cls: "Assured", plain: "The destination verifies the signed receipt and refuses anything without one. Survives a compromised device." },
  "observe-only": { cls: "Gap", plain: "Visible but not enforced for this action kind." },
};
export const CLASS_TO_ASSURANCE: Record<CoverageClass, Assurance> = { Floor: "endpoint-enforced", Ceiling: "hook-enforced", Remote: "gateway-enforced", Assured: "resource-verified" };

export const KINDS: { id: Kind; label: string }[] = [
  { id: "fs.read", label: "Read a file" },
  { id: "fs.write", label: "Write a file" },
  { id: "exec", label: "Run a command" },
  { id: "net.connect", label: "Open a connection" },
  { id: "model.request", label: "Call a model" },
  { id: "mcp.tool_call", label: "Call an MCP tool" },
  { id: "http.request", label: "Call an API" },
  { id: "scm.push", label: "Push to source control" },
  { id: "payment", label: "Move money" },
];

/** Normalized effect → action kind. */
export function kindOf(effect: string): Kind {
  if (effect.startsWith("filesystem.read")) return "fs.read";
  if (effect.startsWith("filesystem.write")) return "fs.write";
  if (effect === "shell.exec" || effect === "runtime.integrity") return "exec";
  if (effect === "network.egress") return "net.connect";
  if (effect === "model.request") return "model.request";
  if (effect === "http.request") return "http.request";
  if (effect === "git.push") return "scm.push";
  if (["payments.refund", "payments.payout", "payment.submit", "claims.payout", "purchase.order"].includes(effect)) return "payment";
  return "mcp.tool_call";
}

/** Which enforcement point observed an action of this effect for an agent with (or without) a working hook. */
export function sourceFor(effect: string, hooked: boolean): CoverageSource {
  const k = kindOf(effect);
  if (k === "model.request" || k === "net.connect") return "os_net";
  if (k === "http.request" || k === "payment") return "api_gateway";
  if (k === "mcp.tool_call") return "mcp_gateway";
  if (k === "exec" || k === "scm.push") return hooked ? "native_hook" : "os_exec";
  return hooked ? "native_hook" : "os_fs";
}

const osOf = (osLabel: string): DeviceOs => (/windows/i.test(osLabel) ? "windows" : /ubuntu|linux|debian|rhel|fedora/i.test(osLabel) ? "linux" : "macos");
export const deviceOs = osOf;

/** A discovered agent, provisioned from its profile: the adapter path and content are the profile's, never the caller's. */
export function provisionAgent(agentId: string, device: Pick<FleetDevice, "os">, org: string, at: number, opts: { version?: string; binary?: string; launchMode?: LaunchMode; endpoint?: string } = {}): DiscoveredAgent {
  const p = profileOf(agentId);
  const os = osOf(device.os);
  if (!p)
    return { agentId, binary: opts.binary ?? agentId.replace(/^unknown:/, ""), version: opts.version ?? "—", launchMode: "unknown", discoveredAt: at, endpoint: opts.endpoint };
  const adapter = p.adapter
    ? (() => {
        const path = p.adapter.path[os];
        const body = p.adapter.render(org);
        return { path, kind: p.adapter.kind, state: "provisioned" as const, writtenAt: at, sha256: "sha256:" + Math.floor(hash(path + body) * 1e15).toString(16).padStart(12, "0") };
      })()
    : undefined;
  return { agentId, binary: opts.binary ?? p.binaries[0], version: opts.version ?? "—", launchMode: opts.launchMode ?? p.launch, discoveredAt: at, adapter };
}

const hooked = (a: DiscoveredAgent) => !!a.adapter && a.adapter.state !== "tampered" && (a.launchMode === "wrapbox" || a.launchMode === "native-managed");

/** Coverage classes for one action kind of one agent on one device. Derived, never stored. */
export function coverageFor(device: FleetDevice, agent: DiscoveredAgent, kind: Kind, gateways: GatewayNode[], destinations: Destination[]): CoverageClass[] {
  const out: CoverageClass[] = [];
  const p = profileOf(agent.agentId);
  const floorKinds: Kind[] = ["fs.read", "fs.write", "exec", "net.connect", "model.request", "scm.push"];
  // Floor = Seatbelt confinement, real only for a process the Runtime launched or manages. A binary the
  // fleet merely discovered on disk (launchMode "unknown" — every live Control-Plane agent, since cp-map
  // maps them all that way) is ungoverned until started through a shim, so device health alone must not
  // paint a Floor over it. A tampered adapter (native-unmanaged) still keeps its Floor, per docs.
  const runtimeLaunched = !!p && agent.launchMode !== "unknown";
  if (device.state === "healthy" && runtimeLaunched && floorKinds.includes(kind)) out.push("Floor");
  if (p && hooked(agent) && p.covers.includes(kind)) out.push("Ceiling");
  const gw = gateways.find((g) => g.state === "healthy");
  if (gw && ((kind === "mcp.tool_call" && gw.upstreams.length) || ((kind === "http.request" || kind === "payment") && gw.brokered.length))) out.push("Remote");
  if (destinations.some((d) => d.tier0 && destinationKind(d) === kind)) out.push("Assured");
  return out;
}
export const destinationKind = (d: Destination): Kind => (d.kind === "scm.push" ? "scm.push" : d.kind === "payment" ? "payment" : d.kind === "deploy" ? "exec" : "mcp.tool_call");

/** Plain-language gap statement for an agent on a device, or null when nothing is missing. */
export function gapFor(device: FleetDevice, agent: DiscoveredAgent): string | null {
  const p = profileOf(agent.agentId);
  // Never assert enforcement here: an unprofiled binary is simply ungoverned
  // until it is launched through a shim. Claiming its calls are "refused"
  // describes a Floor this build does not have.
  if (!p) return `${agent.binary}: not in any profile — ungoverned unless launched through a Wrapbox shim`;
  if (agent.launchMode === "native-unmanaged") return `${agentById(agent.agentId).name}: adapter changed outside Wrapbox — Ceiling lost until re-provisioned`;
  if (!p.adapter) return `${agentById(agent.agentId).name}: no hook interface — Floor and Remote only`;
  if (device.state !== "healthy") return `${device.hostname}: Runtime not reporting — coverage last confirmed ${new Date(device.heartbeat).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  return null;
}

/** The coverage class recorded on an event: where it was seen, raised to Assured when the target verifies receipts. */
export function coverageClassOf(source: CoverageSource, act: Act, destinations: Destination[]): CoverageClass {
  if (destinations.some((d) => d.tier0 && matchesDestination(d, act))) return "Assured";
  if (source === "native_hook") return "Ceiling";
  if (source === "mcp_gateway" || source === "api_gateway") return "Remote";
  return "Floor";
}
export function matchesDestination(d: Destination, act: Act): boolean {
  if (d.kind === "scm.push") return (act.effect === "git.push" || act.effect === "git.merge") && /^(main|master|release\/)/.test(act.branch ?? "");
  if (d.kind === "payment") return act.effect === "payments.refund";
  if (d.kind === "deploy") return act.effect === "shell.exec" && /helm upgrade|kubectl apply/.test(act.command ?? "");
  return false;
}

export interface Provenance {
  deviceId: string;
  deviceState: FleetDevice["state"];
  launchMode: LaunchMode;
  source: CoverageSource;
  coverage: CoverageClass;
  inWorkspace?: boolean;
}

/** Stamp a traffic template with the device context every v2 enforcement point adds to an Act. */
export function withProvenance(t: Tpl, p: Provenance): Tpl {
  const stamp = (act: Act): Act => ({
    ...act,
    ctx: {
      ...act.ctx,
      [CTX.device]: p.deviceId,
      [CTX.deviceState]: p.deviceState,
      [CTX.launchMode]: p.launchMode,
      [CTX.source]: p.source,
      [CTX.coverage]: p.coverage,
      ...(act.effect === "filesystem.write" ? { [CTX.inWorkspace]: p.inWorkspace ?? !!act.path?.startsWith("/oakridge/") } : {}),
    },
  });
  return { ...t, act: stamp(t.act), vary: t.vary ? (r) => { const v = t.vary!(r); return { action: v.action, act: stamp(v.act) }; } : undefined };
}

/** What Evidence shows for an event: the device context it was decided with. */
export function provenanceOf(e: Pick<Evt, "act">): Partial<Provenance> {
  const c = e.act?.ctx ?? {};
  return { deviceId: c[CTX.device] as string | undefined, deviceState: c[CTX.deviceState] as FleetDevice["state"] | undefined, launchMode: c[CTX.launchMode] as LaunchMode | undefined, source: c[CTX.source] as CoverageSource | undefined, coverage: c[CTX.coverage] as CoverageClass | undefined };
}

/** v1 pages read `connected`; in v2 it is derived from what the fleet discovered and what the Gateway fronts. */
export function connectedFrom(fleet: FleetDevice[], gateways: GatewayNode[]): State["connected"] {
  const out: State["connected"] = {};
  for (const d of fleet)
    for (const a of d.agents) {
      if (!profileOf(a.agentId)) continue;
      const cat = agentById(a.agentId).category;
      const m = METHODS[cat].find((x) => x.id === "runtime") ?? METHODS[cat].find((x) => x.recommended) ?? METHODS[cat][0];
      if (!out[a.agentId] || out[a.agentId].at > a.discoveredAt) out[a.agentId] = { method: m.id, assurance: m.assurance, at: a.discoveredAt };
    }
  for (const g of gateways)
    for (const id of g.upstreams) {
      const cat = agentById(id).category;
      const m = METHODS[cat].find((x) => x.id === "gateway") ?? METHODS[cat][0];
      out[id] ??= { method: m.id, assurance: m.assurance, at: g.heartbeat - 14 * 86_400_000 };
    }
  return out;
}

/** Devices a person can see: admins see the fleet, everyone else their own machines. */
export const devicesFor = (fleet: FleetDevice[], personId: string, admin: boolean) => (admin ? fleet : fleet.filter((d) => d.ownerId === personId));

export const fmtHeartbeat = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`;
};
