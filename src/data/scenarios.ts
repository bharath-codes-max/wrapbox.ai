import type { Adapter, Agent, CategoryId, Decision } from "./agents";
import { PEOPLE, type Person } from "./people";
import type { Act } from "../lib/engine";

export type Op =
  | { kind: "read"; path: string }
  | { kind: "shell"; command: string; cwd: string }
  | { kind: "git"; branch: string; command: string }
  | { kind: "mcp"; server: string; tool: string; args: Record<string, unknown> }
  | { kind: "fn"; name: string; args: Record<string, unknown> }
  | { kind: "http"; effect: string; args: Record<string, unknown> }
  | { kind: "browser"; action: string; label: string; args: Record<string, unknown> }
  | { kind: "a2a"; from: string; to: string; tool: string; args: Record<string, unknown> };

export type LineKind = "user" | "think" | "tool" | "out" | "ok" | "info" | "node";
export interface SLine {
  k: LineKind;
  t: string;
}

/** Deterministic context the policy engine sees. 0 = benign … 3 = severe. No model in the loop. */
export interface Signal {
  k: string;
  v: string;
  level: 0 | 1 | 2 | 3;
}

export interface Gate {
  id: string;
  op: Op;
  display: string;
  endpoint?: boolean;
  effect: string;
  resource: string;
  environment: string;
  rule: string;
  decision: Decision;
  reason: string;
  approvers?: Person[];
  quorum?: number;
  tamper?: { label: string; args: Record<string, unknown> };
  constrain?: { args: Record<string, unknown>; display: string; note: string };
  normalized?: Record<string, unknown>;
  signals: Signal[];
  /** [impact, trust] in 0..1 — where this action lands in the decision space */
  space: [number, number];
  scope?: { ok: boolean; note: string };
  dryRun?: string[];
  history?: { approved: number; rejected: number; suggestion?: string };
  latency: number;
  mcpResult?: string;
  then: SLine[];
}

export interface Scenario {
  id: string;
  category: CategoryId;
  title: string;
  human: Person;
  prompt: string;
  delegation?: string[];
  nodes?: string[];
  fields?: [string, string][];
  pre: SLine[];
  gates: Gate[];
  post: SLine[];
  outcome: string;
}

const L = (k: LineKind, t: string): SLine => ({ k, t });
const S = (k: string, v: string, level: Signal["level"]): Signal => ({ k, v, level });

export const SCENARIOS: Record<string, Scenario> = {
  ide: {
    id: "ide",
    category: "ide",
    title: "Secret read blocked — on both routes",
    human: PEOPLE.dev,
    prompt: "Fix the production login issue — users get logged out after 5 minutes.",
    pre: [
      L("think", "Looking at how sessions are created."),
      L("tool", "Read src/auth/session.ts"),
      L("out", "Read 84 lines"),
      L("tool", "Grep SESSION_TTL"),
      L("out", "3 matches in 2 files"),
      L("think", "The TTL probably comes from the production env file. Checking it."),
    ],
    gates: [
      {
        id: "ide-1",
        op: { kind: "read", path: "/wrapbox/web/.env.production" },
        display: "Read .env.production",
        effect: "filesystem.read",
        resource: "secrets · /wrapbox/web/.env.production",
        environment: "dev workstation",
        rule: "secrets.read",
        decision: "BLOCK",
        reason: "secret files are never read autonomously",
        signals: [S("Data class", "secrets (.env*)", 3), S("Reversibility", "exposure is irreversible", 3), S("Environment", "dev workstation", 1), S("Provenance", "user prompt · trusted", 0), S("Identity", "SSO + managed device", 0)],
        space: [0.86, 0.84],
        latency: 3,
        then: [L("think", "That read was blocked. Trying to print the value with Python instead.")],
      },
      {
        id: "ide-2",
        op: { kind: "shell", command: `python3 -c "print(open('.env.production').read())"`, cwd: "/wrapbox/web" },
        display: `Shell python3 -c "print(open('.env.production').read())"`,
        endpoint: true,
        effect: "filesystem.read (via process)",
        resource: "secrets · /wrapbox/web/.env.production",
        environment: "dev workstation",
        rule: "secrets.read",
        decision: "BLOCK",
        reason: "same effect, different route — caught at the endpoint",
        signals: [S("Data class", "secrets (.env*)", 3), S("Route", "python3 child of the agent", 2), S("Pattern", "retry after a denial", 3), S("Provenance", "agent-generated command", 1)],
        space: [0.9, 0.42],
        latency: 1,
        then: [
          L("think", "Both routes are blocked. Using the vault reference in config/session.ts instead."),
          L("tool", "Edit src/auth/session.ts"),
          L("out", "SESSION_TTL fallback 5m → 12h, value resolved from vault at runtime"),
        ],
      },
    ],
    post: [L("ok", "Fix ready · 2 secret reads blocked · 0 secrets exposed")],
    outcome: "The bug got fixed without the agent ever seeing a secret — even when it tried a second route.",
  },

  cli: {
    id: "cli",
    category: "cli",
    title: "Prod delete held for the on-call engineer",
    human: PEOPLE.arjun,
    prompt: "Deploy the payments hotfix to prod.",
    pre: [L("think", "Checking the current state of the payments pods first.")],
    gates: [
      {
        id: "cli-1",
        op: { kind: "shell", command: "kubectl get pods -n prod -l app=payments-api", cwd: "/wrapbox/payments" },
        display: "Bash(kubectl get pods -n prod -l app=payments-api)",
        effect: "shell.exec · read-only",
        resource: "k8s · prod/payments-api",
        environment: "production",
        rule: "default",
        decision: "ALLOW",
        reason: "read-only cluster query",
        signals: [S("Environment", "production", 2), S("Reversibility", "read-only", 0), S("Blast radius", "none", 0), S("Provenance", "user prompt · trusted", 0)],
        space: [0.22, 0.86],
        latency: 2,
        then: [
          L("out", "payments-api-7d9f   1/1   Running            3d"),
          L("out", "payments-api-8a1c   0/1   CrashLoopBackOff   14m"),
          L("think", "The rollout is stuck. I'll delete the deployment and recreate it."),
        ],
      },
      {
        id: "cli-2",
        op: { kind: "shell", command: "kubectl delete deployment payments-api -n prod", cwd: "/wrapbox/payments" },
        display: "Bash(kubectl delete deployment payments-api -n prod)",
        effect: "shell.exec · destructive",
        resource: "k8s · prod/deployment/payments-api",
        environment: "production",
        rule: "prod.k8s.delete",
        decision: "REVIEW",
        reason: "production deletes need the on-call engineer",
        approvers: [PEOPLE.dev],
        quorum: 1,
        tamper: {
          label: "Agent edits the command to hit -n prod-eu",
          args: { command: "kubectl delete deployment payments-api -n prod-eu" },
        },
        signals: [S("Environment", "production", 3), S("Reversibility", "destructive", 3), S("Blast radius", "2 pods · /pay endpoint", 2), S("Provenance", "user prompt · trusted", 0), S("Change window", "outside freeze", 0)],
        space: [0.84, 0.8],
        scope: { ok: true, note: "Task is “deploy the payments hotfix”; the target deployment is payments-api." },
        dryRun: [
          "− deployment/payments-api (prod) · 2 replicas → 0",
          "− 2 pods terminated · ~40s of 5xx on /pay while recreating",
          "+ recreated from k8s/payments.yaml · image payments:1.42.1-hotfix",
        ],
        history: { approved: 6, rejected: 0, suggestion: "Prefer `kubectl rollout restart` — it avoids downtime and could be ALLOW." },
        latency: 3,
        then: [
          L("out", 'deployment.apps "payments-api" deleted'),
          L("tool", "Bash(kubectl apply -f k8s/payments.yaml)"),
          L("out", "deployment.apps/payments-api created"),
        ],
      },
    ],
    post: [L("ok", "Hotfix live · permit used once, then expired")],
    outcome: "A destructive prod command ran exactly once — only after the on-call engineer signed off on that exact command.",
  },

  cloud: {
    id: "cloud",
    category: "cloud",
    title: "PR allowed, prod schema change blocked",
    human: PEOPLE.arjun,
    prompt: "Issue #482 · Update the billing migration for annual cycles",
    pre: [
      L("info", "Started work in an ephemeral runner · task token expires with the task"),
      L("tool", "Edit db/migrations/0042_billing_cycle.sql"),
      L("tool", "Run npm test"),
      L("out", "214 passed · 0 failed"),
    ],
    gates: [
      {
        id: "cloud-1",
        op: { kind: "git", branch: "copilot/billing-migration", command: "git push origin copilot/billing-migration" },
        display: "git push origin copilot/billing-migration",
        effect: "git.push",
        resource: "wrapbox/billing · copilot/billing-migration",
        environment: "repository",
        rule: "git.feature",
        decision: "ALLOW",
        reason: "feature branches are open to agents",
        signals: [S("Branch", "feature · unprotected", 0), S("Reversibility", "revertible", 0), S("Identity", "task-scoped token · 38 min left", 0), S("Actor", "unattended cloud agent", 1)],
        space: [0.2, 0.74],
        latency: 2,
        then: [L("out", "Opened pull request #483 · awaiting human review")],
      },
      {
        id: "cloud-2",
        mcpResult: "ALTER TABLE · 1,840,221 rows rewritten",
        op: {
          kind: "mcp",
          server: "postgres-prod",
          tool: "execute_sql",
          args: { sql: "ALTER TABLE invoices ADD COLUMN billing_cycle text NOT NULL DEFAULT 'monthly';" },
        },
        display: "postgres-prod · execute_sql(ALTER TABLE invoices …)",
        effect: "database.migrate (DDL)",
        resource: "postgres · prod/billing.invoices",
        environment: "production",
        rule: "prod.db.migrate",
        decision: "BLOCK",
        reason: "coding agents cannot change production schemas",
        normalized: { sql_class: "DDL", table_rows: 1_840_221, lock: "ACCESS EXCLUSIVE" },
        signals: [S("Environment", "production", 3), S("SQL class", "DDL · table lock", 3), S("Blast radius", "1.8M rows", 3), S("Actor", "unattended cloud agent", 2)],
        space: [0.94, 0.5],
        latency: 4,
        then: [L("think", "Production schema changes are blocked by policy. Added a note to the PR for a human to run it in the change window.")],
      },
    ],
    post: [L("ok", "PR #483 ready for review · production untouched")],
    outcome: "Code autonomy stays with the agent. Production authority stays with humans.",
  },

  custom: {
    id: "custom",
    category: "custom",
    title: "₹3,00,000 payout — two-person review",
    human: PEOPLE.anjali,
    prompt: "Process claim CLM-4821 · hospitalization · Apollo Hospitals · ₹3,00,000",
    nodes: ["intake", "fetch_policy", "assess_documents", "pay_claim", "notify"],
    pre: [
      L("node", "intake"),
      L("out", "Claim CLM-4821 received from claimant portal"),
      L("node", "fetch_policy"),
      L("out", "Policy WBX-HLT-2291 active · cover ₹5,00,000"),
      L("node", "assess_documents"),
      L("out", "3 documents verified · no fraud signals"),
      L("think", "Claim is valid. Paying the hospital directly."),
      L("node", "pay_claim"),
    ],
    gates: [
      {
        id: "custom-1",
        op: {
          kind: "fn",
          name: "pay_claim",
          args: { claim_id: "CLM-4821", amount: 300000, currency: "INR", payee: "Apollo Hospitals" },
        },
        display: "pay_claim(claim_id=CLM-4821, amount=300000)",
        effect: "claims.payout",
        resource: "claim · CLM-4821",
        environment: "production",
        rule: "claims.payout",
        decision: "REVIEW",
        reason: "payouts above ₹2,00,000 need two claims managers",
        approvers: [PEOPLE.meera, PEOPLE.rohan],
        quorum: 2,
        tamper: {
          label: "Agent raises the amount to ₹3,50,000 after approval",
          args: { claim_id: "CLM-4821", amount: 350000, currency: "INR", payee: "Apollo Hospitals" },
        },
        signals: [S("Amount", "₹3,00,000 · tier > ₹2,00,000", 3), S("Reversibility", "money movement", 3), S("Payee", "matches hospital master ✓", 0), S("Provenance", "claim docs · verified", 1), S("Identity", "service agent for anjali.v", 1)],
        space: [0.9, 0.72],
        scope: { ok: true, note: "Claim CLM-4821 and payee Apollo Hospitals match the intake request." },
        dryRun: ["− ₹3,00,000 debit · claims float account ••0921", "+ ₹3,00,000 credit · Apollo Hospitals ••7710", "~ claim CLM-4821 · assessed → settled"],
        history: { approved: 41, rejected: 3 },
        latency: 4,
        then: [
          L("out", "payment_service.verify(permit) ✓"),
          L("out", "₹3,00,000 paid to Apollo Hospitals · txn pay_9Hx2Lm"),
          L("node", "notify"),
          L("out", "Claimant notified by SMS and email"),
        ],
      },
    ],
    post: [L("ok", "Claim CLM-4821 settled")],
    outcome: "Money moved only after two humans signed off on this exact claim, payee and amount.",
  },

  "mcp-stripe": {
    id: "mcp-stripe",
    category: "mcp",
    title: "$300 refund allowed, $8,000 blocked",
    human: PEOPLE.sara,
    prompt: "Order A123 was double charged $300 — refund it. Also refund order B778 in full.",
    pre: [L("think", "I'll issue both refunds through the Stripe tools.")],
    gates: [
      {
        id: "mcp-1",
        op: { kind: "mcp", server: "stripe", tool: "create_refund", args: { payment_intent: "pi_3QxA123", amount: 30000, reason: "duplicate" } },
        display: "stripe · create_refund(pi_3QxA123, amount=30000)",
        effect: "payments.refund",
        resource: "stripe · pi_3QxA123 (order A123)",
        environment: "production",
        rule: "payments.refund",
        decision: "ALLOW",
        reason: "refunds up to $500 are automatic",
        normalized: { amount_usd: 300, from_minor_units: "30000 ¢" },
        signals: [S("Amount", "$300 · tier ≤ $500", 0), S("Reversibility", "refund", 2), S("Provenance", "support ticket · trusted", 0), S("Velocity", "3 of 40 today", 0)],
        space: [0.34, 0.84],
        latency: 3,
        mcpResult: "re_3Qx81Lm succeeded · $300.00",
        then: [L("out", "Refund re_3Qx81Lm succeeded · $300.00")],
      },
      {
        id: "mcp-2",
        mcpResult: "Refund re_3QxB778 succeeded · $8,000.00",
        op: { kind: "mcp", server: "stripe", tool: "create_refund", args: { payment_intent: "pi_3QxB778", amount: 800000 } },
        display: "stripe · create_refund(pi_3QxB778, amount=800000)",
        effect: "payments.refund",
        resource: "stripe · pi_3QxB778 (order B778)",
        environment: "production",
        rule: "payments.refund",
        decision: "BLOCK",
        reason: "above the $5,000 refund ceiling",
        normalized: { amount_usd: 8000, from_minor_units: "800000 ¢" },
        signals: [S("Amount", "$8,000 · above $5,000 ceiling", 3), S("Reversibility", "refund", 2), S("Provenance", "support ticket · trusted", 0)],
        space: [0.8, 0.74],
        latency: 4,
        then: [L("think", "The $8,000 refund was blocked by policy, so I've flagged it for a payments manager.")],
      },
    ],
    post: [L("ok", "Same decision whether the caller is Claude, Cursor or a LangGraph agent")],
    outcome: "$300 refunded automatically. $8,000 stopped before Stripe was ever called.",
  },

  "mcp-github": {
    id: "mcp-github",
    category: "mcp",
    title: "Issue allowed, merge to main blocked",
    human: PEOPLE.arjun,
    prompt: "Open an issue for the flaky invoice test, then merge PR #480.",
    pre: [L("think", "Creating the issue first.")],
    gates: [
      {
        id: "gh-1",
        op: { kind: "mcp", server: "github", tool: "create_issue", args: { owner: "wrapbox", repo: "billing", title: "Flaky test: invoice_rounding" } },
        display: "github · create_issue(repo=wrapbox/billing)",
        effect: "git.issue.create",
        resource: "github · wrapbox/billing",
        environment: "repository",
        rule: "default",
        decision: "ALLOW",
        reason: "issues are low-risk",
        signals: [S("Reversibility", "editable", 0), S("Blast radius", "none", 0), S("Provenance", "user prompt · trusted", 0)],
        space: [0.1, 0.9],
        latency: 2,
        mcpResult: "Issue #484 created",
        then: [L("out", "Issue #484 created")],
      },
      {
        id: "gh-2",
        mcpResult: "PR #480 merged into main",
        op: { kind: "mcp", server: "github", tool: "merge_pull_request", args: { owner: "wrapbox", repo: "billing", pullNumber: 480, merge_method: "squash" } },
        display: "github · merge_pull_request(#480 → main)",
        effect: "git.merge",
        resource: "github · wrapbox/billing@main",
        environment: "repository",
        rule: "git.main",
        decision: "BLOCK",
        reason: "agents never merge into main",
        signals: [S("Branch", "main · protected", 3), S("Reversibility", "deploys via CD", 3), S("Provenance", "user prompt · trusted", 0)],
        space: [0.82, 0.82],
        latency: 3,
        then: [L("think", "Merging to main needs a human. I've requested a review on #480.")],
      },
    ],
    post: [L("ok", "Issue filed · main protected")],
    outcome: "The agent can file work, but never ship it to main.",
  },

  "mcp-postgres": {
    id: "mcp-postgres",
    category: "mcp",
    title: "PII read constrained, DELETE on prod blocked",
    human: PEOPLE.arjun,
    prompt: "Pull the at-risk customers with their contact details, then clean up the test claims.",
    pre: [L("think", "Querying the customers table first.")],
    gates: [
      {
        id: "pg-1",
        op: { kind: "mcp", server: "postgres-prod", tool: "execute_sql", args: { sql: "SELECT name, email, phone FROM customers WHERE churn_risk > 0.8" } },
        display: "postgres-prod · execute_sql(SELECT name, email, phone …)",
        effect: "database.read · PII",
        resource: "postgres · prod/customers",
        environment: "production",
        rule: "pii.read",
        decision: "CONSTRAIN",
        reason: "PII columns are masked and results capped for agents",
        constrain: {
          args: { sql: "SELECT name, wbx_mask(email) AS email, wbx_mask(phone) AS phone FROM customers WHERE churn_risk > 0.8 LIMIT 500" },
          display: "SELECT name, wbx_mask(email), wbx_mask(phone) … LIMIT 500",
          note: "Allowed as a safer variant: email and phone masked, result capped at 500 rows.",
        },
        normalized: { sql_class: "SELECT", pii_columns: ["email", "phone"], estimated_rows: 412 },
        signals: [S("Data class", "PII · email, phone", 2), S("Environment", "production", 2), S("Rows", "~412", 1), S("Reversibility", "read-only", 0), S("Provenance", "user prompt · trusted", 0)],
        space: [0.42, 0.34],
        latency: 3,
        mcpResult: "412 rows · email/phone masked",
        then: [L("out", "412 rows · email and phone masked (j•••@n•••.com)")],
      },
      {
        id: "pg-2",
        mcpResult: "DELETE 312",
        op: { kind: "mcp", server: "postgres-prod", tool: "execute_sql", args: { sql: "DELETE FROM claims WHERE customer_email LIKE '%test%'" } },
        display: "postgres-prod · execute_sql(DELETE FROM claims …)",
        effect: "database.write · DELETE",
        resource: "postgres · prod/claims",
        environment: "production",
        rule: "db.prod.write",
        decision: "BLOCK",
        reason: "DELETE on a production table",
        normalized: { sql_class: "DML · DELETE", dry_run_rows: 312 },
        signals: [S("Environment", "production", 3), S("Reversibility", "destructive · no WHERE on PK", 3), S("Rows", "312 (dry-run count)", 2), S("Provenance", "user prompt · trusted", 0)],
        space: [0.88, 0.62],
        latency: 3,
        then: [L("think", "Deletes on production are blocked. I've written the SQL into a ticket for a DBA.")],
      },
    ],
    post: [L("ok", "412 masked rows returned · no rows deleted")],
    outcome: "Reads flow — with PII masked. Destructive writes to production never reach the database.",
  },

  "mcp-razorpay": {
    id: "mcp-razorpay",
    category: "mcp",
    title: "₹4,000 refund allowed, ₹5,00,000 blocked",
    human: PEOPLE.sara,
    prompt: "Refund ₹4,000 on ORD-7781 and ₹5,00,000 on ORD-7790.",
    pre: [L("think", "Issuing both refunds through Razorpay.")],
    gates: [
      {
        id: "rp-1",
        op: { kind: "mcp", server: "razorpay", tool: "create_refund", args: { payment_id: "pay_N7781", amount: 400000 } },
        display: "razorpay · create_refund(pay_N7781, amount=400000)",
        effect: "payments.refund",
        resource: "razorpay · ORD-7781",
        environment: "production",
        rule: "payments.refund",
        decision: "ALLOW",
        reason: "₹4,000 ≈ $48 — within the automatic tier",
        normalized: { amount_inr: 4000, amount_usd: 48, from_minor_units: "400000 paise" },
        signals: [S("Amount", "₹4,000 ≈ $48", 0), S("Reversibility", "refund", 2), S("Provenance", "support ticket · trusted", 0)],
        space: [0.3, 0.84],
        latency: 3,
        mcpResult: "rfnd_QK81 processed · ₹4,000",
        then: [L("out", "rfnd_QK81 processed · ₹4,000")],
      },
      {
        id: "rp-2",
        mcpResult: "rfnd_QK90 processed · ₹5,00,000",
        op: { kind: "mcp", server: "razorpay", tool: "create_refund", args: { payment_id: "pay_N7790", amount: 50000000 } },
        display: "razorpay · create_refund(pay_N7790, amount=50000000)",
        effect: "payments.refund",
        resource: "razorpay · ORD-7790",
        environment: "production",
        rule: "payments.refund",
        decision: "BLOCK",
        reason: "₹5,00,000 ≈ $6,000 — above the $5,000 ceiling",
        normalized: { amount_inr: 500000, amount_usd: 6000, from_minor_units: "50000000 paise" },
        signals: [S("Amount", "₹5,00,000 ≈ $6,000", 3), S("Reversibility", "refund", 2), S("Provenance", "support ticket · trusted", 0)],
        space: [0.82, 0.74],
        latency: 4,
        then: [L("think", "The large refund is blocked. Escalated to payments.")],
      },
    ],
    post: [L("ok", "Wrapbox normalizes paise and cents into one currency before it evaluates the rule")],
    outcome: "One refund rule governs Stripe and Razorpay alike, in any currency.",
  },

  saas: {
    id: "saas",
    category: "saas",
    title: "40% discount waits for the VP",
    human: PEOPLE.kiran,
    prompt: "Northwind Logistics may churn at renewal. Offer what it takes to keep them.",
    pre: [
      L("tool", "Get Account · Northwind Logistics"),
      L("out", "ARR ₹18,40,000 · renewal in 12 days · NPS 21"),
      L("tool", "Get Case 00012931"),
      L("out", "Escalation: 3 outages in Q3"),
      L("think", "Proposing a 40% renewal discount plus a ₹50,000 service credit."),
    ],
    gates: [
      {
        id: "saas-1",
        op: { kind: "http", effect: "crm.apply_discount", args: { account: "Northwind Logistics", discount_pct: 40, credit_inr: 50000, term_months: 12 } },
        display: "Apply Discount · 40% + ₹50,000 credit",
        effect: "crm.apply_discount",
        resource: "salesforce · Opportunity 006-NW-2026",
        environment: "production",
        rule: "crm.discount",
        decision: "REVIEW",
        reason: "discounts above 25% need VP Sales",
        approvers: [PEOPLE.ananya],
        quorum: 1,
        tamper: { label: "Agent bumps the discount to 45% after approval", args: { account: "Northwind Logistics", discount_pct: 45, credit_inr: 50000, term_months: 12 } },
        signals: [S("Discount", "40% · tier > 25%", 3), S("ARR impact", "−₹7,36,000", 3), S("Reversibility", "contractual", 3), S("Provenance", "case notes · internal", 1)],
        space: [0.86, 0.66],
        scope: { ok: true, note: "Task is a retention offer for Northwind; the discount targets its renewal." },
        dryRun: ["~ Opportunity 006-NW-2026 · discount 0% → 40%", "+ Service credit ₹50,000 on next invoice", "~ ARR ₹18,40,000 → ₹11,04,000"],
        history: { approved: 2, rejected: 5, suggestion: "5 of 7 similar requests were countered at 20% — consider a 20% auto-offer ceiling." },
        latency: 5,
        then: [
          L("out", "Opportunity updated · 40% · permit verified by connector"),
          L("tool", "Send Email · renewal offer to ops@northwind.example"),
          L("out", "Sent"),
        ],
      },
    ],
    post: [L("ok", "Renewal saved · VP sign-off on record")],
    outcome: "The agent drafted everything. The commercial commitment waited for the right human.",
  },

  browser: {
    id: "browser",
    category: "browser",
    title: "$50,000 vendor payment — final click gated",
    human: PEOPLE.neha,
    prompt: "Pay invoice INV-2291 from Vendor X on the vendor portal.",
    fields: [
      ["Payee", "Vendor X Ltd"],
      ["Amount", "50,000.00 USD"],
      ["Account", "••••4471"],
      ["Reference", "INV-2291"],
    ],
    pre: [
      L("tool", "navigate vendor.example/login"),
      L("out", "Signed in with saved session (neha.j)"),
      L("tool", "click Payments → New payment"),
      L("tool", "input Payee = Vendor X Ltd"),
      L("tool", "input Amount = 50,000.00"),
      L("tool", "input Account = ••••4471"),
    ],
    gates: [
      {
        id: "browser-1",
        op: {
          kind: "browser",
          action: "payment.submit",
          label: 'click "Submit payment"',
          args: { amount: 50000, currency: "USD", payee: "Vendor X Ltd", account: "••4471", invoice: "INV-2291", origin: "vendor.example" },
        },
        display: 'click "Submit payment"',
        effect: "payment.submit",
        resource: "vendor.example · Vendor X Ltd",
        environment: "production",
        rule: "browser.payment",
        decision: "REVIEW",
        reason: "browser payments need the finance controller",
        approvers: [PEOPLE.vikram],
        quorum: 1,
        tamper: {
          label: "Hidden text on the page rewrites the payee account to ••9921",
          args: { amount: 50000, currency: "USD", payee: "Vendor X Ltd", account: "••9921", invoice: "INV-2291", origin: "vendor.example" },
        },
        signals: [S("Amount", "$50,000", 3), S("Provenance", "page has hidden instructions · tainted", 3), S("Reversibility", "wire transfer", 3), S("Payee", "matches vendor master ✓", 0)],
        space: [0.9, 0.3],
        scope: { ok: true, note: "Invoice INV-2291 and Vendor X match the task. Payee account matches the vendor master." },
        dryRun: ["− $50,000.00 · Ops account ••4471", "+ Vendor X Ltd · invoice INV-2291 marked paid", "· page origin vendor.example · session neha.j"],
        history: { approved: 18, rejected: 1 },
        latency: 4,
        then: [L("out", "Click dispatched · confirmation VX-88213")],
      },
    ],
    post: [L("ok", "Invoice INV-2291 paid")],
    outcome: "A prompt injection on the page can't swap the payee: the final click is re-checked against the permit.",
  },

  a2a: {
    id: "a2a",
    category: "a2a",
    title: "Subagent's $100,000 order blocked by attenuation",
    human: PEOPLE.priya,
    prompt: "Restock 12 laptops for the new claims team.",
    delegation: ["Priya Menon", "ops-supervisor", "purchasing-subagent", "vendor-quotes-agent"],
    pre: [
      L("info", "ops-supervisor → purchasing-subagent · budget $10,000 · ttl 30m · tools [place_order]"),
      L("tool", "vendor-quotes-agent · get_quote(12× ThinkPad T14)"),
      L("out", "Quote Q-5521 · $8,400"),
    ],
    gates: [
      {
        id: "a2a-1",
        op: { kind: "a2a", from: "purchasing-subagent", to: "northstar-it", tool: "place_order", args: { vendor: "Northstar IT", items: "12× ThinkPad T14", amount_usd: 100000 } },
        display: "place_order(vendor=Northstar IT, amount_usd=100000)",
        effect: "agent.delegate → purchase.order",
        resource: "vendor · Northstar IT",
        environment: "production",
        rule: "agent.delegate",
        decision: "BLOCK",
        reason: "exceeds the $10,000 budget its parent delegated",
        signals: [S("Budget", "$100,000 vs delegated $10,000", 3), S("Quote", "doesn't match Q-5521 ($8,400)", 3), S("Delegation depth", "2 hops from Priya", 2)],
        space: [0.86, 0.26],
        latency: 2,
        then: [L("think", "Amount didn't match the quote. Correcting to $8,400.")],
      },
      {
        id: "a2a-2",
        op: { kind: "a2a", from: "purchasing-subagent", to: "northstar-it", tool: "place_order", args: { vendor: "Northstar IT", items: "12× ThinkPad T14", amount_usd: 8400, quote: "Q-5521" } },
        display: "place_order(vendor=Northstar IT, amount_usd=8400)",
        effect: "agent.delegate → purchase.order",
        resource: "vendor · Northstar IT",
        environment: "production",
        rule: "agent.delegate",
        decision: "ALLOW",
        reason: "within the delegated budget",
        signals: [S("Budget", "$8,400 of $10,000", 1), S("Quote", "matches Q-5521", 0), S("Delegation depth", "2 hops from Priya", 2)],
        space: [0.44, 0.7],
        latency: 2,
        then: [L("out", "PO-7731 placed · $8,400")],
      },
    ],
    post: [L("ok", "Evidence chain: Priya → ops-supervisor → purchasing-subagent → Northstar IT")],
    outcome: "The subagent's extra zero never became a $100,000 order.",
  },
};

export const scenarioFor = (agent: Agent) =>
  SCENARIOS[agent.scenario ?? (agent.category === "mcp" ? "mcp-stripe" : agent.category)];

export const allGates = () => Object.values(SCENARIOS).flatMap((s) => s.gates.map((g) => ({ s, g })));

/* ------------------------------------------------------------------ */
/* Native adapters: every agent speaks its own format.                */
/* Command hooks read the event on stdin and answer with exit code +  */
/* stdout, matching the live-tested adapter in hooks/intentos-hook.mjs */
/* ------------------------------------------------------------------ */

export interface RespondCtx {
  reason: string;
  rule: string;
  decisionId: string;
  permitId?: string;
  pending?: boolean;
  rewritten?: Record<string, unknown>;
}

export interface Native {
  adapter: Adapter;
  hook: string;
  request: unknown;
  respond: (d: Decision, ctx: RespondCtx) => unknown;
  denyLine: (reason: string) => string;
}

export function resolveAdapter(agent: Agent, gate: Gate): Adapter {
  if (gate.endpoint) return "runtime";
  if (gate.op.kind === "mcp") return "mcp";
  if (gate.op.kind === "git" && agent.adapter === "cloud") return "cloud";
  return agent.adapter;
}

const session = "a1b2c3d4";
const HELD = {
  status: "held",
  stdout: null,
  note: "The hook process stays open while the approver decides (poll budget 75s). Wrapbox never answers \"ask\": the developer at the keyboard could approve their own action.",
};

export function nativeFor(agent: Agent, gate: Gate): Native {
  const adapter = resolveAdapter(agent, gate);
  const op = gate.op;
  const cmd = op.kind === "shell" ? op.command : op.kind === "git" ? op.command : "";
  const cwd = op.kind === "shell" ? op.cwd : "/wrapbox/billing";
  const isRead = op.kind === "read";
  const path = op.kind === "read" ? op.path : "";
  const denyReason = (c: RespondCtx) => `wrapbox: ${c.reason} (rule ${c.rule} · ${c.decisionId})`;

  switch (adapter) {
    case "claude":
    case "codex": {
      const tool = isRead ? "Read" : "Bash";
      const claude = adapter === "claude";
      return {
        adapter,
        hook: claude ? "PreToolUse · command hook (stdin)" : "PreToolUse · command hook (stdin)",
        request: {
          session_id: session,
          transcript_path: claude ? `~/.claude/projects/wrapbox/${session}.jsonl` : `~/.codex/sessions/2026/09/11/${session}.jsonl`,
          cwd: isRead ? "/wrapbox/web" : cwd,
          hook_event_name: "PreToolUse",
          tool_name: claude ? tool : isRead ? "read_file" : "shell",
          tool_input: isRead ? { file_path: path } : claude ? { command: cmd, description: "Run command" } : { command: ["bash", "-lc", cmd] },
        },
        respond: (d, c) => {
          if (c.pending) return HELD;
          if (d === "BLOCK")
            return {
              exit_code: 2,
              stdout: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: denyReason(c) } },
              stderr: denyReason(c),
            };
          if (!claude)
            return { exit_code: 0, stdout: "", note: "codex-cli 0.153 rejects permissionDecision \"allow\" — allow is exit 0 with empty stdout" };
          return {
            exit_code: 0,
            stdout: {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                permissionDecisionReason: `wrapbox: permit ${c.permitId}`,
                ...(c.rewritten ? { updatedInput: c.rewritten } : {}),
              },
            },
          };
        },
        denyLine: (r) => (claude ? `⎿  PreToolUse:${tool} hook error: wrapbox: ${r}` : `✗ blocked by PreToolUse hook — wrapbox: ${r}`),
      };
    }
    case "gemini":
      return {
        adapter,
        hook: "BeforeTool · command hook (stdin)",
        request: {
          hook_event_name: "BeforeTool",
          session_id: session,
          cwd,
          tool_name: isRead ? "read_file" : "run_shell_command",
          tool_input: isRead ? { absolute_path: path } : { command: cmd },
        },
        respond: (d, c) =>
          c.pending ? HELD : d === "BLOCK" ? { exit_code: 2, stdout: { decision: "deny", reason: denyReason(c) } } : { exit_code: 0, stdout: { decision: "allow", reason: `permit ${c.permitId}` } },
        denyLine: (r) => `✕ Tool call blocked by BeforeTool hook — ${r}`,
      };
    case "copilot":
      return {
        adapter,
        hook: "preToolUse · command hook (stdin)",
        request: { timestamp: 1789123456789, cwd, toolName: isRead ? "view" : "bash", toolArgs: JSON.stringify(isRead ? { path } : { command: cmd }) },
        respond: (d, c) =>
          c.pending
            ? HELD
            : d === "BLOCK"
              ? { exit_code: 2, stdout: { permissionDecision: "deny", permissionDecisionReason: denyReason(c) } }
              : { exit_code: 0, stdout: { permissionDecision: "allow" } },
        denyLine: (r) => `✗ Denied by preToolUse hook: ${r}`,
      };
    case "cursor":
      return {
        adapter,
        hook: isRead ? "beforeReadFile · command hook (stdin)" : "beforeShellExecution · command hook (stdin)",
        request: isRead
          ? { hook_event_name: "beforeReadFile", conversation_id: "c_81f2", generation_id: "g_19a", file_path: path, workspace_roots: ["/wrapbox/web"], user_email: "dev.k@wrapbox.ai" }
          : { hook_event_name: "beforeShellExecution", conversation_id: "c_81f2", generation_id: "g_19b", command: cmd, cwd, user_email: "dev.k@wrapbox.ai" },
        respond: (d, c) =>
          c.pending ? HELD : d === "BLOCK" ? { exit_code: 2, stdout: { permission: "deny", user_message: denyReason(c) } } : { exit_code: 0, stdout: { permission: "allow" } },
        denyLine: (r) => `Blocked by Wrapbox: ${r}`,
      };
    case "windsurf":
      return {
        adapter,
        hook: isRead ? "pre_read_code · command hook (stdin)" : "pre_run_command · command hook (stdin)",
        request: {
          agent_action_name: isRead ? "pre_read_code" : "pre_run_command",
          trajectory_id: "t_4f81",
          execution_id: "e_209",
          timestamp: "2026-09-12T09:14:02Z",
          model_name: "SWE-1.5",
          tool_info: isRead ? { file_path: path } : { command_line: cmd, cwd },
        },
        respond: (d, c) => (c.pending ? HELD : d === "BLOCK" ? { exit_code: 2, stderr: denyReason(c), note: "Pre-hooks block with exit 2; Cascade shows the stderr line" } : { exit_code: 0, stdout: "" }),
        denyLine: (r) => `Hook blocked this step — wrapbox: ${r}`,
      };
    case "cline":
      return {
        adapter,
        hook: "PreToolUse · executable hook (stdin)",
        request: { hookName: "PreToolUse", clineVersion: "3.42.0", taskId: "t-81f2", workspaceRoots: ["/wrapbox/web"], toolName: isRead ? "read_file" : "execute_command", toolInput: isRead ? { path } : { command: cmd } },
        respond: (d, c) => (c.pending ? HELD : d === "BLOCK" ? { exit_code: 0, stdout: { cancel: true, errorMessage: denyReason(c) } } : { exit_code: 0, stdout: { cancel: false } }),
        denyLine: (r) => `Tool cancelled by hook — wrapbox: ${r}`,
      };
    case "opencode":
      return {
        adapter,
        hook: "tool.execute.before · plugin (in-process)",
        request: { event: "tool.execute.before", input: { tool: isRead ? "read" : "bash", sessionID: "ses_9c1", callID: "call_3e" }, output: { args: isRead ? { filePath: path } : { command: cmd, workdir: cwd } } },
        respond: (d, c) => (c.pending ? HELD : d === "BLOCK" ? { thrown: "Error", message: denyReason(c), note: "Throwing inside tool.execute.before stops the call" } : { returned: null, ...(c.rewritten ? { "output.args": c.rewritten } : {}) }),
        denyLine: (r) => `✗ tool blocked by plugin — wrapbox: ${r}`,
      };
    case "droid":
    case "kiro":
    case "auggie": {
      const ev = adapter === "kiro" ? "preToolUse" : "PreToolUse";
      const tool = adapter === "kiro" ? (isRead ? "fs_read" : "execute_bash") : adapter === "droid" ? (isRead ? "Read" : "Execute") : isRead ? "view" : "launch-process";
      return {
        adapter,
        hook: `${ev} · command hook (stdin)`,
        request: { hook_event_name: ev, session_id: session, cwd, tool_name: tool, tool_input: isRead ? (adapter === "kiro" ? { path } : { file_path: path }) : { command: cmd } },
        respond: (d, c) =>
          c.pending
            ? HELD
            : d === "BLOCK"
              ? { exit_code: 2, stderr: denyReason(c), ...(adapter === "kiro" ? {} : { stdout: { hookSpecificOutput: { hookEventName: ev, permissionDecision: "deny", permissionDecisionReason: denyReason(c) } } }) }
              : { exit_code: 0, stdout: "" },
        denyLine: (r) => `✗ blocked by ${ev} hook — wrapbox: ${r}`,
      };
    }
    case "runtime":
      return {
        adapter,
        hook: "Endpoint runtime · file.open",
        request: {
          event: "file.open",
          host: "dk-macbook-pro",
          user: "dev.k",
          pid: 48213,
          ppid: 48190,
          process: "python3",
          argv: ["python3", "-c", "print(open('.env.production').read())"],
          parent_agent: agent.id,
          path: "/wrapbox/web/.env.production",
          flags: "O_RDONLY",
        },
        respond: (d, c) => ({ verdict: d === "BLOCK" ? "deny" : "allow", errno: d === "BLOCK" ? "EACCES" : null, rule: c.rule, decision_id: c.decisionId }),
        denyLine: () => "PermissionError: [Errno 13] Permission denied: '.env.production'  (wrapbox runtime)",
      };
    case "mcp": {
      const m = op as Extract<Op, { kind: "mcp" }>;
      return {
        adapter,
        hook: `MCP Gateway · tools/call → ${m.server}`,
        request: { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: m.tool, arguments: m.args } },
        respond: (d, c) =>
          d === "BLOCK"
            ? { jsonrpc: "2.0", id: 42, error: { code: -32003, message: `Denied by Wrapbox policy ${c.rule}`, data: { decision_id: c.decisionId, reason: c.reason } } }
            : c.pending
              ? HELD
              : {
                  jsonrpc: "2.0",
                  id: 42,
                  result: {
                    content: [{ type: "text", text: gate.mcpResult ?? "ok" }],
                    _meta: {
                      "wrapbox/decision_id": c.decisionId,
                      "wrapbox/permit": c.permitId,
                      ...(c.rewritten ? { "wrapbox/forwarded_arguments": c.rewritten } : {}),
                    },
                  },
                },
        denyLine: (r) => `Tool error -32003 · denied by Wrapbox: ${r}`,
      };
    }
    case "sdk-ts":
    case "sdk-py":
    case "adk": {
      const f = op as Extract<Op, { kind: "fn" }>;
      const label = adapter === "adk" ? "before_tool_callback" : adapter === "sdk-py" ? '@guard("claims.payout")' : 'wrapbox.guard("claims.payout")';
      return {
        adapter,
        hook: label,
        request: {
          effect: gate.effect,
          tool: f.name,
          args: f.args,
          subject_agent: "claims-agent-prod",
          on_behalf_of: "anjali.v",
          context: { thread_id: "th_4821", framework: agent.vendor },
        },
        respond: (d, c) =>
          d === "BLOCK"
            ? { decision: "BLOCK", error: "WrapboxDenied", rule: c.rule, reason: c.reason, decision_id: c.decisionId }
            : c.pending
              ? { decision: "REVIEW", status: "interrupt", resume_token: "rt_7c1e", decision_id: c.decisionId, approvers_required: gate.quorum }
              : { decision: "ALLOW", decision_id: c.decisionId, permit: c.permitId, expires_in: 60, header: "X-Wrapbox-Permit" },
        denyLine: (r) => `WrapboxDenied: ${r}`,
      };
    }
    case "cloud":
      return {
        adapter,
        hook: "Provider hook · git push",
        request: {
          event: "pre-receive",
          repository: "wrapbox/billing",
          ref: `refs/heads/${op.kind === "git" ? op.branch : "main"}`,
          actor: agent.id === "codex-cloud" ? "codex-cloud[bot]" : "copilot-swe-agent[bot]",
          task: "issue#482",
          task_token_expires: "2026-09-11T13:02:00Z",
        },
        respond: (d, c) => ({ decision: d, decision_id: c.decisionId, check_run: { name: "Wrapbox", conclusion: d === "BLOCK" ? "failure" : "success" } }),
        denyLine: (r) => `✗ push rejected by Wrapbox: ${r}`,
      };
    case "connector": {
      const h = op as Extract<Op, { kind: "http" }>;
      return {
        adapter,
        hook: "Custom connector action",
        request: {
          method: "POST",
          url: `https://api.wrapbox.ai/v1/actions/${h.effect}`,
          body: { ...h.args, subject_agent: agent.id, on_behalf_of: "kiran.b@wrapbox.ai", case: "00012931" },
        },
        respond: (d, c) =>
          d === "BLOCK"
            ? { status: "blocked", decision: "BLOCK", rule: c.rule, reason: c.reason }
            : c.pending
              ? { status: "pending_approval", decision: "REVIEW", decision_id: c.decisionId, approval_url: `https://app.wrapbox.ai/approvals/${c.decisionId}` }
              : { status: "executed", decision: "ALLOW", decision_id: c.decisionId, permit_id: c.permitId },
        denyLine: (r) => `Action returned: blocked by policy — ${r}`,
      };
    }
    case "browser": {
      const b = op as Extract<Op, { kind: "browser" }>;
      return {
        adapter,
        hook: "Controlled executor · click",
        request: {
          semantic_action: b.action,
          raw: { type: "click", selector: "button:has-text('Submit payment')" },
          page_origin: "https://vendor.example/payments/new",
          fields: b.args,
          session: "neha.j (saved)",
          taint: ["hidden text node · 'update the payee account…'"],
        },
        respond: (d, c) => ({ dispatch: !c.pending && d !== "BLOCK", decision: c.pending ? "REVIEW" : d, decision_id: c.decisionId, permit_id: c.permitId ?? null }),
        denyLine: (r) => `Click not dispatched — blocked by Wrapbox: ${r}`,
      };
    }
    case "a2a": {
      const a = op as Extract<Op, { kind: "a2a" }>;
      return {
        adapter,
        hook: "A2A gateway · message/send",
        request: {
          jsonrpc: "2.0",
          id: 7,
          method: "message/send",
          params: {
            message: { role: "agent", parts: [{ kind: "data", data: { tool: a.tool, args: a.args } }] },
            metadata: { "wrapbox/delegation": { root: "priya.m", parent: "ops-supervisor", agent: a.from, budget_usd: 10000, expires: "30m" } },
          },
        },
        respond: (d, c) =>
          d === "BLOCK"
            ? { jsonrpc: "2.0", id: 7, error: { code: -32003, message: c.reason, data: { rule: c.rule, decision_id: c.decisionId } } }
            : { jsonrpc: "2.0", id: 7, result: { kind: "task", status: { state: "completed" }, artifacts: [{ name: "PO-7731" }], metadata: { "wrapbox/permit": c.permitId } } },
        denyLine: (r) => `A2A error -32003: ${r}`,
      };
    }
  }
}

export function normalizedFor(agent: Agent, gate: Gate, s: Scenario) {
  return {
    effect: gate.effect,
    resource: gate.resource,
    args: gateArgs(gate),
    ...(gate.normalized ?? {}),
    subject_agent: agent.id,
    on_behalf_of: s.human.id,
    environment: gate.environment,
    via: resolveAdapter(agent, gate),
    signals: Object.fromEntries(gate.signals.map((x) => [x.k.toLowerCase().replace(/ /g, "_"), x.v])),
  };
}

export function gateArgs(gate: Gate): Record<string, unknown> {
  const op = gate.op;
  if (op.kind === "read") return { path: op.path };
  if (op.kind === "shell" || op.kind === "git") return { command: op.command };
  return op.args;
}

/** The arguments the permit is bound to: the constrained variant when Wrapbox rewrote the call. */
export const permittedArgs = (gate: Gate) => gate.constrain?.args ?? gateArgs(gate);

/* ------------------------------------------------------------------ */
/* What the policy engine sees for each scripted action. Decisions in  */
/* flows come from evaluating these against YOUR published contract.   */
/* ------------------------------------------------------------------ */

export const ACTS: Record<string, Act> = {
  "ide-1": { effect: "filesystem.read", path: "/wrapbox/web/.env.production", env: "development" },
  "ide-2": { effect: "filesystem.read", path: "/wrapbox/web/.env.production", env: "development", command: `python3 -c "print(open('.env.production').read())"` },
  "cli-1": { effect: "shell.exec", command: "kubectl get pods -n prod -l app=payments-api", env: "production" },
  "cli-2": { effect: "shell.exec", command: "kubectl delete deployment payments-api -n prod", env: "production" },
  "cloud-1": { effect: "git.push", branch: "copilot/billing-migration", command: "git push origin copilot/billing-migration", env: "development" },
  "cloud-2": { effect: "database.migrate", sql: "ALTER TABLE invoices ADD COLUMN billing_cycle text NOT NULL DEFAULT 'monthly';", env: "production" },
  "custom-1": { effect: "claims.payout", amount: 300000, env: "production" },
  "mcp-1": { effect: "payments.refund", amount: 30000, amountUsd: 300, env: "production" },
  "mcp-2": { effect: "payments.refund", amount: 800000, amountUsd: 8000, env: "production" },
  "gh-1": { effect: "git.issue.create", env: "production" },
  "gh-2": { effect: "git.merge", branch: "main", env: "production" },
  "pg-1": { effect: "database.read", columns: ["name", "email", "phone"], sql: "SELECT name, email, phone FROM customers WHERE churn_risk > 0.8", env: "production" },
  "pg-2": { effect: "database.write", sql: "DELETE FROM claims WHERE customer_email LIKE '%test%'", env: "production" },
  "rp-1": { effect: "payments.refund", amount: 4000, amountUsd: 48, env: "production" },
  "rp-2": { effect: "payments.refund", amount: 500000, amountUsd: 6000, env: "production" },
  "saas-1": { effect: "crm.apply_discount", amount: 40, env: "production" },
  "browser-1": { effect: "payment.submit", amount: 50000, amountUsd: 50000, env: "production" },
  "a2a-1": { effect: "purchase.order", amount: 100000, budget: 10000, env: "production" },
  "a2a-2": { effect: "purchase.order", amount: 8400, budget: 10000, env: "production" },
};
export const actOf = (g: Gate): Act => ACTS[g.id] ?? { effect: g.effect.split(" ")[0], env: "production" };

/** Retries that only happen because the previous action was blocked. */
export const REQUIRES_BLOCK = new Set(["ide-2", "a2a-2"]);

/** What actually happens when your contract lets a risky scripted action through. */
export const ALT_ALLOW: Record<string, SLine[]> = {
  "ide-1": [
    { k: "out", t: "Read 14 lines · DATABASE_URL=postgres://admin:••••@prod-db…  STRIPE_SECRET_KEY=••••" },
    { k: "think", t: "Found SESSION_TTL=5m and the production keys. Continuing with the fix." },
  ],
  "cloud-2": [{ k: "out", t: "ALTER TABLE executed on prod · invoices locked for 41s · 1.8M rows rewritten" }],
  "mcp-2": [{ k: "out", t: "Refund re_3QxB778 succeeded · $8,000.00" }],
  "gh-2": [{ k: "out", t: "PR #480 merged into main · deploy pipeline started" }],
  "pg-1": [{ k: "out", t: "412 rows · raw emails and phone numbers returned to the agent" }],
  "pg-2": [{ k: "out", t: "DELETE 312 · rows removed from production claims" }],
  "rp-2": [{ k: "out", t: "rfnd_QK90 processed · ₹5,00,000" }],
  "a2a-1": [{ k: "out", t: "PO-7730 placed · $100,000 · 120× ThinkPad T14" }],
};
