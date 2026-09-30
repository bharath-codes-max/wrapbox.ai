// The Enforcement Fabric workspace: Oakridge Mutual two weeks into the install-once Runtime, one product
// version after the reference tenant. Same people, same approver groups, same contract lineage. Three
// enrolled devices and one Gateway. Every device, adapter, decision, approval, receipt and session token
// on every screen derives from the records generated here; every decision was produced by the runtime
// evaluator over the published contract.

import { INITIAL_RULES, type Rule } from "./contract";
import { PEOPLE, personById } from "./people";
import { profileOf } from "./profiles";
import { REFERENCE_ALLOWED, REFERENCE_CHANGELOG, REFERENCE_GROUPS, REFERENCE_MEMBERS, REFERENCE_ORG, REJECTIONS, claim, edit, featurePush, hourlyRate, intentFor, one, read, refund, secret, shell } from "./reference";
import { evaluate } from "../lib/engine";
import { CTX, coverageClassOf, connectedFrom, provisionAgent, sourceFor, withProvenance, type Provenance } from "../lib/fabric";
import type { Approval, ContractChange, Destination, DiscoveredAgent, Evt, FleetDevice, GatewayNode, SessionToken, State, VaultRef } from "../lib/store";
import { T, approvalFrom, approversFor, categoryOf, gateFromAct, hex, mkEvt, pick, rng, type Tpl } from "../lib/traffic";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
export const FABRIC_LOG_DAYS = 14;
export const RUNTIME_VERSION = "2.0.3";

/* ================= the contract: the v1 rules plus what the Runtime pilot added ================= */
const PROD_DEPLOY = (() => {
  const r: Rule = {
    id: "prod.deploy",
    title: "Production deploys need on-call and green CI",
    why: "A deploy changes customer-facing systems; CI must have passed on the exact commit being shipped.",
    when: { effect: ["shell.exec"], command: ["helm upgrade * -n prod*", "helm upgrade * --namespace prod*", "kubectl apply * -n prod*"], requires: [{ key: "ci.passed", op: "is", value: true }] },
    decision: "REVIEW",
    approvers: "oncall-sre",
    permit: { ttlSeconds: 120, singleUse: true },
    failClosed: true,
    scope: "coding",
    custom: true,
  };
  return r;
})();
const MODEL_EGRESS: Rule = {
  id: "model.egress",
  title: "Only managed agents may reach a model provider",
  why: "An agent launched outside Wrapbox, or whose adapter was changed, is unknown to the contract. Its model calls stop until the Runtime re-provisions it.",
  when: { effect: ["model.request"], requires: [{ key: CTX.launchMode, op: "in", value: ["wrapbox", "native-managed"] }] },
  decision: "ALLOW",
  failClosed: true,
  scope: "all",
  custom: true,
};
const FS_CONFINE: Rule = {
  id: "fs.confine",
  title: "Writes stay inside the workspace",
  why: "The Floor: the Runtime refuses writes outside the repository the agent was started in.",
  when: { effect: ["filesystem.write"], requires: [{ key: CTX.inWorkspace, op: "is", value: true }] },
  decision: "ALLOW",
  failClosed: true,
  scope: "coding",
  custom: true,
};
const RUNTIME_INTEGRITY: Rule = {
  id: "runtime.integrity",
  title: "A changed adapter is rejected and rewritten",
  why: "Provisioned files are integrity-monitored. A change outside Wrapbox is refused, the agent is reclassified as unmanaged, and the Runtime writes the adapter again.",
  when: { effect: ["runtime.integrity"] },
  decision: "BLOCK",
  scope: "all",
  custom: true,
};
/** Pushes to main move from BLOCK to REVIEW once GitHub verifies receipts: an approved push carries a 300 s single-use receipt. */
const GIT_MAIN_V2: Rule = {
  ...INITIAL_RULES.find((r) => r.id === "git.main")!,
  title: "Pushes to main need on-call and carry a receipt",
  why: "GitHub refuses any push to a protected branch without a valid receipt, so an approved push is the only kind that lands.",
  decision: "REVIEW",
  approvers: "oncall-sre",
  permit: { ttlSeconds: 300, singleUse: true },
};
/** Refunds above the automatic tier carry a receipt the payment service verifies. */
const REFUND_V2: Rule = { ...INITIAL_RULES.find((r) => r.id === "payments.refund")!, permit: { ttlSeconds: 300, singleUse: true } };

export const FABRIC_RULES: Rule[] = [...INITIAL_RULES.map((r) => (r.id === "git.main" ? GIT_MAIN_V2 : r.id === "payments.refund" ? REFUND_V2 : r)), PROD_DEPLOY, MODEL_EGRESS, FS_CONFINE, RUNTIME_INTEGRITY];

const C = (version: number, daysAgo: number, by: string, summary: string, o: Partial<Pick<ContractChange, "added" | "changed" | "removed">> = {}) => ({ version, daysAgo, by, summary, added: o.added ?? [], changed: o.changed ?? [], removed: o.removed ?? [] });
/** The v1 history up to the pilot, then what the Runtime rollout changed. */
const CHANGELOG = [
  ...REFERENCE_CHANGELOG.filter((c) => c.daysAgo >= 19),
  C(19, 14, "maya.s", "Runtime pilot: model-egress gate, in observe mode", { added: ["model.egress"] }),
  C(20, 13, "priya.m", "Egress allowlist: add api.wrapbox.ai", { changed: ["network.egress"] }),
  C(21, 11, "maya.s", "Model-egress gate switched to enforce", { changed: ["model.egress"] }),
  C(22, 10, "priya.m", "Refund tiers: block above $5,000", { changed: ["payments.refund"] }),
  C(23, 8, "maya.s", "Workspace confinement enforced on enrolled devices", { added: ["fs.confine"] }),
  C(24, 6, "maya.s", "Adapter integrity: a changed adapter is rejected and rewritten", { added: ["runtime.integrity"] }),
  C(25, 5, "maya.s", "Force-push rewrite also covers -f", { changed: ["git.force"] }),
  C(26, 4, "priya.m", "Receipts on tier-0: pushes to main move from BLOCK to REVIEW with a 300 s single-use receipt", { changed: ["git.main"] }),
  C(27, 3, "maya.s", "Receipts required for refunds above the automatic tier", { changed: ["payments.refund"] }),
];

/* ================= fleet ================= */
const ORG = REFERENCE_ORG.domain.split(".")[0];

interface DeviceSeed {
  id: string;
  hostname: string;
  ownerId: string;
  os: string;
  osLogo: string;
  arch: string;
  enrolledDays: number;
  state: FleetDevice["state"];
  /** Minutes since the last heartbeat. */
  heartbeatMin: number;
  /** [agent id, binary version, launch-mode override, model host seen (unprofiled processes only)] */
  agents: [string, string, DiscoveredAgent["launchMode"]?, string?][];
  rate: number;
  alwaysOn?: boolean;
}
const DEVICES: DeviceSeed[] = [
  { id: "dk-macbook-pro", hostname: "dk-macbook-pro.local", ownerId: "dev.k", os: "macOS 15.6", osLogo: "apple", arch: "arm64", enrolledDays: 14, state: "healthy", heartbeatMin: 0.7, agents: [["claude-code", "2.1.104"], ["cursor", "1.8.2"], ["codex-cli", "0.153.4"]], rate: 0.55 },
  { id: "tanvi-mbp", hostname: "tanvi-mbp.local", ownerId: "tanvi.k", os: "macOS 15.5", osLogo: "apple", arch: "arm64", enrolledDays: 9, state: "healthy", heartbeatMin: 2, agents: [["cursor", "1.8.2"], ["windsurf", "1.12.6"], ["unknown:claims-bot.py", "python 3.12", undefined, "api.openai.com"]], rate: 0.45 },
  { id: "jonas-thinkpad", hostname: "jonas-thinkpad.oakridge.internal", ownerId: "jonas.w", os: "Windows 11", osLogo: "windows", arch: "x86_64", enrolledDays: 11, state: "healthy", heartbeatMin: 1.4, agents: [["claude-code", "2.1.104"], ["copilot-ide", "1.104.2"]], rate: 0.42 },
  { id: "claims-worker-01", hostname: "claims-worker-01.prod.oakridge.internal", ownerId: "rahul.m", os: "Ubuntu 24.04", osLogo: "ubuntu", arch: "x86_64", enrolledDays: 6, state: "heartbeat-lost", heartbeatMin: 12, agents: [["langgraph", "1.4.0"]], rate: 0.12, alwaysOn: true },
];

const DESTINATIONS: Destination[] = [
  { id: "github-main", kind: "scm.push", label: "github.com/oakridge · main and release/*", host: "api.github.com", tier0: true, verifier: "GitHub App · required status check" },
  { id: "deploy-api", kind: "deploy", label: "Production deploy API", host: "deploy-api.oakridge.internal", tier0: true, verifier: "Envoy ext_authz · verify middleware" },
  { id: "stripe-refunds", kind: "payment", label: "Stripe refunds", host: "api.stripe.com", tier0: true, verifier: "Gateway forward proxy" },
  { id: "postgres-prod", kind: "mcp", label: "Postgres · prod (execute_sql)", host: "postgres-prod.oakridge.internal", tier0: false, verifier: "Gateway only" },
];

const VAULT: Omit<VaultRef, "rotatedAt">[] = [
  { id: "v-stripe", ref: "vault://payments/stripe-restricted-key", kind: "api-key", upstream: "api.stripe.com", provider: "HashiCorp Vault" },
  { id: "v-github", ref: "vault://scm/github-app-installation", kind: "oauth", upstream: "api.github.com", provider: "HashiCorp Vault" },
  { id: "v-postgres", ref: "vault://data/postgres-claims-readonly", kind: "db", upstream: "postgres-prod.oakridge.internal", provider: "AWS Secrets Manager" },
  { id: "v-aws-deploy", ref: "vault://cloud/aws-deploy-role", kind: "cloud", upstream: "sts.amazonaws.com", provider: "AWS STS" },
];

/* ================= what agents do on enrolled devices ================= */
const MODEL_CALL = (agentId: string, human: string, host: string, w: number): Tpl => T(agentId, human, `POST https://${host}/v1/messages`, { effect: "model.request", destination: host, env: "development" }, w);

/** Per-agent day-to-day traffic on a laptop or server. Templates are shared with the v1 reference tenant.
 *  A process without a profile is only ever seen reaching a model host, so that is all it produces. */
function templatesFor(agentId: string, human: string, endpoint?: string): Tpl[] {
  const p = profileOf(agentId);
  if (!p) return [MODEL_CALL(agentId, human, endpoint ?? "api.openai.com", 0.5)];
  const model = (w: number, who = human) => p.modelEndpoints.slice(0, 1).map((h) => MODEL_CALL(agentId, who, h, w));
  switch (categoryOf(agentId)) {
    case "cli":
    case "ide":
      return [
        read(agentId, human, 6),
        edit(agentId, human, 4),
        shell(agentId, human, ["npm test", "npm run typecheck", "git status", "git diff --stat", "pnpm build"], 4),
        featurePush(agentId, human, 1.2),
        secret(agentId, human, 0.15),
        T(agentId, human, "Edit shell profile", { effect: "filesystem.write", path: "/Users/" + human.split(".")[0] + "/.zshrc", env: "development" }, 0.06),
        T(agentId, human, "Bash(git push origin main)", { effect: "git.push", branch: "main", command: "git push origin main", env: "development" }, 0.05),
        ...model(5),
      ];
    case "custom":
      return [
        T(agentId, "nikhil.r", "fetch_policy(WBX-HLT-…)", { effect: "policy.read", env: "production" }, 5),
        T(agentId, "anjali.v", "assess_documents(CLM-…)", { effect: "claims.assess", env: "production" }, 4),
        claim("nikhil.r", 0.6),
        claim("anjali.v", 0.5),
        ...model(3, "nikhil.r"),
      ];
    default:
      return model(1);
  }
}
/** Traffic seen only through the Gateway: MCP tools and brokered API calls from the enrolled laptops. */
function gatewayTemplates(): Tpl[] {
  return [
    T("github-mcp", "dev.k", "github · create_pull_request(oakridge/web#1302)", { effect: "git.pr.create", env: "production" }, 2),
    T("github-mcp", "tanvi.k", "github · get_file_contents(web/src/pages/claims/[id].tsx)", { effect: "git.read", env: "production" }, 3),
    T("stripe-mcp", "dev.k", "stripe · list_payment_intents(customer=cus_…)", { effect: "payments.read", env: "production" }, 2),
    refund("dev.k", 0.8),
    T("postgres-mcp", "tanvi.k", "postgres-prod · execute_sql(SELECT status, count(*) FROM claims GROUP BY 1)", { effect: "database.read", columns: ["status", "count(*)"], sql: "SELECT status, count(*) FROM claims GROUP BY 1", env: "production" }, 2),
    T("postgres-mcp", "dev.k", "postgres-prod · execute_sql(SELECT email FROM customers WHERE plan = 'pro')", { effect: "database.read", columns: ["email"], sql: "SELECT email FROM customers WHERE plan = 'pro'", env: "production" }, 0.6),
  ];
}

const provenanceFor = (d: FleetDevice, a: DiscoveredAgent, effect: string, destinations: Destination[]): Provenance => {
  const hooked = !!a.adapter && a.adapter.state !== "tampered" && (a.launchMode === "wrapbox" || a.launchMode === "native-managed");
  const source = sourceFor(effect, hooked);
  return { deviceId: d.id, deviceState: d.state, launchMode: a.launchMode, source, coverage: "Floor" };
};
const stamp = (t: Tpl, p: Provenance, destinations: Destination[]): Tpl => withProvenance(t, { ...p, coverage: coverageClassOf(p.source, t.act, destinations) });

/** Templates for live traffic from the fleet as it is right now: a tampered adapter or a lost heartbeat changes what is generated. */
export function fabricTemplates(s: Pick<State, "fleet" | "gateways" | "destinations">): Tpl[] {
  const out: Tpl[] = [];
  for (const d of s.fleet) {
    if (d.state !== "healthy" || d.killSwitch) continue;
    for (const a of d.agents) for (const t of templatesFor(a.agentId, d.ownerId, a.endpoint)) out.push(stamp(t, provenanceFor(d, a, t.act.effect, s.destinations), s.destinations));
  }
  const gw = s.gateways.find((g) => g.state === "healthy");
  if (gw) for (const t of gatewayTemplates()) out.push(stamp(t, { deviceId: gw.id, deviceState: "healthy", launchMode: "wrapbox", source: sourceFor(t.act.effect, false), coverage: "Remote" }, s.destinations));
  return out;
}

/* ================= build ================= */
export function fabricState(now = Date.now()): State {
  const r = rng(20260913 + 2);
  let seq = Math.floor(r() * 0x7fffff);
  const nextId = () => "d-" + (seq++ % 0xffffff).toString(16).padStart(6, "0");
  const admin = PEOPLE.priya;

  const changelog: ContractChange[] = CHANGELOG.map(({ daysAgo, ...c }) => ({ ...c, at: now - daysAgo * DAY - 7 * HOUR }));
  const version = changelog[changelog.length - 1].version;

  const fleet: FleetDevice[] = DEVICES.map((d) => {
    const enrolledAt = now - d.enrolledDays * DAY - 3 * HOUR;
    const agents = d.agents.map(([id, ver, mode, endpoint]) => provisionAgent(id, { os: d.os }, ORG, enrolledAt + 40_000, { version: ver, launchMode: mode, endpoint }));
    return { id: d.id, hostname: d.hostname, ownerId: d.ownerId, os: d.os, osLogo: d.osLogo, arch: d.arch, enrolledAt, runtimeVersion: RUNTIME_VERSION, policyBundleVersion: version, heartbeat: now - d.heartbeatMin * MIN, state: d.state, killSwitch: false, keyId: "SE:" + hex(r, 16), agents };
  });
  // Three days ago the Cursor adapter on tanvi-mbp was edited outside Wrapbox: rejected, the agent reclassified, the file rewritten nine minutes later.
  const tamperedAt = now - 3 * DAY - 5 * HOUR;
  const reprovisionedAt = tamperedAt + 9 * MIN;
  const tanvi = fleet.find((d) => d.id === "tanvi-mbp")!;
  const tanviCursor = tanvi.agents.find((a) => a.agentId === "cursor")!;
  tanviCursor.adapter = { ...tanviCursor.adapter!, state: "re-provisioned", writtenAt: reprovisionedAt };

  const gateways: GatewayNode[] = [{ id: "gw-us-east-1", region: "us-east-1", version: RUNTIME_VERSION, state: "healthy", heartbeat: now - 25_000, policyBundleVersion: version, upstreams: ["stripe-mcp", "github-mcp", "postgres-mcp"], brokered: ["api.stripe.com", "api.github.com"] }];
  const destinations = DESTINATIONS;
  const vault: VaultRef[] = VAULT.map((v, i) => ({ ...v, rotatedAt: now - (3 + i * 5) * DAY }));

  const sessions: SessionToken[] = [
    { id: "wbs_" + hex(r, 12), agentId: "claude-code", deviceId: "dk-macbook-pro", personId: "dev.k", issuedAt: now - 6 * MIN, ttlSeconds: 900, scope: ["github:pulls.write", "stripe:refunds.read"], state: "active" },
    { id: "wbs_" + hex(r, 12), agentId: "cursor", deviceId: "tanvi-mbp", personId: "tanvi.k", issuedAt: now - 11 * MIN, ttlSeconds: 900, scope: ["github:contents.read", "postgres:claims.read"], state: "active" },
    { id: "wbs_" + hex(r, 12), agentId: "langgraph", deviceId: "claims-worker-01", personId: "rahul.m", issuedAt: now - 14 * MIN, ttlSeconds: 900, scope: ["stripe:refunds.write", "postgres:claims.read"], state: "active" },
    { id: "wbs_" + hex(r, 12), agentId: "codex-cli", deviceId: "dk-macbook-pro", personId: "dev.k", issuedAt: now - 52 * MIN, ttlSeconds: 900, scope: ["github:contents.read"], state: "expired" },
    { id: "wbs_" + hex(r, 12), agentId: "windsurf", deviceId: "tanvi-mbp", personId: "tanvi.k", issuedAt: now - 3 * HOUR, ttlSeconds: 900, scope: ["github:contents.read"], state: "expired" },
    { id: "wbs_" + hex(r, 12), agentId: "cursor", deviceId: "tanvi-mbp", personId: "tanvi.k", issuedAt: tamperedAt - 4 * MIN, ttlSeconds: 900, scope: ["github:contents.read", "postgres:claims.read"], state: "revoked", revokedAt: tamperedAt + 20_000, revokedBy: "maya.s", reason: "adapter changed outside Wrapbox" },
  ];

  /* ---- decisions: fourteen days from each enrolled device and the Gateway ---- */
  const ctx = { rules: FABRIC_RULES, kill: false, members: REFERENCE_MEMBERS, allowed: REFERENCE_ALLOWED, admin: admin.id, attributeAsIs: true };
  const events: Evt[] = [];
  const first = Math.floor((now - FABRIC_LOG_DAYS * DAY) / HOUR) * HOUR;
  for (const seed of DEVICES) {
    const d = fleet.find((x) => x.id === seed.id)!;
    const stopAt = d.state === "healthy" ? now - 45_000 : d.heartbeat;
    // One weighted pool per device: an agent's share of the device's traffic is the sum of its template weights.
    const pool = d.agents.flatMap((a) => templatesFor(a.agentId, d.ownerId, a.endpoint).map((t) => ({ a, t })));
    const conn = Object.fromEntries(pool.map(({ t }) => [t.agentId, true]));
    for (let hs = Math.max(first, Math.floor(d.enrolledAt / HOUR) * HOUR); hs < stopAt; hs += HOUR) {
      const rate = seed.alwaysOn ? 10 : hourlyRate(new Date(hs)) * seed.rate;
      const n = Math.round(rate * (0.7 + 0.6 * r()));
      for (let i = 0; i < n; i++) {
        const ts = hs + Math.floor(r() * HOUR);
        if (ts > stopAt || ts < d.enrolledAt) continue;
        const t = pick(pool.map((x) => x.t), conn, r)!;
        const a = pool.find((x) => x.t === t)!.a;
        // The agent's launch mode as it was at that moment: tampered adapters are unmanaged until rewritten.
        const launchMode = a.agentId === tanviCursor.agentId && d.id === tanvi.id && ts >= tamperedAt && ts < reprovisionedAt ? "native-unmanaged" : a.launchMode;
        const p = provenanceFor(d, { ...a, launchMode }, "", destinations);
        const src = sourceFor(t.act.effect, launchMode === "wrapbox" || launchMode === "native-managed");
        events.push(mkEvt(stamp(t, { ...p, launchMode, source: src }, destinations), ts, "seed", ctx, r, nextId()));
      }
    }
  }
  const gw = gateways[0];
  for (let hs = Math.max(first, Math.floor((now - 14 * DAY) / HOUR) * HOUR); hs < now - 45_000; hs += HOUR) {
    const n = Math.round(hourlyRate(new Date(hs)) * 0.08 * (0.7 + 0.6 * r()));
    for (let i = 0; i < n; i++) {
      const ts = hs + Math.floor(r() * HOUR);
      if (ts > now - 45_000) continue;
      const t = pick(gatewayTemplates(), { "github-mcp": 1, "stripe-mcp": 1, "postgres-mcp": 1 }, r)!;
      events.push(mkEvt(stamp(t, { deviceId: gw.id, deviceState: "healthy", launchMode: "wrapbox", source: sourceFor(t.act.effect, false), coverage: "Remote" }, destinations), ts, "seed", ctx, r, nextId()));
    }
  }
  // The integrity finding itself, decided by the contract like everything else, and the model calls the
  // reclassified agent tried in the nine minutes before the Runtime rewrote its adapter.
  const unmanaged: Provenance = { deviceId: tanvi.id, deviceState: "healthy", launchMode: "native-unmanaged", source: "os_fs", coverage: "Floor" };
  events.push(mkEvt(stamp(T(tanviCursor.agentId, tanvi.ownerId, `Adapter integrity · ${tanviCursor.adapter!.path} changed outside Wrapbox`, { effect: "runtime.integrity", path: tanviCursor.adapter!.path, env: "development" }), unmanaged, destinations), tamperedAt, "seed", ctx, r, nextId()));
  for (const m of [1, 4, 7]) {
    const t = templatesFor(tanviCursor.agentId, tanvi.ownerId).find((x) => x.act.effect === "model.request")!;
    events.push(mkEvt(stamp(t, { ...unmanaged, source: "os_net" }, destinations), tamperedAt + m * MIN, "seed", ctx, r, nextId()));
  }
  // Two requests are open right now: a push to main waiting for on-call, and a refund above the automatic tier.
  const dk = fleet[0];
  const openNow: [Tpl, DiscoveredAgent, FleetDevice, number][] = [
    [T("claude-code", "dev.k", "Bash(git push origin main)", { effect: "git.push", branch: "main", command: "git push origin main", env: "development" }, 1), dk.agents[0], dk, 5 * MIN],
    [{ ...refund("dev.k", 1), vary: undefined, action: "stripe · create_refund(amount=142000)", act: { effect: "payments.refund", amount: 142000, amountUsd: 1420, env: "production" } }, dk.agents[0], dk, 17 * MIN],
  ];
  for (const [t, a, d, ago] of openNow) events.push(mkEvt(stamp(t, provenanceFor(d, a, t.act.effect, destinations), destinations), now - ago, "seed", ctx, r, nextId()));
  events.sort((a, b) => a.ts - b.ts);

  /* ---- approvals and receipts ---- */
  const approvals: Approval[] = [];
  const executed: Evt[] = [];
  for (const e of events) {
    if (e.decision !== "REVIEW" || !e.act) continue;
    const v = evaluate(e.act, FABRIC_RULES, categoryOf(e.agentId));
    const human = personById(e.human) ?? admin;
    const approvers = approversFor(v.approvers, human.id, REFERENCE_GROUPS, admin);
    const quorum = Math.min(v.quorum ?? 1, approvers.length);
    const gate = gateFromAct(e.id, e.action, e.act, v);
    const base = { gate, agentId: e.agentId, human, intent: intentFor(e), approvers, quorum, createdAt: e.ts, args: { ...e.act } };
    const age = now - e.ts;
    if (age < 30 * MIN) {
      approvals.push(approvalFrom({ ...base, approvedBy: quorum > 1 ? [approvers[0].id] : [], permitId: "wbp_" + hex(r, 8) }));
      continue;
    }
    const resolvedAt = e.ts + Math.floor((1 + r() * 20) * MIN);
    if (r() < 0.9) {
      const approvedBy = approvers.slice(0, quorum).map((p) => p.id);
      const permitId = "wbp_" + hex(r, 8);
      approvals.push(approvalFrom({ ...base, status: "approved", approvedBy, resolvedAt, permitId }));
      executed.push({ ...e, id: nextId(), ts: resolvedAt, decision: "ALLOW", reason: "approved · " + e.reason, permit: permitId, approvers: approvedBy });
    } else {
      const why = one(r, REJECTIONS);
      approvals.push(approvalFrom({ ...base, status: "rejected", resolvedAt, rejectReason: why }));
      executed.push({ ...e, id: nextId(), ts: resolvedAt, decision: "BLOCK", reason: `rejected by approver — ${why}` });
    }
  }
  const log = [...events, ...executed].sort((a, b) => b.ts - a.ts);
  approvals.sort((a, b) => b.createdAt - a.createdAt);

  return {
    workspace: "fabric",
    ...REFERENCE_ORG,
    role: "admin",
    theme: "light",
    connected: connectedFrom(fleet, gateways),
    events: log,
    approvals,
    killSwitch: false,
    live: true,
    rules: FABRIC_RULES,
    published: FABRIC_RULES,
    version,
    publishedAt: changelog[changelog.length - 1].at,
    changelog,
    toasts: [],
    tour: null,
    palette: false,
    requests: [],
    allowed: REFERENCE_ALLOWED,
    baseline: { decisions: 0, blocked: 0, rewritten: 0 },
    passkey: null,
    onboarded: { admin: true, employee: true },
    groups: REFERENCE_GROUPS,
    members: REFERENCE_MEMBERS,
    devices: [],
    envFilter: "all",
    fleet,
    gateways,
    vault,
    sessions,
    destinations,
  };
}
