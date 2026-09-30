// The Enforcement Playground CORE — the data and engine wiring behind the
// click-driven demo.
//
// Every verdict this module returns is computed by the REAL policy engine in
// src/lib/engine.ts (evaluate / rewrite / permitCheck) against the REAL Rule
// objects below, using the shared matcher checkRule(). Nothing here hardcodes a
// decision the engine could compute, and no rule matches on agent identity — so
// swapping the agent genuinely cannot change the answer.
//
// The surroundings (browser chrome, IDE, SQL console, cloud console) are
// simulated. The decisions are not. Prove it with:
//   npx tsx src/data/playground.selftest.ts
//
// What is real here:   the rules, the matcher, every decision, the rewrite of a
//                      force-push and of a PII SELECT, the permit check.
// What is simulated:   the systems being acted on (Stripe, Postgres, GitHub,
//                      AWS, Slack, Salesforce) and the agent surfaces.

import { evaluate, permitCheck, rewrite, type Act, type Verdict } from "../lib/engine";
import type { CategoryId, Decision } from "./agents";
import type { Rule } from "./contract";

/* ============================================================================
 * Types the UI codes against
 * ========================================================================== */

export type Plane = "runtime" | "gateway";

export type SurfaceGroup =
  | "runtime-browser"
  | "runtime-ide"
  | "runtime-agent"
  | "gateway-mcp"
  | "gateway-database"
  | "gateway-deploy"
  | "gateway-cloud"
  | "gateway-saas";

export type AgentPool = "runtime" | "browser" | "cloud";

export interface ScenarioAction {
  id: string;
  label: string;
  intent: string;
  detail?: string;
  act: Act;
  agentPool: AgentPool;
  defaultAgent: string;
  /** Plain-English sentence for the "Why?" drawer, describing the RULE not the outcome. */
  why: string;
  /** What actually happens to the action. */
  result: Record<Decision, string> | string;
}

export interface Surface {
  id: string;
  group: SurfaceGroup;
  plane: Plane;
  title: string;
  subtitle: string;
  /** lucide icon name, resolved by the UI's own map — the fallback when no vendor mark exists */
  icon: string;
  /** Vendor mark in src/assets/logos, rendered through <Logo>. Absent only for surfaces with no vendor (an unknown agent). */
  logo?: string;
  chrome: "browser" | "ide" | "app" | "console" | "sql" | "payments" | "repo" | "cloud" | "chat";
  actions: ScenarioAction[];
}

export interface PolicyToggle {
  id: string;
  label: string;
  ruleIds: string[];
  defaultOn: boolean;
}

/* ============================================================================
 * The intent contract — the plain English the admin zone shows, and what the
 * rules below compile it into.
 * ========================================================================== */

export const INTENT_CONTRACT = [
  "AI may use approved tools, but never expose secrets or customer PII.",
  "Production and destructive actions need approval.",
];

/** Destinations the company has approved for AI traffic. */
const APPROVED_AI = ["claude.ai", "api.anthropic.com", "chatgpt.com", "api.openai.com", "gemini.google.com", "copilot.microsoft.com"];

/** Every destination the company has sanctioned — approved AI plus its own systems. */
const APPROVED_SYSTEMS = [...APPROVED_AI, "api.github.com", "github.com", "amazonaws.com", "slack.com", "salesforce.com", "api.stripe.com", "warehouse.wrapbox.internal"];

/* ============================================================================
 * PLAYGROUND_RULES — the intent contract as real Rule objects.
 *
 * Order matters only for ties at the same decision rank: the engine sorts
 * matched rules by strictness (BLOCK > REVIEW > CONSTRAIN > ALLOW) with a
 * stable sort, so the first rule in this array wins an equal-rank tie. The
 * array is therefore ordered specific-first, with the broad ALLOW catch-all
 * ahead of the escalation-driven posture rules whose base decision is also
 * ALLOW, so receipts name the rule a reader would expect.
 * ========================================================================== */

export const PLAYGROUND_RULES: Rule[] = [
  {
    id: "secrets-never",
    title: "Secret material is never read by an agent",
    why: "Exfiltration starts with a read. Credentials, private keys and .env files are off-limits to every agent on every surface, however the read is routed.",
    when: {
      effect: ["filesystem.read", "filesystem.write"],
      path: ["**/.env", "**/.env*", "**/*.pem", "**/*.key", "**/id_rsa*", "**/.aws/credentials", "**/credentials.json", "**/secrets.json", "**/secrets.yml", "**/secrets.yaml"],
    },
    decision: "BLOCK",
    scope: "all",
  },
  {
    id: "pii-egress",
    title: "Customer PII only leaves to approved systems",
    why: "Data carrying customer PII may only reach a destination the company has approved. Anywhere else, the transfer is refused before a byte leaves the device.",
    when: {
      effect: ["network.egress", "http.request"],
      destinationNotIn: APPROVED_SYSTEMS,
    },
    decision: "ALLOW",
    escalations: [{ when: [{ key: "data.pii", op: "is", value: true }], decision: "BLOCK", why: "customer PII to a destination that is not on the approved list" }],
    scope: "all",
  },
  {
    id: "approved-ai-only",
    title: "Agents reach approved AI services only",
    why: "Model traffic and browser uploads may only go to the AI services the company has approved. Any other AI endpoint is refused, incognito included.",
    when: {
      effect: ["network.egress", "model.request"],
      destinationNotIn: APPROVED_AI,
    },
    decision: "BLOCK",
    scope: "all",
  },
  {
    id: "agent-enrollment",
    title: "Only enrolled agents may call a model provider",
    why: "An agent that is not enrolled with Wrapbox cannot prove who runs it or under whose authority. Unproven enrollment fails closed.",
    when: {
      effect: ["model.request"],
      requires: [{ key: "agent.enrolled", op: "is", value: true }],
    },
    failClosed: true,
    decision: "ALLOW",
    scope: "all",
  },
  {
    id: "destructive-shell",
    title: "Destructive commands are never run",
    why: "Recursive deletes, disk writes and world-writable permissions are irreversible. The command is refused rather than confirmed.",
    when: {
      effect: ["shell.exec", "filesystem.write"],
      command: ["*rm -rf*", "*rm -fr*", "*mkfs*", "*dd if=/dev/*", "*chmod -R 777*"],
    },
    forbid: ["rm -rf", "rm -fr", "mkfs", "dd if=/dev/", "chmod -R 777"],
    decision: "BLOCK",
    scope: "coding",
  },
  {
    id: "force-push",
    title: "Force-pushes become --force-with-lease",
    why: "A force-push is rewritten so it cannot silently overwrite a teammate's commits. The push still happens — in the safe form.",
    when: { effect: ["git.push"], command: ["* --force", "* --force *", "* -f", "* -f *"] },
    decision: "CONSTRAIN",
    constrain: "force-with-lease",
    scope: "coding",
  },
  {
    id: "protected-branch",
    title: "Protected branches need two SRE approvals",
    why: "main and master are protected. An agent may open the push, but two on-call SREs decide whether it lands.",
    when: { effect: ["git.push", "git.merge"], branch: ["main", "master"] },
    decision: "REVIEW",
    approvers: "sre-oncall",
    quorum: 2,
    ttl: "60s",
    scope: "coding",
  },
  {
    id: "repo-settings",
    title: "Agents never change repository protection",
    why: "Weakening branch protection or repository settings would disable the control that protects every later change. It is refused outright.",
    when: {
      effect: ["http.request"],
      command: ["*/branches/*/protection*", "*/repos/*/settings*", "*branch_protection*", "*branch-protection*"],
    },
    decision: "BLOCK",
    scope: "coding",
  },
  {
    id: "prod-deploy",
    title: "Production deploys run under an approval permit",
    why: "A production deploy runs only when it carries an approval, and the permit is re-checked at the moment of execution: still inside its TTL, never used before, and still bound to the same approval, actor and workflow.",
    when: {
      effect: ["http.request"],
      env: ["production"],
      command: ["gh workflow run deploy-production*", "* deploy-production.yml*"],
      requires: [{ key: "approval.id", op: "not", value: "" }],
    },
    failClosed: true,
    decision: "ALLOW",
    permit: { ttlSeconds: 300, singleUse: true, bind: ["approval.id", "actor", "workflow"] },
    scope: "all",
  },
  {
    id: "pii-read-mask",
    title: "Customer PII is masked on read",
    why: "An agent gets the answer, not the raw contact data. Reads that touch email, phone, PAN or Aadhaar are rewritten to mask those columns and capped with a LIMIT.",
    when: { effect: ["database.read"], columns: ["email", "phone", "pan", "aadhaar"] },
    decision: "CONSTRAIN",
    constrain: "mask",
    scope: "all",
  },
  {
    id: "prod-db-write",
    title: "Production writes are held for two SRE approvals",
    why: "Any change to production rows or schema is held for two on-call SREs, is never allowed to be a DROP or TRUNCATE, and runs once under a single-use permit bound to the exact statement and actor.",
    when: { effect: ["database.write", "database.migrate"], env: ["production"] },
    forbid: ["drop table", "drop database", "drop schema", "truncate", "delete from customers"],
    decision: "REVIEW",
    approvers: "sre-oncall",
    quorum: 2,
    ttl: "60s",
    permit: { ttlSeconds: 60, singleUse: true, bind: ["sql", "actor"] },
    scope: "all",
  },
  {
    id: "refund-tiers",
    title: "Refund authority is tiered",
    why: "Small refunds are automatic, mid-size refunds need the payments manager, and anything above the ceiling is refused — on every refund route, MCP or SDK or REST.",
    when: { effect: ["payments.refund"] },
    unit: "USD",
    tiers: [
      { max: 500, decision: "ALLOW" },
      { max: 10000, decision: "REVIEW", approvers: "payments-manager", quorum: 1 },
      { max: null, decision: "BLOCK" },
    ],
    scope: "business",
  },
  {
    id: "mcp-integrity",
    title: "MCP tools must match the schema that was approved",
    why: "A tool whose schema changed after approval is a different tool. Until a human re-approves the new definition, calls to it are held.",
    when: { effect: ["runtime.integrity"] },
    decision: "ALLOW",
    escalations: [{ when: [{ key: "sha.match", op: "is", value: false }], decision: "REVIEW", approvers: "platform-security", quorum: 1, why: "the MCP tool schema changed since it was approved" }],
    scope: "all",
  },
  {
    id: "allow-ordinary",
    title: "Ordinary work stays automatic",
    why: "Everything the contract does not name is ordinary agent work and runs without a human in the loop. The controls are exceptions, not a queue.",
    when: {
      effect: ["filesystem.read", "filesystem.write", "shell.exec", "git.push", "git.merge", "database.read", "network.egress", "model.request", "http.request", "payments.refund", "runtime.integrity", "secret.use"],
    },
    decision: "ALLOW",
    scope: "all",
  },
  {
    id: "cloud-exposure",
    title: "Cloud resources are never exposed, and admin is never standing",
    why: "Making production storage publicly readable is refused. Creating an administrator role is held for cloud security, because standing admin outlives the task that asked for it.",
    when: { effect: ["http.request"] },
    decision: "ALLOW",
    escalations: [
      { when: [{ key: "storage.public", op: "is", value: true }], decision: "BLOCK", why: "the change would make production storage publicly readable" },
      { when: [{ key: "iam.admin", op: "is", value: true }], decision: "REVIEW", approvers: "cloud-security", quorum: 2, why: "an administrator role grants standing privilege" },
    ],
    scope: "all",
  },
  {
    id: "saas-export",
    title: "Customer data never leaves the company through a SaaS agent",
    why: "Customer PII sent to an external recipient is refused. A bulk export of customer records is held for data governance, whoever asked for it.",
    when: { effect: ["http.request"] },
    decision: "ALLOW",
    escalations: [
      {
        when: [
          { key: "data.pii", op: "is", value: true },
          { key: "destination.external", op: "is", value: true },
        ],
        decision: "BLOCK",
        why: "customer PII addressed to a recipient outside the company",
      },
      { when: [{ key: "rows", op: "gte", value: 10000 }], decision: "REVIEW", approvers: "data-governance", quorum: 1, why: "a bulk export of customer records" },
    ],
    scope: "business",
  },
];

/* ============================================================================
 * Policy toggles — each one really removes its rules from the set handed to
 * evaluate(), so switching one off changes real outcomes.
 * ========================================================================== */

export const POLICY_TOGGLES: PolicyToggle[] = [
  { id: "pii-secrets", label: "Secrets and customer PII are protected", ruleIds: ["secrets-never", "pii-egress", "pii-read-mask", "saas-export"], defaultOn: true },
  { id: "approved-ai", label: "Agents reach approved AI services only", ruleIds: ["approved-ai-only", "agent-enrollment"], defaultOn: true },
  { id: "prod-approval", label: "Production and destructive actions need approval", ruleIds: ["destructive-shell", "protected-branch", "repo-settings", "prod-deploy", "prod-db-write", "cloud-exposure"], defaultOn: true },
  { id: "safe-rewrites", label: "Unsafe commands are rewritten, not refused", ruleIds: ["force-push"], defaultOn: true },
  { id: "spend-limits", label: "Spending authority is tiered", ruleIds: ["refund-tiers"], defaultOn: true },
  { id: "tool-integrity", label: "Tool schemas must match what was approved", ruleIds: ["mcp-integrity"], defaultOn: true },
];

/* ============================================================================
 * Agent pools for "Try another agent". No rule matches on agent identity, so
 * switching cannot change a verdict — that is the point of the control.
 * ========================================================================== */

export const AGENT_POOLS: Record<AgentPool, string[]> = {
  runtime: ["Cursor", "VS Code + Copilot", "Claude Code (CLI)", "Codex CLI", "Gemini CLI", "Claude Desktop", "ChatGPT Desktop", "Unknown Python agent"],
  browser: ["Chrome", "Safari", "Edge", "Firefox", "Chrome (Incognito)"],
  cloud: ["ChatGPT web agent", "Claude web agent", "Cursor web agent", "GitHub cloud agent", "Custom company agent", "CI/CD agent", "SaaS automation", "Background job", "MCP client"],
};

/* ---------- result-sentence helper ---------- */
const outcome = (o: { allow: string; block: string; review?: string; constrain?: string }): Record<Decision, string> => ({
  ALLOW: o.allow,
  CONSTRAIN: o.constrain ?? "It runs in a safer form — the unsafe part is rewritten before it reaches the system.",
  REVIEW: o.review ?? "It is held. Nothing happens until a named approver signs off, and the request expires if nobody does.",
  BLOCK: o.block,
});

/* ============================================================================
 * SURFACES — the mini-apps in the playground, and the real Acts behind each
 * button. Every ctx key is a fact the surface can actually prove about the
 * attempt; a key that is absent is unproven, and rules that need it fail closed.
 * ========================================================================== */

export const SURFACES: Surface[] = [
  /* ---------- Runtime · browser ---------- */
  {
    id: "chrome",
    group: "runtime-browser",
    plane: "runtime",
    title: "Chrome",
    subtitle: "Managed browser on a company laptop",
    icon: "Globe",
    logo: "google",
    chrome: "browser",
    actions: [
      {
        id: "pg-browser-upload-pii",
        label: "Upload customers.csv to an AI site",
        intent: "A developer drags a customer export into a chat box on an AI site nobody approved.",
        detail: "customers.csv · 12,480 rows · email, phone, plan",
        act: { effect: "network.egress", destination: "chat.unapproved-ai.example", env: "production", command: "POST https://chat.unapproved-ai.example/upload (customers.csv)", ctx: { "data.pii": true, "file.rows": 12480, "browser.managed": true } },
        agentPool: "browser",
        defaultAgent: "Chrome",
        why: "Customer PII may only reach a destination the company has approved. This site is not on that list, so the upload is refused before any data leaves the laptop.",
        result: outcome({
          allow: "The file uploads and 12,480 customer records sit in a third-party chat history.",
          block: "The upload never starts. The bytes stay on the laptop and the attempt is on the record with the file and row count.",
        }),
      },
      {
        id: "pg-browser-claude",
        label: "Open the approved Claude site",
        intent: "The same developer opens the AI assistant the company actually approved.",
        detail: "claude.ai · approved AI destination",
        act: { effect: "network.egress", destination: "claude.ai", env: "production", command: "GET https://claude.ai/new", ctx: { "browser.managed": true } },
        agentPool: "browser",
        defaultAgent: "Chrome",
        why: "claude.ai is on the approved AI list, and nothing in the request carries customer data. Ordinary approved work is not something Wrapbox gets in the way of.",
        result: outcome({
          allow: "The page opens normally. No prompt, no delay — the control is invisible when the work is ordinary.",
          block: "The page would not load.",
        }),
      },
      {
        id: "pg-browser-incognito",
        label: "Open a blocked AI site in Incognito",
        intent: "Someone tries to get around the rule by opening an unapproved AI site in a private window.",
        detail: "chat.deepseek.example · private window",
        act: { effect: "network.egress", destination: "chat.deepseek.example", env: "production", command: "GET https://chat.deepseek.example/", ctx: { "browser.incognito": true, "browser.managed": true } },
        agentPool: "browser",
        defaultAgent: "Chrome (Incognito)",
        why: "The rule matches the destination, not the window. An unapproved AI endpoint is refused whether or not the session is private.",
        result: outcome({
          allow: "The site would load and become an unmonitored path for anything pasted into it.",
          block: "The connection is refused. Incognito changes what the browser remembers, not what the policy allows.",
        }),
      },
      {
        id: "pg-browser-sanitized",
        label: "Upload a sanitized document",
        intent: "The developer uploads a de-identified spec to the approved assistant instead.",
        detail: "architecture-review.md · no customer data",
        act: { effect: "network.egress", destination: "claude.ai", env: "production", command: "POST https://claude.ai/upload (architecture-review.md)", ctx: { "data.pii": false, "browser.managed": true } },
        agentPool: "browser",
        defaultAgent: "Chrome",
        why: "An approved destination and no customer PII in the payload. Both halves of the contract are satisfied, so the upload is ordinary work.",
        result: outcome({
          allow: "The document uploads immediately. This is the path the policy is steering people towards.",
          block: "The upload would be refused.",
        }),
      },
    ],
  },

  /* ---------- Runtime · IDE ---------- */
  {
    id: "cursor",
    group: "runtime-ide",
    plane: "runtime",
    title: "Cursor",
    subtitle: "IDE agent on the managed device",
    icon: "Code2",
    logo: "cursor",
    chrome: "ide",
    actions: [
      {
        id: "pg-cursor-env",
        label: "Read ~/.env",
        intent: "The agent opens the developer's environment file while looking for a database URL.",
        detail: "~/.env · 14 keys including STRIPE_SECRET_KEY",
        act: { effect: "filesystem.read", path: "~/.env", env: "development", command: "read ~/.env" },
        agentPool: "runtime",
        defaultAgent: "Cursor",
        why: "Secret material — .env files, private keys, cloud credentials — is never read by an agent, on any surface and by any route.",
        result: outcome({
          allow: "The agent reads fourteen live secrets into a model context you do not control.",
          block: "The file is never opened. The agent is told the read was refused and which rule refused it, so it can ask for a vault reference instead.",
        }),
      },
      {
        id: "pg-cursor-edit",
        label: "Edit src/checkout.ts",
        intent: "The agent applies a patch to the checkout retry logic.",
        detail: "src/checkout.ts · +18 −4",
        act: { effect: "filesystem.write", path: "/wrapbox/web/src/checkout.ts", env: "development", command: "apply patch to src/checkout.ts" },
        agentPool: "runtime",
        defaultAgent: "Cursor",
        why: "Ordinary source code in a development checkout is not named by the contract, so it runs without a human in the loop.",
        result: outcome({
          allow: "The patch is written straight to disk. No prompt, no queue.",
          block: "The edit would be refused.",
        }),
      },
      {
        id: "pg-cursor-force",
        label: "git push --force origin release/2.9",
        intent: "The agent force-pushes a rebased branch to the shared release branch.",
        detail: "release/2.9 · 3 commits rewritten",
        act: { effect: "git.push", branch: "release/2.9", command: "git push --force origin release/2.9", env: "production" },
        agentPool: "runtime",
        defaultAgent: "Cursor",
        why: "A plain force-push can silently discard a teammate's commits. Wrapbox rewrites it to --force-with-lease, which refuses if the remote moved since the agent last looked.",
        result: outcome({
          allow: "The raw force-push runs and any commit pushed by a teammate in the meantime is gone.",
          constrain: "The push runs as --force-with-lease. It succeeds if nobody else pushed, and fails safely if they did.",
          block: "The push would be refused.",
        }),
      },
      {
        id: "pg-cursor-rmrf",
        label: "rm -rf ~/work/payments",
        intent: "The agent tries to clear a working directory it decided was stale.",
        detail: "~/work/payments · 1,204 files, uncommitted work",
        act: { effect: "filesystem.write", path: "~/work/payments", command: "rm -rf ~/work/payments", env: "development" },
        agentPool: "runtime",
        defaultAgent: "Cursor",
        why: "Recursive deletes are irreversible, so the contract forbids the content outright rather than asking a tired developer to confirm it.",
        result: outcome({
          allow: "1,204 files including uncommitted work are gone, with no undo.",
          block: "The command never reaches the shell. The receipt records the exact string that was refused.",
        }),
      },
    ],
  },
  {
    id: "vscode",
    group: "runtime-ide",
    plane: "runtime",
    title: "VS Code + Copilot",
    subtitle: "Copilot agent mode on the same device",
    icon: "Code",
    logo: "githubcopilot",
    chrome: "ide",
    actions: [
      {
        id: "pg-vscode-aws",
        label: "Read ~/.aws/credentials",
        intent: "The agent looks for an AWS profile so it can list an S3 bucket itself.",
        detail: "~/.aws/credentials · 3 profiles",
        act: { effect: "filesystem.read", path: "~/.aws/credentials", env: "development", command: "read ~/.aws/credentials" },
        agentPool: "runtime",
        defaultAgent: "VS Code + Copilot",
        why: "Cloud credentials are secret material. The same rule that stopped Cursor reading .env stops Copilot reading the AWS profile — one contract, every agent.",
        result: outcome({
          allow: "Long-lived AWS keys for three accounts end up in a model context.",
          block: "The file is never opened, and the agent is pointed at a scoped, short-lived credential instead.",
        }),
      },
      {
        id: "pg-vscode-refactor",
        label: "Refactor src/lib/pricing.ts",
        intent: "The agent extracts a helper and updates the call sites.",
        detail: "src/lib/pricing.ts · +42 −31",
        act: { effect: "filesystem.write", path: "/wrapbox/web/src/lib/pricing.ts", env: "development", command: "apply refactor to src/lib/pricing.ts" },
        agentPool: "runtime",
        defaultAgent: "VS Code + Copilot",
        why: "Nothing in the contract names ordinary source files, so the refactor is ordinary agent work.",
        result: outcome({
          allow: "The refactor is written to disk immediately.",
          block: "The edit would be refused.",
        }),
      },
      {
        id: "pg-vscode-main",
        label: "git push origin main",
        intent: "The agent pushes its branch straight to main to 'unblock the build'.",
        detail: "main · protected branch",
        act: { effect: "git.push", branch: "main", command: "git push origin main", env: "production" },
        agentPool: "runtime",
        defaultAgent: "VS Code + Copilot",
        why: "main is protected. An agent may open the push, but two on-call SREs decide whether it lands, and the request expires if nobody answers.",
        result: outcome({
          allow: "Unreviewed code lands on the branch production builds from.",
          review: "The push is held. Two on-call SREs are paged, the request expires in 60 seconds if nobody answers, and the agent is told to wait rather than retry.",
          block: "The push would be refused outright.",
        }),
      },
    ],
  },
  {
    id: "claude-cli",
    group: "runtime-ide",
    plane: "runtime",
    title: "Claude Code (CLI)",
    subtitle: "Terminal agent with shell and git",
    icon: "Terminal",
    logo: "claudecode",
    chrome: "console",
    actions: [
      {
        id: "pg-cli-dotenv",
        label: "cat .env.production",
        intent: "The agent reads the production environment file in the repo to check a feature flag.",
        detail: ".env.production · committed by mistake in 2023",
        act: { effect: "filesystem.read", path: "/wrapbox/web/.env.production", env: "development", command: "cat .env.production" },
        agentPool: "runtime",
        defaultAgent: "Claude Code (CLI)",
        why: "The secrets rule matches the file, not the surface. A .env file inside the repo is still secret material, so the CLI is refused exactly like the IDE was.",
        result: outcome({
          allow: "Production secrets are read into the terminal session and the transcript.",
          block: "The read is refused, and the receipt shows the same rule id that fired in Cursor and VS Code.",
        }),
      },
      {
        id: "pg-cli-tests",
        label: "npm test -- --runInBand",
        intent: "The agent runs the test suite before proposing a change.",
        detail: "412 tests · ~90s",
        act: { effect: "shell.exec", command: "npm test -- --runInBand", env: "development" },
        agentPool: "runtime",
        defaultAgent: "Claude Code (CLI)",
        why: "Running tests is not destructive and touches nothing the contract names, so it runs without asking anyone.",
        result: outcome({
          allow: "The suite runs normally. Most of what a coding agent does looks like this.",
          block: "The command would be refused.",
        }),
      },
      {
        id: "pg-cli-hotfix-main",
        label: "git push origin main (hotfix)",
        intent: "The agent tries to ship a hotfix directly to main at 02:40.",
        detail: "main · protected branch · out of hours",
        act: { effect: "git.push", branch: "main", command: "git push origin main", env: "production" },
        agentPool: "runtime",
        defaultAgent: "Claude Code (CLI)",
        why: "Protection is a property of the branch, not of the tool. The CLI gets the same two-approver hold that Copilot got.",
        result: outcome({
          allow: "An unreviewed hotfix lands on main in the middle of the night.",
          review: "The push is held for two on-call SREs. Urgency is an argument to make to them, not a way around them.",
          block: "The push would be refused outright.",
        }),
      },
    ],
  },

  /* ---------- Runtime · agents ---------- */
  {
    id: "unknown-agent",
    group: "runtime-agent",
    plane: "runtime",
    title: "Unknown Python agent",
    subtitle: "A script nobody registered",
    icon: "Bot",
    chrome: "console",
    actions: [
      {
        id: "pg-agent-model",
        label: "Unenrolled agent calls a model API",
        intent: "A Python script found on a laptop opens a direct connection to a model provider.",
        detail: "agent.py · no Wrapbox enrollment",
        act: { effect: "model.request", destination: "api.openai.com", env: "development", command: "python agent.py → POST https://api.openai.com/v1/responses", ctx: { "agent.enrolled": false, "agent.owner": "" } },
        agentPool: "runtime",
        defaultAgent: "Unknown Python agent",
        why: "The destination is approved, but the caller is not enrolled — it cannot prove who runs it or under whose authority. Unproven enrollment fails closed.",
        result: outcome({
          allow: "An unowned script gets a direct line to a model provider with whatever it can read on the device.",
          block: "The call is refused and the script shows up in the inventory as an unenrolled agent to be claimed or removed.",
        }),
      },
      {
        id: "pg-agent-read",
        label: "Enrolled agent reads project files",
        intent: "The same script, once enrolled and owned by a team, reads ordinary source files.",
        detail: "src/api/orders.ts · enrolled as billing-batch-agent",
        act: { effect: "filesystem.read", path: "/wrapbox/web/src/api/orders.ts", env: "development", command: "read src/api/orders.ts", ctx: { "agent.enrolled": true, "agent.owner": "billing-squad" } },
        agentPool: "runtime",
        defaultAgent: "Unknown Python agent",
        why: "Enrollment is about identity, not restriction. Once the agent has an owner, ordinary file reads are ordinary work.",
        result: outcome({
          allow: "The read runs immediately, attributed to the team that owns the agent.",
          block: "The read would be refused.",
        }),
      },
      {
        id: "pg-agent-idrsa",
        label: "Copy ~/.ssh/id_rsa out of the project",
        intent: "The script copies a private SSH key into a folder it is about to zip up.",
        detail: "~/.ssh/id_rsa → ./vendor/keys/",
        act: { effect: "filesystem.read", path: "~/.ssh/id_rsa", env: "development", command: "cp ~/.ssh/id_rsa /wrapbox/web/vendor/keys/" },
        agentPool: "runtime",
        defaultAgent: "Unknown Python agent",
        why: "Copying a file is a read first. The secrets rule matches the source path, so the copy is refused at the read — being enrolled does not buy access to private keys.",
        result: outcome({
          allow: "A private SSH key is staged in a directory that is about to be zipped and uploaded.",
          block: "The read is refused, so there is nothing to copy. The attempt is recorded with the source path.",
        }),
      },
    ],
  },
  {
    id: "claude-desktop",
    group: "runtime-agent",
    plane: "runtime",
    title: "Claude Desktop",
    subtitle: "Desktop assistant with file access",
    icon: "MessageSquare",
    logo: "claude",
    chrome: "chat",
    actions: [
      {
        id: "pg-desktop-csv",
        label: "Summarize ~/Downloads/customers.csv",
        intent: "Someone asks the desktop assistant to summarise a spreadsheet already on their laptop.",
        detail: "~/Downloads/customers.csv · local read",
        act: { effect: "filesystem.read", path: "~/Downloads/customers.csv", env: "development", command: "read ~/Downloads/customers.csv" },
        agentPool: "runtime",
        defaultAgent: "Claude Desktop",
        why: "Reading a file that is already on the device is not what the contract controls — what it controls is that file leaving to somewhere unapproved.",
        result: outcome({
          allow: "The assistant reads the file and answers. The control that matters fires later, if it tries to send it somewhere.",
          block: "The read would be refused.",
        }),
      },
      {
        id: "pg-desktop-gcloud",
        label: "Read ~/.config/gcloud/credentials.json",
        intent: "The assistant looks for a Google Cloud credential so it can query a dataset itself.",
        detail: "~/.config/gcloud/credentials.json",
        act: { effect: "filesystem.read", path: "~/.config/gcloud/credentials.json", env: "development", command: "read ~/.config/gcloud/credentials.json" },
        agentPool: "runtime",
        defaultAgent: "Claude Desktop",
        why: "Cloud credentials are secret material wherever the vendor happens to put them. The path pattern covers gcloud the same way it covers AWS.",
        result: outcome({
          allow: "A refresh token with access to the company's cloud projects is read into a chat.",
          block: "The file is never opened.",
        }),
      },
      {
        id: "pg-desktop-summarizer",
        label: "Send notes to an AI summarizer",
        intent: "The assistant offers to post the meeting notes to a third-party summarising service.",
        detail: "notes.superai.example · unapproved AI endpoint",
        act: { effect: "network.egress", destination: "notes.superai.example", env: "production", command: "POST https://notes.superai.example/summarize", ctx: { "data.pii": false } },
        agentPool: "runtime",
        defaultAgent: "Claude Desktop",
        why: "Only approved AI services may receive company content. This endpoint is not one of them, so the request is refused even though the notes contain no customer PII.",
        result: outcome({
          allow: "Internal meeting notes are sent to a service with no contract and no data-processing agreement.",
          block: "The request is refused, and the approved assistant is offered instead.",
        }),
      },
    ],
  },

  /* ---------- Gateway · MCP ---------- */
  {
    id: "stripe",
    group: "gateway-mcp",
    plane: "gateway",
    title: "Stripe MCP",
    subtitle: "Payments tools behind the MCP gateway",
    icon: "CreditCard",
    logo: "stripe",
    chrome: "payments",
    actions: [
      {
        id: "pg-stripe-120",
        label: "Refund $120",
        intent: "A support agent refunds a duplicate charge on a customer's order.",
        detail: "ch_3PqR… · duplicate charge",
        act: { effect: "payments.refund", amountUsd: 120, env: "production", command: "stripe.refunds.create(charge=ch_3PqR, amount=12000)", ctx: { "order.id": "ORD-88213" } },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "Refunds under the automatic ceiling run without a human. The tier is evaluated on the amount, not on which tool or SDK asked.",
        result: outcome({
          allow: "The refund is issued immediately and the receipt records the amount and the tier that allowed it.",
          block: "The refund would be refused.",
        }),
      },
      {
        id: "pg-stripe-3500",
        label: "Refund $3,500",
        intent: "The same agent refunds a disputed annual subscription.",
        detail: "ch_3Pk2… · disputed annual plan",
        act: { effect: "payments.refund", amountUsd: 3500, env: "production", command: "stripe.refunds.create(charge=ch_3Pk2, amount=350000)", ctx: { "order.id": "ORD-71904" } },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "Above the automatic ceiling and below the hard limit, the refund needs the payments manager. Same rule, a different band of the same tier table.",
        result: outcome({
          allow: "A $3,500 refund is issued with nobody but the agent involved.",
          review: "The refund is held for the payments manager, who sees the charge, the amount and the reason before deciding.",
          block: "The refund would be refused.",
        }),
      },
      {
        id: "pg-stripe-50000",
        label: "Refund $50,000",
        intent: "A prompt-injected instruction asks for a refund far outside anything an agent should issue.",
        detail: "ch_3Pz9… · amount far above the ceiling",
        act: { effect: "payments.refund", amountUsd: 50000, env: "production", command: "stripe.refunds.create(charge=ch_3Pz9, amount=5000000)", ctx: { "order.id": "ORD-55120" } },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "Above the ceiling there is no approver who can wave it through from an agent's request — it is refused and raised as an incident instead.",
        result: outcome({
          allow: "$50,000 leaves the company on an agent's say-so.",
          block: "The call never reaches Stripe. The attempt is recorded with the amount, the charge and the agent that asked.",
        }),
      },
      {
        id: "pg-stripe-integrity",
        label: "Tool schema changed since approval",
        intent: "The Stripe MCP server advertises a refund tool whose schema no longer matches the one that was approved.",
        detail: "refunds.create · schema hash mismatch",
        act: { effect: "runtime.integrity", path: "mcp/stripe/tools/refunds.create.json", env: "production", command: "tools/list → refunds.create", ctx: { "sha.match": false, "sha.approved": "b41c…9e2", "sha.observed": "07af…13d" } },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "A tool whose definition changed after approval is a different tool. Calls to it are held until a human re-approves the new schema.",
        result: outcome({
          allow: "An agent calls a tool whose arguments nobody has reviewed.",
          review: "Calls are held and platform security is shown the approved hash next to the observed one.",
          block: "The tool would be removed from the agent's catalogue entirely.",
        }),
      },
    ],
  },

  /* ---------- Gateway · database ---------- */
  {
    id: "postgres",
    group: "gateway-database",
    plane: "gateway",
    title: "PostgreSQL",
    subtitle: "Production database behind the gateway",
    icon: "Database",
    logo: "postgresql",
    chrome: "sql",
    actions: [
      {
        id: "pg-db-analytics",
        label: "SELECT public analytics",
        intent: "The agent reads the daily revenue rollup to answer a question about last month.",
        detail: "analytics.daily_revenue · no customer columns",
        act: {
          effect: "database.read",
          env: "production",
          columns: ["date", "revenue_usd"],
          sql: "SELECT date, revenue_usd FROM analytics.daily_revenue ORDER BY date DESC LIMIT 30",
          ctx: { actor: "billing-batch-agent" },
        },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "The query touches no customer columns, so nothing in the contract applies and the read runs as written.",
        result: outcome({
          allow: "The query runs unchanged and returns 30 rows.",
          block: "The query would be refused.",
        }),
      },
      {
        id: "pg-db-pii",
        label: "SELECT email, phone FROM customers",
        intent: "The agent pulls contact details while investigating a support ticket.",
        detail: "customers · email, phone",
        act: {
          effect: "database.read",
          env: "production",
          columns: ["email", "phone"],
          sql: "SELECT email, phone FROM customers WHERE plan = 'enterprise'",
          ctx: { actor: "support-copilot" },
        },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "An agent gets the answer, not the raw contact data. The query is rewritten so PII columns come back masked, and a LIMIT is added so a read cannot quietly become an export.",
        result: outcome({
          allow: "Raw email addresses and phone numbers for every enterprise customer land in the agent's context.",
          constrain: "The query runs as SELECT wbx_mask(email) AS email, wbx_mask(phone) AS phone … LIMIT 500. The agent can still answer the ticket; it just never sees the raw values.",
          block: "The query would be refused.",
        }),
      },
      {
        id: "pg-db-drop",
        label: "DROP TABLE production.customers",
        intent: "A migration script the agent generated starts by dropping the table it means to rebuild.",
        detail: "production.customers · 1.2M rows",
        act: {
          effect: "database.write",
          env: "production",
          sql: "DROP TABLE production.customers;",
          ctx: { sql: "DROP TABLE production.customers;", actor: "schema-agent", "rows.affected": 1200000 },
        },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "DROP and TRUNCATE on production are forbidden content — there is no approver path for them from an agent, because an approval cannot undo the statement afterwards.",
        result: outcome({
          allow: "1.2 million customer rows are gone and the restore is measured in hours.",
          block: "The statement never reaches the database. The receipt names the forbidden keyword that stopped it.",
        }),
      },
      {
        id: "pg-db-update",
        label: "Production UPDATE",
        intent: "The agent marks a single order as refunded after issuing the refund.",
        detail: "orders · 1 row · WHERE id = 88213",
        act: {
          effect: "database.write",
          env: "production",
          sql: "UPDATE orders SET status = 'refunded' WHERE id = 88213;",
          ctx: { sql: "UPDATE orders SET status = 'refunded' WHERE id = 88213;", actor: "support-copilot", "rows.affected": 1 },
        },
        agentPool: "cloud",
        defaultAgent: "MCP client",
        why: "Any write to production is held for two on-call SREs and, once approved, runs exactly once under a single-use permit bound to this statement and this actor.",
        result: outcome({
          allow: "The row is updated with nobody reviewing the statement.",
          review: "The write is held for two on-call SREs, who see the exact statement. On approval it runs once under a permit bound to that statement — a second attempt with a changed statement is refused.",
          block: "The write would be refused outright.",
        }),
      },
    ],
  },

  /* ---------- Gateway · deploy ---------- */
  {
    id: "github",
    group: "gateway-deploy",
    plane: "gateway",
    title: "GitHub",
    subtitle: "Repositories, branches and deploys",
    icon: "GitBranch",
    logo: "github_light",
    chrome: "repo",
    actions: [
      {
        id: "pg-gh-feature",
        label: "Create a feature branch",
        intent: "A cloud agent pushes its work to a new feature branch and opens a pull request.",
        detail: "feature/checkout-retry · 6 commits",
        act: { effect: "git.push", branch: "feature/checkout-retry", command: "git push origin feature/checkout-retry", env: "production" },
        agentPool: "cloud",
        defaultAgent: "GitHub cloud agent",
        why: "Feature branches are not protected. Review happens on the pull request, which is where humans already look.",
        result: outcome({
          allow: "The branch is pushed and the pull request opens normally.",
          block: "The push would be refused.",
        }),
      },
      {
        id: "pg-gh-main",
        label: "Push to main",
        intent: "The cloud agent tries to merge its own branch straight into main.",
        detail: "main · protected branch",
        act: { effect: "git.push", branch: "main", command: "git push origin main", env: "production" },
        agentPool: "cloud",
        defaultAgent: "GitHub cloud agent",
        why: "The same protected-branch rule that held the IDE and the CLI holds the cloud agent. One contract, enforced at whichever point the action passes through.",
        result: outcome({
          allow: "Unreviewed code lands on main from an unattended runner.",
          review: "The push is held for two on-call SREs, with the same rule id the IDE surfaces showed.",
          block: "The push would be refused outright.",
        }),
      },
      {
        id: "pg-gh-protection",
        label: "Change branch protection",
        intent: "The agent tries to remove the required-review setting so its own push can land.",
        detail: "PUT /repos/wrapbox/billing/branches/main/protection",
        act: {
          effect: "http.request",
          destination: "api.github.com",
          env: "production",
          command: "gh api -X PUT /repos/wrapbox/billing/branches/main/protection",
          ctx: { "github.branch_protection": "required_reviews → 0" },
        },
        agentPool: "cloud",
        defaultAgent: "GitHub cloud agent",
        why: "Changing repository protection would disable the control that governs every later change. An agent is never the right actor for that, so it is refused rather than reviewed.",
        result: outcome({
          allow: "The protection rule is removed and every subsequent push lands unreviewed.",
          block: "The API call is refused at the gateway. The attempt is recorded as an attempt to weaken a control.",
        }),
      },
      {
        id: "pg-gh-deploy",
        label: "Approved production deploy",
        intent: "The release workflow runs against production, carrying the approval that was granted for it.",
        detail: "deploy-production.yml · approval AP-4417",
        act: {
          effect: "http.request",
          destination: "api.github.com",
          env: "production",
          command: "gh workflow run deploy-production.yml --ref main",
          ctx: {
            "approval.id": "AP-4417",
            actor: "rhea.menon@wrapbox.ai",
            workflow: "deploy-production.yml",
            "permit.age_seconds": 12,
            "permit.consumed": false,
            "permit.bindings_changed": false,
          },
        },
        agentPool: "cloud",
        defaultAgent: "CI/CD agent",
        why: "A production deploy runs only when it carries an approval, and the permit is re-checked at execution: inside its 300-second TTL, never used before, and still bound to the same approval, actor and workflow.",
        result: outcome({
          allow: "The deploy runs once, under a single-use permit that is re-verified at the moment of execution. Replaying the same request after it is spent is refused.",
          block: "Without a valid approval the deploy is refused — an unproven approval is treated as no approval.",
        }),
      },
    ],
  },

  /* ---------- Gateway · cloud ---------- */
  {
    id: "aws",
    group: "gateway-cloud",
    plane: "gateway",
    title: "AWS",
    subtitle: "Cloud account behind the API gateway",
    icon: "Cloud",
    logo: "aws",
    chrome: "cloud",
    actions: [
      {
        id: "pg-aws-read",
        label: "Read an approved S3 bucket",
        intent: "The agent pulls yesterday's analytics extract to build a report.",
        detail: "s3://wrapbox-analytics-approved/daily.parquet",
        act: { effect: "http.request", destination: "s3.amazonaws.com", env: "production", command: "aws s3 cp s3://wrapbox-analytics-approved/daily.parquet ./tmp/" },
        agentPool: "cloud",
        defaultAgent: "Custom company agent",
        why: "An approved bucket, a read, no exposure change and no customer PII leaving the account. Nothing in the contract applies.",
        result: outcome({
          allow: "The object downloads normally.",
          block: "The read would be refused.",
        }),
      },
      {
        id: "pg-aws-public",
        label: "Make a production bucket public",
        intent: "The agent removes the public-access block so a teammate can fetch a file over a plain URL.",
        detail: "wrapbox-prod-invoices · 340,000 objects",
        act: {
          effect: "http.request",
          destination: "s3.amazonaws.com",
          env: "production",
          command: "aws s3api delete-public-access-block --bucket wrapbox-prod-invoices",
          ctx: { "storage.public": true, "objects.count": 340000 },
        },
        agentPool: "cloud",
        defaultAgent: "Custom company agent",
        why: "Making production storage publicly readable is a breach the moment it succeeds, and no approval afterwards un-publishes what was indexed. It is refused.",
        result: outcome({
          allow: "340,000 invoices become readable by anyone who guesses the URL.",
          block: "The call is refused at the gateway and the attempt is raised as an exposure event.",
        }),
      },
      {
        id: "pg-aws-iam",
        label: "Create an admin IAM role",
        intent: "The agent creates a role with AdministratorAccess so it can stop asking for permissions.",
        detail: "agent-admin · AdministratorAccess",
        act: {
          effect: "http.request",
          destination: "iam.amazonaws.com",
          env: "production",
          command: "aws iam create-role --role-name agent-admin --policy AdministratorAccess",
          ctx: { "iam.admin": true },
        },
        agentPool: "cloud",
        defaultAgent: "Custom company agent",
        why: "Standing administrator privilege outlives the task that asked for it. Two people from cloud security decide whether that is really what is needed.",
        result: outcome({
          allow: "A permanent admin role exists that nobody reviewed and nobody owns.",
          review: "The role creation is held for two cloud-security approvers, who see the policy that would be attached.",
          block: "The role creation would be refused outright.",
        }),
      },
      {
        id: "pg-aws-staging",
        label: "Deploy to staging",
        intent: "The agent deploys the current branch to the staging stack.",
        detail: "checkout-staging · staging account",
        act: { effect: "http.request", destination: "cloudformation.amazonaws.com", env: "staging", command: "aws cloudformation deploy --stack-name checkout-staging" },
        agentPool: "cloud",
        defaultAgent: "CI/CD agent",
        why: "Staging is where agents are meant to move fast. The contract asks for approval on production, not on every environment.",
        result: outcome({
          allow: "The staging deploy runs immediately.",
          block: "The deploy would be refused.",
        }),
      },
    ],
  },

  /* ---------- Gateway · SaaS ---------- */
  {
    id: "slack",
    group: "gateway-saas",
    plane: "gateway",
    title: "Slack",
    subtitle: "Workspace automation",
    icon: "Hash",
    logo: "slack",
    chrome: "chat",
    actions: [
      {
        id: "pg-slack-internal",
        label: "Post in an internal channel",
        intent: "The agent posts a build summary into the team's own channel.",
        detail: "#eng-billing · internal",
        act: { effect: "http.request", destination: "hooks.slack.com", env: "production", command: "chat.postMessage → #eng-billing" },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "An internal message with no customer data in it is ordinary automation.",
        result: outcome({
          allow: "The message posts immediately.",
          block: "The message would not be sent.",
        }),
      },
      {
        id: "pg-slack-export",
        label: "Send a customer export to an external channel",
        intent: "The agent uploads a customer export into a Slack Connect channel shared with a vendor.",
        detail: "customers-export.csv · 4,200 rows · #vendor-shared",
        act: {
          effect: "http.request",
          destination: "files.slack.com",
          env: "production",
          command: "files.upload customers-export.csv → #vendor-shared (Slack Connect)",
          ctx: { "data.pii": true, "destination.external": true, rows: 4200, "channel.name": "#vendor-shared" },
        },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "Customer PII addressed to a recipient outside the company is refused. A shared channel is an external recipient even though the tool is an internal one.",
        result: outcome({
          allow: "4,200 customer records are in a vendor's Slack workspace, outside the company's retention and deletion controls.",
          block: "The upload is refused at the gateway, naming the channel and the fact that it reaches another organisation.",
        }),
      },
      {
        id: "pg-slack-external-ok",
        label: "Send an incident timeline to the vendor channel",
        intent: "The agent shares a scrubbed incident timeline in the same external channel.",
        detail: "incident-4417-timeline.md · no customer data · #vendor-shared",
        act: {
          effect: "http.request",
          destination: "files.slack.com",
          env: "production",
          command: "files.upload incident-4417-timeline.md → #vendor-shared (Slack Connect)",
          ctx: { "data.pii": false, "destination.external": true, "channel.name": "#vendor-shared" },
        },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "The rule is about customer data leaving, not about talking to vendors. The same external channel is fine for content that carries no PII.",
        result: outcome({
          allow: "The timeline posts to the vendor channel. Working with vendors is not the thing being controlled.",
          block: "The upload would be refused.",
        }),
      },
    ],
  },
  {
    id: "salesforce",
    group: "gateway-saas",
    plane: "gateway",
    title: "Salesforce",
    subtitle: "CRM agent actions",
    icon: "Building2",
    logo: "salesforce",
    chrome: "app",
    actions: [
      {
        id: "pg-sf-read",
        label: "Read normal account data",
        intent: "The agent looks up fifty accounts by industry to prepare a pipeline summary.",
        detail: "Account · Name, Industry · 50 rows",
        act: { effect: "http.request", destination: "acme.my.salesforce.com", env: "production", command: 'sf data query --query "SELECT Name, Industry FROM Account LIMIT 50"' },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "A small read of non-personal fields inside an approved system is ordinary CRM work.",
        result: outcome({
          allow: "The query returns fifty rows immediately.",
          block: "The query would be refused.",
        }),
      },
      {
        id: "pg-sf-bulk",
        label: "Bulk-export customer records",
        intent: "The agent starts a bulk export of every contact record in the org.",
        detail: "Contact · 250,000 rows · full export",
        act: {
          effect: "http.request",
          destination: "acme.my.salesforce.com",
          env: "production",
          command: "sf data export bulk --sobject Contact --all",
          ctx: { "data.pii": true, rows: 250000 },
        },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "A bulk export of customer records is held for data governance regardless of who asked. The destination is approved, which is why this is a review rather than a refusal.",
        result: outcome({
          allow: "A quarter of a million contact records are extracted with nobody reviewing the purpose.",
          review: "The export is held for data governance, who see the object, the row count and the requesting agent.",
          block: "The export would be refused outright.",
        }),
      },
      {
        id: "pg-sf-warehouse",
        label: "Export 200 accounts to the warehouse",
        intent: "The agent syncs a small slice of account data into the company's own warehouse.",
        detail: "Account · 200 rows · warehouse.wrapbox.internal",
        act: {
          effect: "http.request",
          destination: "warehouse.wrapbox.internal",
          env: "production",
          command: "sf data export bulk --sobject Account --limit 200",
          ctx: { "data.pii": true, rows: 200 },
        },
        agentPool: "cloud",
        defaultAgent: "SaaS automation",
        why: "Customer data moving inside the company, at a volume well under the bulk threshold, is exactly the flow the contract is meant to leave alone.",
        result: outcome({
          allow: "The sync runs immediately. The same data at 250,000 rows would be held, and to an external recipient it would be refused.",
          block: "The sync would be refused.",
        }),
      },
    ],
  },
];

/* ============================================================================
 * Lookups and deterministic ids
 * ========================================================================== */

const SURFACE_BY_ACTION = new Map<string, Surface>();
for (const s of SURFACES) for (const a of s.actions) SURFACE_BY_ACTION.set(a.id, s);

export const surfaceOf = (actionId: string): Surface | undefined => SURFACE_BY_ACTION.get(actionId);

export const ALL_ACTIONS: ScenarioAction[] = SURFACES.flatMap((s) => s.actions);
const ACTION_BY_ID = new Map<string, ScenarioAction>(ALL_ACTIONS.map((a) => [a.id, a]));
export const actionById = (id: string): ScenarioAction | undefined => ACTION_BY_ID.get(id);

/** The enforcement point that handled the action follows the surface it came from. */
const CATEGORY_BY_GROUP: Record<SurfaceGroup, CategoryId> = {
  "runtime-browser": "browser",
  "runtime-ide": "ide",
  "runtime-agent": "custom",
  "gateway-mcp": "mcp",
  "gateway-database": "mcp",
  "gateway-deploy": "cloud",
  "gateway-cloud": "cloud",
  "gateway-saas": "saas",
};

/** FNV-1a. Deterministic — no Math.random anywhere near a verdict or an id. */
function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A receipt identifies a DECISION EVENT, not an action. The same action decided
 * under a different policy state — or asked by a different agent — is a separate
 * signed record, so the id is derived from all three. Deriving it from the action
 * alone would let one id denote a BLOCK on one run and an ALLOW on the next,
 * which is exactly what a signed evidence ledger must never do. Still fully
 * deterministic: no clock, no randomness.
 */
const receiptFor = (actionId: string, toggleIds: string[], agent: string) =>
  `WB-${10000 + (hash32(`${actionId}|${[...toggleIds].sort().join(",")}|${agent}`) % 90000)}`;
const permitFor = (actionId: string) => "wbp_" + hash32(`${actionId}|permit`).toString(36).padStart(7, "0");

const DEFAULT_TOGGLES = POLICY_TOGGLES.filter((t) => t.defaultOn).map((t) => t.id);

/** The rules that are live for a given toggle state. */
export function activeRules(enabledToggleIds: string[] = DEFAULT_TOGGLES): Rule[] {
  const off = new Set(POLICY_TOGGLES.filter((t) => !enabledToggleIds.includes(t.id)).flatMap((t) => t.ruleIds));
  return PLAYGROUND_RULES.filter((r) => !off.has(r.id));
}

export interface RunResult {
  verdict: Verdict;
  plane: Plane;
  rewritten?: string;
  permitId?: string;
  receiptId: string;
  result: string;
  /** Echoed back so the receipt can name the agent that asked. Never an input to the decision. */
  agent: string;
}

/**
 * Run one action against the REAL engine with the enabled toggles applied.
 *
 * `agent` labels the receipt and nothing else: no rule in PLAYGROUND_RULES uses
 * `when.subject`, and the category handed to evaluate() comes from the surface,
 * so the agent cannot move the decision. playground.selftest.ts asserts it.
 */
export function runAction(action: ScenarioAction, opts: { enabledToggleIds?: string[]; agent?: string } = {}): RunResult {
  const surface = SURFACE_BY_ACTION.get(action.id);
  if (!surface) throw new Error(`runAction: no surface owns action ${action.id}`);

  const toggles = opts.enabledToggleIds ?? DEFAULT_TOGGLES;
  const agent = opts.agent ?? action.defaultAgent;
  const rules = activeRules(toggles);
  const verdict = evaluate(action.act, rules, CATEGORY_BY_GROUP[surface.group]);

  const rewritten = verdict.decision === "CONSTRAIN" ? rewrite(action.act, verdict.constrain) : undefined;

  // A permit is minted only when the winning rule actually carries one and the
  // real permitCheck() passes for this action — never as decoration.
  let permitId: string | undefined;
  if (verdict.decision === "ALLOW") {
    const won = rules.find((r) => r.id === verdict.rule);
    if (won?.permit && permitCheck(won, action.act)?.ok) permitId = permitFor(action.id);
  }

  const result = typeof action.result === "string" ? action.result : action.result[verdict.decision];

  return {
    verdict,
    plane: surface.plane,
    rewritten,
    permitId,
    receiptId: receiptFor(action.id, toggles, agent),
    result,
    agent,
  };
}
