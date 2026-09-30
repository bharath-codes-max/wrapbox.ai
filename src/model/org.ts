// ============================================================================
// Veridian Systems — coherent fictional enterprise. Identities used everywhere
// so every screen agrees on who did what with which agent against what.
// ============================================================================

export interface OrgUser {
  id: string;
  name: string;
  role: string;
  email: string;
}
export interface OrgDevice {
  id: string;
  name: string;
  owner: string;
  os: string;
  enrolled: boolean;
}
export interface OrgAgent {
  id: string;
  name: string;
  provider: string;
  kind: "coding" | "chat" | "internal" | "copilot" | "browser" | "hosted" | "supplier" | "unknown";
  owner?: string; // Veridian person accountable for it (for a supplier agent: its sponsor)
  device?: string; // a laptop in DEVICES, or a host in HOSTS for agents that don't run on one
  /** Where it runs: a Veridian laptop, a hosted agent platform, or a supplier's own systems. */
  location?: "laptop" | "cloud" | "supplier";
  /** Supplier that operates it (SUPPLIERS id). Absent = Veridian's own agent. */
  operator?: string;
  environment: string;
  tools: string[];
  destinations: string[];
  discovered: boolean; // true = auto-discovered, not registered
  trust: "trusted" | "conditional" | "untrusted" | "unknown";
  risk: "low" | "moderate" | "high" | "critical";
}
export interface OrgResource {
  id: string;
  name: string;
  kind: "repo" | "database" | "cloud" | "saas" | "mcp" | "file" | "secret";
  environment: "development" | "test" | "staging" | "production" | "local";
  sensitivity: "disposable" | "internal" | "sensitive" | "customer-impacting";
  detail: string;
}

/** The demo company. The live prototype (index.html sets data-ds="desktop") shows it as
 *  Glycon; tests and the decks (tour.html) keep Veridian, which their narration uses. */
const LIVE_PROTOTYPE = typeof document !== "undefined" && document.documentElement.dataset.ds === "desktop";
export const ORG = LIVE_PROTOTYPE
  ? { name: "Glycon", short: "Glycon", slug: "glycon", domain: "glycon.example" }
  : { name: "Veridian Systems", short: "Veridian", slug: "veridian", domain: "veridian.example" };

/** A third party whose agents act inside Veridian's systems (supplier agents).
 *  The contract scope is what Veridian's vendor review approved — the agent
 *  gets no more than this, and nothing at all once the contract ends. */
export interface Supplier {
  id: string;
  name: string;
  service: string;
  contractEnds: string;        // ISO date; after it, the supplier's agents hold no authority
  scopeResources: string[];    // RESOURCES ids the contract covers
  scopeActions: string[];      // action verbs the contract covers
  dpa: boolean;                // data processing agreement signed (personal/financial data allowed)
  sponsor: string;             // Veridian person accountable for the relationship
  reviewedBy: string;          // who approved the vendor review
}

export const SUPPLIERS: Supplier[] = [
  {
    id: "sup-meridian", name: "Meridian Partners", service: "Payment reconciliation",
    contractEnds: "2027-03-31", scopeResources: ["r-stripe"], scopeActions: ["READ"],
    dpa: true, sponsor: "u-sam", reviewedBy: "u-maya",
  },
  {
    id: "sup-northwind", name: "Northwind BPO", service: "Tier-1 support outsourcing",
    contractEnds: "2026-09-01", scopeResources: ["r-support-saas"], scopeActions: ["READ", "WRITE"],
    dpa: true, sponsor: "u-jordan", reviewedBy: "u-maya",
  },
];

export function supplierById(id?: string) { return id ? SUPPLIERS.find((x) => x.id === id) : undefined; }
/** A supplier contract is live until the end of its last day. */
export function supplierActive(sp: Supplier, now = Date.now()): boolean {
  return now < new Date(`${sp.contractEnds}T23:59:59Z`).getTime();
}

/** Non-laptop places agents run (hosted platforms, supplier systems). Kept apart
 *  from DEVICES so laptop counts and enrolment stay about laptops. */
export const HOSTS: OrgDevice[] = [
  { id: "host-agentcore", name: "AWS AgentCore runtime · us-east-1", owner: "u-sam", os: "Hosted agent platform", enrolled: true },
  { id: "host-meridian", name: "Meridian Partners systems", owner: "u-sam", os: "Supplier-operated", enrolled: false },
  { id: "host-northwind", name: "Northwind BPO systems", owner: "u-jordan", os: "Supplier-operated", enrolled: false },
];

export const USERS: OrgUser[] = [
  { id: "u-priya", name: "Priya Menon", role: "Admin", email: `priya.menon@${ORG.domain}` },
  { id: "u-daniel", name: "Daniel Kim", role: "Developer", email: `daniel.kim@${ORG.domain}` },
  { id: "u-maya", name: "Maya Chen", role: "Security Analyst", email: `maya.chen@${ORG.domain}` },
  { id: "u-alex", name: "Alex Morgan", role: "Engineering Manager", email: `alex.morgan@${ORG.domain}` },
  { id: "u-sam", name: "Sam Rivera", role: "Finance Controller", email: `sam.rivera@${ORG.domain}` },
  { id: "u-jordan", name: "Jordan Lee", role: "Support Lead", email: `jordan.lee@${ORG.domain}` },
];

export const DEVICES: OrgDevice[] = [
  { id: "d-priya-mbp", name: "Priya-MBP", owner: "u-priya", os: "macOS 15.6", enrolled: true },
  { id: "d-daniel-mbp", name: "Daniel-MBP", owner: "u-daniel", os: "macOS 15.5", enrolled: true },
  { id: "d-maya-mbp", name: "Maya-MBP", owner: "u-maya", os: "macOS 15.6", enrolled: true },
  { id: "d-fin-07", name: "Finance-Laptop-07", owner: "u-alex", os: "macOS 14.7", enrolled: true },
  { id: "d-sam-mbp", name: "Sam-MBP", owner: "u-sam", os: "macOS 15.6", enrolled: true },
  { id: "d-jordan-mbp", name: "Jordan-MBP", owner: "u-jordan", os: "macOS 15.5", enrolled: true },
];

export const AGENTS: OrgAgent[] = [
  {
    id: "a-claude-code", name: "Claude Code", provider: "Anthropic", kind: "coding",
    owner: "u-daniel", device: "d-daniel-mbp", environment: "development",
    tools: ["shell", "file system", "GitHub MCP", "npm"], destinations: ["dest-claude", "dest-internal"],
    discovered: false, trust: "conditional", risk: "moderate",
  },
  {
    id: "a-codex", name: "Codex", provider: "OpenAI", kind: "coding",
    owner: "u-daniel", device: "d-daniel-mbp", environment: "development",
    tools: ["shell", "file system"], destinations: ["dest-chatgpt"],
    discovered: false, trust: "conditional", risk: "moderate",
  },
  {
    id: "a-chatgpt", name: "ChatGPT", provider: "OpenAI", kind: "chat",
    owner: "u-priya", device: "d-priya-mbp", environment: "local",
    tools: ["browser"], destinations: ["dest-chatgpt"],
    discovered: false, trust: "trusted", risk: "low",
  },
  {
    id: "a-claude", name: "Claude", provider: "Anthropic", kind: "chat",
    owner: "u-maya", device: "d-maya-mbp", environment: "local",
    tools: ["browser"], destinations: ["dest-claude"],
    discovered: false, trust: "trusted", risk: "low",
  },
  {
    id: "a-copilot", name: "Microsoft Copilot", provider: "Microsoft", kind: "copilot",
    owner: "u-alex", device: "d-fin-07", environment: "local",
    tools: ["browser", "M365"], destinations: ["dest-approved-ai"],
    discovered: false, trust: "trusted", risk: "low",
  },
  {
    id: "a-finance", name: "Internal Finance Agent", provider: `${ORG.short} (internal)`, kind: "internal",
    owner: "u-alex", device: "d-fin-07", environment: "production",
    tools: ["SQL MCP", "reporting API"], destinations: ["dest-internal"],
    discovered: false, trust: "conditional", risk: "high",
  },
  {
    id: "a-support", name: "Support Agent", provider: `${ORG.short} (internal)`, kind: "internal",
    owner: "u-maya", device: "d-maya-mbp", environment: "production",
    tools: ["Support SaaS API", "customer-db (read)"], destinations: ["dest-salesforce", "dest-internal"],
    discovered: false, trust: "conditional", risk: "moderate",
  },
  {
    id: "a-unknown-mcp", name: "Unknown MCP agent", provider: "unidentified", kind: "unknown",
    device: "d-fin-07", environment: "local",
    tools: ["unknown MCP server (tcp/7823)"], destinations: ["dest-unknown"],
    discovered: true, trust: "unknown", risk: "critical",
  },
  {
    id: "a-claude-chrome", name: "Claude in Chrome", provider: "Anthropic", kind: "browser",
    owner: "u-jordan", device: "d-jordan-mbp", location: "laptop", environment: "local",
    tools: ["managed Chrome", "page actions (click, fill, submit)"], destinations: ["dest-salesforce", "dest-unapproved-ai"],
    discovered: false, trust: "conditional", risk: "moderate",
  },
  {
    id: "a-billing-hosted", name: "Billing Agent", provider: `${ORG.short} · hosted on AWS AgentCore`, kind: "hosted",
    owner: "u-sam", device: "host-agentcore", location: "cloud", environment: "production",
    tools: ["AgentCore Gateway", "Stripe refund tool", "SQL tool"], destinations: ["dest-internal"],
    discovered: false, trust: "conditional", risk: "high",
  },
  {
    id: "a-meridian-recon", name: "Meridian Recon Agent", provider: "Meridian Partners (supplier)", kind: "supplier",
    owner: "u-sam", device: "host-meridian", location: "supplier", operator: "sup-meridian", environment: "production",
    tools: ["Stripe API (read)"], destinations: ["dest-partner"],
    discovered: false, trust: "conditional", risk: "moderate",
  },
  {
    id: "a-northwind-desk", name: "Northwind Helpdesk Agent", provider: "Northwind BPO (supplier)", kind: "supplier",
    owner: "u-jordan", device: "host-northwind", location: "supplier", operator: "sup-northwind", environment: "production",
    tools: ["Support SaaS API"], destinations: ["dest-salesforce"],
    discovered: false, trust: "untrusted", risk: "high",
  },
];

export const RESOURCES: OrgResource[] = [
  { id: "r-checkout", name: "checkout-service", kind: "repo", environment: "development", sensitivity: "internal", detail: `GitHub · ${ORG.slug}/checkout-service · 214 files` },
  { id: "r-payments-prod", name: "payments-prod", kind: "database", environment: "production", sensitivity: "customer-impacting", detail: "PostgreSQL 16 · 8,421,392 customer rows" },
  { id: "r-customer-db", name: "customer-db", kind: "database", environment: "production", sensitivity: "customer-impacting", detail: "PostgreSQL 16 · 2,914,006 rows" },
  { id: "r-test-db", name: "scratch-test-db", kind: "database", environment: "test", sensitivity: "disposable", detail: "PostgreSQL 16 · 12 rows · disposable fixture" },
  { id: "r-aws-prod", name: "AWS Production", kind: "cloud", environment: "production", sensitivity: "customer-impacting", detail: "Account 84115520 · us-east-1" },
  { id: "r-aws-staging", name: "AWS Staging", kind: "cloud", environment: "staging", sensitivity: "internal", detail: "Account 84115521 · us-east-1" },
  { id: "r-github", name: "GitHub Organization", kind: "saas", environment: "production", sensitivity: "sensitive", detail: `github.com/${ORG.slug} · 38 repos` },
  { id: "r-stripe", name: "Stripe payments", kind: "saas", environment: "production", sensitivity: "customer-impacting", detail: `Stripe · refunds and charges for ${ORG.short} customers` },
  { id: "r-support-saas", name: "Support SaaS", kind: "saas", environment: "production", sensitivity: "sensitive", detail: "Salesforce Service Cloud" },
  { id: "r-env-file", name: ".env", kind: "secret", environment: "local", sensitivity: "sensitive", detail: "Local secrets file · 6 credentials" },
  { id: "r-src", name: "src/", kind: "file", environment: "local", sensitivity: "internal", detail: "Local working tree of checkout-service" },
  { id: "r-mcp-unknown", name: "Unknown MCP server", kind: "mcp", environment: "local", sensitivity: "sensitive", detail: "tcp/7823 · unregistered · discovered 2d ago" },
];

export function userById(id: string) { return USERS.find((u) => u.id === id); }
export function deviceById(id: string) { return DEVICES.find((d) => d.id === id) ?? HOSTS.find((h) => h.id === id); }
/** The laptop a person works on — actions happen on the user's device, not the agent's. */
export function deviceOfUser(userId: string) { return DEVICES.find((d) => d.owner === userId); }
export function agentById(id: string) { return AGENTS.find((a) => a.id === id); }
/** Where an action by this agent physically happens: the person's own laptop for
 *  laptop agents, the agent's host for hosted and supplier-operated agents. */
export function deviceForAction(agentId: string, userId: string): string {
  const a = agentById(agentId);
  if (a && a.location && a.location !== "laptop" && a.device) return a.device;
  return deviceOfUser(userId)?.id ?? a?.device ?? "unknown-device";
}
export function resourceById(id: string) { return RESOURCES.find((r) => r.id === id); }
