// The production reference workspace: a company that adopted Wrapbox about three months ago and
// runs it every day. Nothing here is typed into a page — every number on every screen is derived
// from the records this file generates, and every decision record was produced by the runtime
// evaluator over the workspace's published contract.

import { METHODS, agentById } from "./agents";
import { INITIAL_RULES, type Rule } from "./contract";
import { PEOPLE, personById } from "./people";
import type { AccessRequest, Approval, ContractChange, Device, Evt, Member, State } from "../lib/store";
import { evaluate } from "../lib/engine";
import { T, approvalFrom, approversFor, categoryOf, gateFromAct, hex, mkEvt, pick, rng, type Tpl } from "../lib/traffic";

export const REFERENCE_ORG = { company: "Oakridge Mutual", domain: "oakridgemutual.com", region: "us", idp: "Okta" } as const;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Hot retention of the decision log shown in the product. Older decisions live in the SIEM export. */

/* ================= people ================= */
const M = (id: string, roles: string[], status: Member["status"] = "active"): Member => ({ id, roles, status });
const MEMBERS: Member[] = [
  M("priya.m", ["Admin", "Owner"]),
  M("maya.s", ["Admin", "Security"]),
  M("dev.k", ["Developer", "Approver · oncall-sre"]),
  M("arjun.n", ["Developer", "Approver · oncall-sre"]),
  M("rahul.m", ["Developer", "Approver · oncall-sre"]),
  M("tanvi.k", ["Developer"]),
  M("jonas.w", ["Developer"]),
  M("ishaan.p", ["Developer"]),
  M("omar.h", ["Developer"]),
  M("sneha.g", ["IT admin"]),
  M("sara.t", ["Support", "Approver · payments-manager"]),
  M("farah.a", ["Support"]),
  M("leah.c", ["Approver · payments-manager"]),
  M("anjali.v", ["Business user"]),
  M("nikhil.r", ["Business user"]),
  M("meera.i", ["Approver · claims-manager"]),
  M("rohan.d", ["Approver · claims-manager"]),
  M("ananya.r", ["Approver · vp-sales"]),
  M("vikram.s", ["Approver · finance-controller"]),
  M("kiran.b", ["Business user"]),
  M("neha.j", ["Business user"], "invited"),
];

const GROUPS: State["groups"] = {
  "oncall-sre": ["dev.k", "arjun.n", "rahul.m"],
  "claims-manager": ["meera.i", "rohan.d"],
  "payments-manager": ["sara.t", "leah.c"],
  "sales-manager": ["ananya.r"],
  "vp-sales": ["ananya.r"],
  "finance-controller": ["vikram.s"],
  security: ["maya.s"],
};

const ALLOWED: State["allowed"] = {
  "dev.k": ["cursor", "claude-code", "codex-cli", "github-mcp"],
  "arjun.n": ["claude-code", "cursor", "copilot-ide", "copilot-cloud", "github-mcp", "postgres-mcp"],
  "rahul.m": ["claude-code", "codex-cli", "github-mcp"],
  "tanvi.k": ["cursor", "windsurf", "github-mcp"],
  "jonas.w": ["claude-code", "copilot-ide", "copilot-cloud", "github-mcp"],
  "ishaan.p": ["claude-code", "postgres-mcp"],
  "omar.h": ["claude-code", "postgres-mcp"],
  "maya.s": ["claude-code"],
  "sara.t": ["stripe-mcp", "postgres-mcp"],
  "farah.a": ["stripe-mcp"],
  "anjali.v": ["langgraph"],
  "nikhil.r": ["langgraph"],
};

/* ================= agents: rollout waves ================= */
const method = (agentId: string, id: string) => {
  const m = METHODS[agentById(agentId).category].find((x) => x.id === id)!;
  return { method: m.id, assurance: m.assurance };
};
/** [agent, method, days since connected] — coding agents first, the MCP gateway a month later, the claims agent last. */
const ROLLOUT: [string, string, number][] = [
  ["claude-code", "runtime", 84],
  ["cursor", "runtime", 84],
  ["codex-cli", "hook", 71],
  ["copilot-ide", "hook", 63],
  ["github-mcp", "gateway", 58],
  ["postgres-mcp", "gateway", 58],
  ["stripe-mcp", "gateway", 45],
  ["windsurf", "hook", 40],
  ["copilot-cloud", "gateway", 30],
  ["langgraph", "verified", 22],
];

/* ================= laptops ================= */
const A = (name: string, logo: string, state: Device["agents"][number]["state"] = "protected", note?: string, issue?: Device["agents"][number]["issue"]) => ({ name, logo, state, note, issue });
const D = (id: string, ownerId: string, os: string, osLogo: string, mdm: string, cli: string, seenMin: number, agents: Device["agents"]): Device => ({ id, ownerId, os, osLogo, mdm, cli, seen: 0 - seenMin * MIN, agents });
const DEVICES: Device[] = [
  D("dk-macbook-pro", "dev.k", "macOS 15.6", "apple", "Jamf", "1.4.2", 2, [A("Cursor", "cursor", "protected", "hooks.json · failClosed"), A("Claude Code", "claudecode", "protected", "managed settings"), A("Codex CLI", "codex", "protected", "~/.codex/hooks.json")]),
  D("dev-linux-01", "dev.k", "Ubuntu 24.04", "ubuntu", "—", "1.4.2", 60, [A("Codex CLI", "codex", "degraded", "token expires in 2 days", { kind: "key", detail: "expires in 2 days" })]),
  D("arjun-mbp", "arjun.n", "macOS 15.6", "apple", "Jamf", "1.4.1", 6, [A("Claude Code", "claudecode", "protected", "managed settings"), A("Cursor", "cursor", "degraded", ".cursor/hooks.json removed 14m ago · runtime still enforcing", { kind: "hook", detail: ".cursor/hooks.json was deleted 14 minutes ago" }), A("Copilot agent mode", "githubcopilot", "protected", ".github/hooks")]),
  D("rahul-mbp", "rahul.m", "macOS 15.6", "apple", "Jamf", "1.4.2", 11, [A("Claude Code", "claudecode", "protected", "managed settings"), A("Codex CLI", "codex", "protected", "~/.codex/hooks.json")]),
  D("tanvi-mbp", "tanvi.k", "macOS 15.5", "apple", "Jamf", "1.4.2", 4, [A("Cursor", "cursor", "protected", "hooks.json · failClosed"), A("Windsurf", "windsurf", "protected", ".windsurf/hooks.json")]),
  D("jonas-thinkpad", "jonas.w", "Windows 11", "windows", "Intune", "1.4.2", 18, [A("Claude Code", "claudecode", "protected", "managed settings"), A("Copilot agent mode", "githubcopilot", "protected", ".github/hooks")]),
  D("ishaan-mbp", "ishaan.p", "macOS 15.6", "apple", "Jamf", "1.4.2", 26, [A("Claude Code", "claudecode", "protected", "managed settings"), A("Cline", "cline", "shadow", "found by the endpoint runtime · not in the contract")]),
  D("omar-linux", "omar.h", "Ubuntu 24.04", "ubuntu", "—", "1.4.2", 180, [A("Claude Code", "claudecode", "protected", "managed settings")]),
  D("sara-mbp", "sara.t", "macOS 15.5", "apple", "Jamf", "1.4.2", 14, [A("Claude (MCP via gateway)", "claude", "protected", "mcp.wrapbox.ai/stripe")]),
  D("farah-win", "farah.a", "Windows 11", "windows", "Intune", "1.4.2", 41, [A("Claude (MCP via gateway)", "claude", "protected", "mcp.wrapbox.ai/stripe")]),
  D("maya-mbp", "maya.s", "macOS 15.6", "apple", "Jamf", "1.4.2", 9, [A("Claude Code", "claudecode", "protected", "managed settings")]),
  D("priya-mbp", "priya.m", "macOS 15.6", "apple", "Jamf", "1.4.2", 33, [A("Claude Code", "claudecode", "protected", "managed settings")]),
  D("sneha-win", "sneha.g", "Windows 11", "windows", "Intune", "1.4.2", 120, []),
  D("anjali-win", "anjali.v", "Windows 11", "windows", "Intune", "—", 60, []),
  D("nikhil-win", "nikhil.r", "Windows 11", "windows", "Intune", "—", 190, []),
];

/* ================= the contract: the starter packs plus two rules this company wrote ================= */
const PROD_DEPLOY: Rule = {
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
const PROD_TERRAFORM: Rule = {
  id: "prod.terraform",
  title: "Terraform applies in production are watched",
  why: "Rolled out in observe mode first: see what would be held before it is enforced.",
  when: { effect: ["shell.exec"], command: ["terraform apply*", "tofu apply*"], env: ["production"] },
  decision: "REVIEW",
  approvers: "oncall-sre",
  mode: "observe",
  scope: "coding",
  custom: true,
};
export const REFERENCE_RULES: Rule[] = [...INITIAL_RULES, PROD_DEPLOY, PROD_TERRAFORM];

/** Every publish since go-live. Rule ids reference rules that exist in the contract above. */
const C = (version: number, daysAgo: number, by: string, summary: string, o: Partial<Pick<ContractChange, "added" | "changed" | "removed">> = {}): Omit<ContractChange, "at"> & { daysAgo: number } => ({ version, daysAgo, by, summary, added: o.added ?? [], changed: o.changed ?? [], removed: o.removed ?? [] });
const CHANGELOG = [
  C(1, 88, "priya.m", "Initial contract from the recommended packs", { added: ["secrets.read", "network.egress", "git.main", "git.force", "git.feature", "agent.delegate"] }),
  C(2, 86, "priya.m", "Production pack, in observe mode", { added: ["prod.k8s.delete", "prod.db.migrate", "db.prod.write"] }),
  C(3, 84, "priya.m", "Secrets and source-control rules switched to enforce", { changed: ["secrets.read", "network.egress", "git.main", "git.force"] }),
  C(4, 79, "priya.m", "Customer data pack", { added: ["pii.read"] }),
  C(5, 77, "priya.m", "Production pack switched to enforce", { changed: ["prod.k8s.delete", "prod.db.migrate", "db.prod.write"] }),
  C(6, 70, "maya.s", "Egress allowlist: add registry.npmjs.org and pypi.org", { changed: ["network.egress"] }),
  C(7, 64, "priya.m", "Feature-branch patterns for Copilot and Codex branches", { changed: ["git.feature"] }),
  C(8, 58, "maya.s", "Payments pack: refund tiers", { added: ["payments.refund"] }),
  C(9, 55, "maya.s", "Refund auto-approve raised to $500 after two weeks of review data", { changed: ["payments.refund"] }),
  C(10, 50, "priya.m", "Claims payout tiers", { added: ["claims.payout"] }),
  C(11, 46, "maya.s", "Two-person rule above ₹2,00,000", { changed: ["claims.payout"] }),
  C(12, 44, "priya.m", "Commercial pack", { added: ["crm.discount"] }),
  C(13, 40, "maya.s", "Browser payments gated at the final click", { added: ["browser.payment"] }),
  C(14, 36, "maya.s", "PII columns: add pan and aadhaar", { changed: ["pii.read"] }),
  C(15, 33, "priya.m", "Production deploys need on-call, in observe mode", { added: ["prod.deploy"] }),
  C(16, 27, "maya.s", "prod.deploy: require green CI on the commit", { changed: ["prod.deploy"] }),
  C(17, 24, "maya.s", "prod.deploy switched to enforce · single-use 120 s permit", { changed: ["prod.deploy"] }),
  C(18, 19, "priya.m", "Discount authority: VP Sales above 25%", { changed: ["crm.discount"] }),
  C(19, 15, "maya.s", "Egress allowlist: add api.wrapbox.ai", { changed: ["network.egress"] }),
  C(20, 12, "priya.m", "Refund tiers: block above $5,000", { changed: ["payments.refund"] }),
  C(21, 8, "maya.s", "prod.k8s.delete: permit TTL 60 s", { changed: ["prod.k8s.delete"] }),
  C(22, 5, "maya.s", "Force-push rewrite also covers -f", { changed: ["git.force"] }),
  C(23, 3, "maya.s", "Terraform applies in production, in observe mode", { added: ["prod.terraform"] }),
];

/* ================= what agents do here, day to day ================= */
const FILES = ["src/claims/intake.ts", "src/claims/assess.ts", "src/billing/invoice.ts", "src/payments/refund.ts", "api/routes/claims.ts", "api/routes/policies.ts", "web/src/pages/claims/[id].tsx", "web/src/components/ClaimForm.tsx", "infra/charts/payments/values.yaml", "services/ledger/handler.go", "services/billing/cycle.ts", "pipelines/dbt/models/claims.sql", "README.md", "package.json", "web/src/lib/format.ts"];
const one = <X,>(r: () => number, xs: X[]) => xs[Math.floor(r() * xs.length)];
const logU = (r: () => number, lo: number, hi: number, skew = 3) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * Math.pow(r(), skew));
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

const read = (agent: string, human: string, w: number): Tpl => ({ ...T(agent, human, "Read", { effect: "filesystem.read", path: "/oakridge/README.md", env: "development" }, w), vary: (r) => { const f = one(r, FILES); return { action: `Read ${f}`, act: { effect: "filesystem.read", path: `/oakridge/${f}`, env: "development" } }; } });
const edit = (agent: string, human: string, w: number): Tpl => ({ ...T(agent, human, "Edit", { effect: "filesystem.write", path: "/oakridge/README.md", env: "development" }, w), vary: (r) => { const f = one(r, FILES); return { action: `Edit ${f}`, act: { effect: "filesystem.write", path: `/oakridge/${f}`, env: "development" } }; } });
const shell = (agent: string, human: string, cmds: string[], w: number, wrap = (c: string) => `Bash(${c})`): Tpl => ({ ...T(agent, human, wrap(cmds[0]), { effect: "shell.exec", command: cmds[0], env: "development" }, w), vary: (r) => { const c = one(r, cmds); return { action: wrap(c), act: { effect: "shell.exec", command: c, env: "development" } }; } });
const secret = (agent: string, human: string, w: number): Tpl => ({ ...T(agent, human, "Read .env.local", { effect: "filesystem.read", path: "/oakridge/web/.env.local", env: "development" }, w), vary: (r) => { const f = one(r, [".env.local", ".env.production", "config/keys/id_rsa", "deploy/prod.pem"]); return { action: `Read ${f}`, act: { effect: "filesystem.read", path: `/oakridge/${f.startsWith(".env") ? "web/" : ""}${f}`, env: "development" } }; } });
const featurePush = (agent: string, human: string, w: number, wrap = (c: string) => `Bash(${c})`): Tpl => ({ ...T(agent, human, "push", { effect: "git.push", branch: "feat/x", command: "git push origin feat/x", env: "development" }, w), vary: (r) => { const b = one(r, ["feat/claims-intake-v2", "feat/refund-ledger", "feat/policy-search", "feature/annual-billing", "codex/flaky-tests", "feat/claim-form-a11y"]); return { action: wrap(`git push origin ${b}`), act: { effect: "git.push", branch: b, command: `git push origin ${b}`, env: "development" } }; } });
const claim = (human: string, w: number): Tpl => ({ ...T("langgraph", human, "pay_claim", { effect: "claims.payout", amount: 9800, env: "production" }, w), vary: (r) => { const amt = Math.round(logU(r, 1500, 420000) / 100) * 100; const id = 5100 + Math.floor(r() * 900); return { action: `pay_claim(CLM-${id}, ${inr(amt)})`, act: { effect: "claims.payout", amount: amt, env: "production" } }; } });
const refund = (human: string, w: number): Tpl => ({ ...T("stripe-mcp", human, "stripe · create_refund", { effect: "payments.refund", amount: 4500, amountUsd: 45, env: "production" }, w), vary: (r) => { const usd = Math.round(logU(r, 8, 9000)); return { action: `stripe · create_refund(amount=${usd * 100})`, act: { effect: "payments.refund", amount: usd * 100, amountUsd: usd, env: "production" } }; } });
const sqlRead = (human: string, w: number): Tpl => ({ ...T("postgres-mcp", human, "postgres-prod · execute_sql", { effect: "database.read", columns: ["status"], sql: "SELECT status, count(*) FROM claims GROUP BY 1", env: "production" }, w), vary: (r) => { const q = one(r, [["SELECT status, count(*) FROM claims GROUP BY 1", ["status", "count(*)"]], ["SELECT id, amount FROM payouts WHERE settled_at IS NULL", ["id", "amount"]], ["SELECT count(*) FROM policies WHERE renews_at < now() + interval '30 days'", ["count(*)"]], ["SELECT plan, avg(premium) FROM policies GROUP BY 1", ["plan", "avg(premium)"]]] as [string, string[]][]); return { action: `postgres-prod · execute_sql(${q[0].slice(0, 44)}…)`, act: { effect: "database.read", columns: q[1], sql: q[0], env: "production" } }; } });


/* ================= work-day shape ================= */
const PEAK_PER_HOUR = 150;
function hourlyRate(t: Date) {
  const h = t.getHours();
  const d = t.getDay();
  const weekend = d === 0 || d === 6;
  // Claims keep arriving and hosted runners keep working at night and on weekends; laptops mostly don't.
  const core = h >= 9 && h < 18 ? 1 : h >= 7 && h < 21 ? 0.42 : 0.1;
  return (weekend ? 0.35 : 1) * core * PEAK_PER_HOUR;
}

const REJECTIONS = ["Use `rollout restart` instead", "Wrong target", "Needs a change ticket", "Amount doesn't match the case"];

function intentFor(e: Evt): string {
  const agent = agentById(e.agentId).name;
  const human = personById(e.human)?.name ?? e.human;
  if (e.effect === "claims.payout") return `Process ${e.action.match(/CLM-\d+/)?.[0] ?? "the claim"} · hospitalization · documents verified`;
  if (e.effect === "payments.refund") return `Refund the customer's last charge — duplicate order, support ticket attached`;
  if (/helm upgrade/.test(e.action)) return `Ship the ${e.action.match(/upgrade (\S+)/)?.[1] ?? "service"} hotfix to production`;
  if (/kubectl delete/.test(e.action)) return "Recover the stuck payments rollout";
  return `${agent} session for ${human}`;
}


/* The v2 workspace is the same company one product version later, so it shares the directory,
   the approver groups, the template vocabulary and the contract history up to the pilot. */
export { MEMBERS as REFERENCE_MEMBERS, GROUPS as REFERENCE_GROUPS, ALLOWED as REFERENCE_ALLOWED, CHANGELOG as REFERENCE_CHANGELOG, REJECTIONS, hourlyRate, intentFor, one, read, edit, shell, secret, featurePush, claim, refund, sqlRead };
