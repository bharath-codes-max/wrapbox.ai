// ============================================================================
// Seed Intent Contracts — natural language + compiled clause representation.
// The runtime brain evaluates these clauses; Intent Studio edits them.
// ============================================================================

import type { IntentContract } from "./types";
import { ORG } from "./org";

const now = Date.now();
const d = 24 * 3600 * 1000;

export const SEED_CONTRACTS: IntentContract[] = [
  {
    id: "ic-external-ai",
    name: "External AI usage",
    author: "u-priya",
    createdAt: now - 41 * d,
    version: 3,
    status: "ACTIVE",
    sourceText:
      "Employees may use approved AI services for normal business work. Customer email addresses and phone numbers must be reversibly tokenized before transmission to external AI. Credentials must never be transmitted externally. Source code may be uploaded to approved AI but requires review for other external destinations.",
    clauses: [
      {
        id: "cl-ai-1",
        text: "Approved AI services may be used for normal business work",
        dataClasses: [],
        destinations: ["APPROVED_AI"],
        actions: ["NETWORK_SEND"],
        effect: "ALLOW",
        requiredCapabilities: ["cap-net-https"],
        failClosed: false,
      },
      {
        id: "cl-ai-2",
        text: "Customer email addresses and phone numbers must be reversibly tokenized before transmission to external AI",
        dataClasses: ["PII.EMAIL", "PII.PHONE"],
        destinations: ["APPROVED_AI", "UNAPPROVED_AI"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "CONSTRAIN",
        transform: "REVERSIBLE_TOKENIZE",
        requiredCapabilities: ["cap-net-file", "cap-parse-office"],
        failClosed: true,
      },
      {
        id: "cl-ai-3",
        text: "Credentials must never be transmitted externally",
        dataClasses: ["CREDENTIAL.API_KEY", "CREDENTIAL.PRIVATE_KEY", "CREDENTIAL.PASSWORD"],
        destinations: ["APPROVED_AI", "UNAPPROVED_AI", "PARTNER", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL", "APPROVED_SAAS"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-net-file"],
        failClosed: true,
      },
      {
        id: "cl-ai-4",
        text: "Source code may go to approved AI; review required for other external destinations",
        dataClasses: ["SOURCE_CODE"],
        destinations: ["UNAPPROVED_AI", "PARTNER", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "REVIEW",
        requiredCapabilities: ["cap-net-file"],
        failClosed: true,
      },
    ],
    coverage: "ENFORCED",
  },
  {
    id: "ic-customer-data",
    name: "Customer data protection",
    author: "u-priya",
    createdAt: now - 35 * d,
    version: 2,
    status: "ACTIVE",
    sourceText:
      `${ORG.short} customer identifiers and account numbers must not leave the company unprotected. Bulk export of customer records requires security review. Payment card data must never leave approved payment systems.`,
    clauses: [
      {
        id: "cl-cd-1",
        text: "Customer identifiers / account numbers must be tokenized when leaving internally",
        dataClasses: ["CUSTOM.CUSTOMER_ID", "FINANCIAL.ACCOUNT"],
        destinations: ["APPROVED_AI", "APPROVED_SAAS", "PARTNER"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "CONSTRAIN",
        transform: "REVERSIBLE_TOKENIZE",
        requiredCapabilities: ["cap-net-file", "cap-parse-office"],
        failClosed: true,
      },
      {
        id: "cl-cd-2",
        text: "Bulk export of customer records requires security review",
        dataClasses: ["CUSTOM.CUSTOMER_ID", "FINANCIAL.ACCOUNT", "PII.EMAIL"],
        destinations: "ANY",
        actions: ["DATA_EXPORT"],
        effect: "REVIEW",
        requiredCapabilities: ["cap-gw-sql"],
        failClosed: true,
      },
      {
        id: "cl-cd-3",
        text: "Payment card data must never leave approved payment systems",
        dataClasses: ["PCI.CARD"],
        destinations: "ANY",
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-net-file"],
        failClosed: true,
      },
    ],
    coverage: "ENFORCED",
  },
  {
    id: "ic-engineering",
    name: "Engineering guardrails",
    author: "u-alex",
    createdAt: now - 21 * d,
    version: 4,
    status: "ACTIVE",
    sourceText:
      "Coding agents may read and edit source code in development. Agents must not read local secrets files. Force pushes to main require engineering review. Destructive operations against production databases are forbidden. Production deployments require SRE approval.",
    clauses: [
      {
        id: "cl-eng-1",
        text: "Coding agents may read/edit source code in development",
        dataClasses: ["SOURCE_CODE"],
        destinations: "ANY",
        actions: ["READ", "WRITE", "EXECUTE"],
        environments: ["development", "local", "test"],
        effect: "ALLOW",
        requiredCapabilities: ["cap-ep-file"],
        failClosed: false,
      },
      {
        id: "cl-eng-2",
        text: "Agents must not read local secrets files",
        dataClasses: ["CREDENTIAL.API_KEY", "CREDENTIAL.PRIVATE_KEY", "CREDENTIAL.PASSWORD"],
        destinations: "ANY",
        actions: ["SECRET_ACCESS", "READ"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-ep-file"],
        failClosed: true,
      },
      {
        id: "cl-eng-3",
        text: "Force pushes to main require engineering review",
        dataClasses: ["SOURCE_CODE"],
        destinations: "ANY",
        actions: ["WRITE"],
        environments: ["production"],
        effect: "REVIEW",
        requiredCapabilities: ["cap-gw-github"],
        failClosed: true,
      },
      {
        id: "cl-eng-4",
        text: "Destructive operations against production databases are forbidden",
        dataClasses: [],
        destinations: "ANY",
        actions: ["DELETE"],
        environments: ["production"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-gw-sql"],
        failClosed: true,
      },
      {
        id: "cl-eng-5",
        text: "Production deployments require SRE approval",
        dataClasses: [],
        destinations: "ANY",
        actions: ["DEPLOY"],
        environments: ["production"],
        effect: "REVIEW",
        requiredCapabilities: ["cap-gw-cloud"],
        failClosed: true,
      },
    ],
    coverage: "DEGRADED", // production deploys need the Cloud gateway, which is DEGRADED
  },
  {
    id: "ic-hr-legal",
    name: "HR & privileged material",
    author: "u-priya",
    createdAt: now - 12 * d,
    version: 1,
    status: "ACTIVE",
    sourceText:
      "Compensation data may be used in internal analytics but must be tokenized or blocked for external AI. Privileged legal material may be processed by approved internal models only; unknown external AI is blocked.",
    clauses: [
      {
        id: "cl-hr-1",
        text: "Compensation data: internal analytics allowed, external AI tokenized",
        dataClasses: ["HR.COMPENSATION"],
        destinations: ["APPROVED_AI", "UNAPPROVED_AI"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "CONSTRAIN",
        transform: "REVERSIBLE_TOKENIZE",
        requiredCapabilities: ["cap-net-file", "cap-semantic"],
        failClosed: true,
      },
      {
        id: "cl-hr-2",
        text: "Privileged legal material blocked for unknown external AI",
        dataClasses: ["LEGAL.PRIVILEGED"],
        destinations: ["UNAPPROVED_AI", "UNKNOWN_EXTERNAL", "GENERIC_EXTERNAL"],
        actions: ["NETWORK_SEND", "DATA_EXPORT"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-net-file", "cap-semantic"],
        failClosed: true,
      },
    ],
    coverage: "DEGRADED", // semantic classifier is DEGRADED — honest rollup
  },
  {
    id: "ic-health",
    name: "PHI handling (draft)",
    author: "u-maya",
    createdAt: now - 4 * d,
    version: 1,
    status: "DRAFT",
    sourceText:
      "Protected health information in scanned documents must be redacted before any external transmission. Encrypted attachments that cannot be inspected must be blocked when PHI policy applies.",
    clauses: [
      {
        id: "cl-ph-1",
        text: "PHI in scanned documents redacted before external transmission",
        dataClasses: ["HEALTH.PHI"],
        destinations: ["APPROVED_AI", "UNAPPROVED_AI", "PARTNER", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL"],
        actions: ["NETWORK_SEND"],
        effect: "CONSTRAIN",
        transform: "REDACT",
        requiredCapabilities: ["cap-ocr", "cap-net-file"],
        failClosed: true,
      },
      {
        id: "cl-ph-2",
        text: "Uninspectable encrypted attachments blocked when PHI policy applies",
        dataClasses: ["HEALTH.PHI"],
        destinations: "ANY",
        actions: ["NETWORK_SEND"],
        effect: "BLOCK",
        requiredCapabilities: ["cap-parse-encrypted"],
        failClosed: true,
      },
    ],
    coverage: "PENDING",
  },
];

/** Veridian wrote this one after a month of watching MCP traffic — it is part
 *  of the demo company's history, not the day-one recommended pack. Each clause
 *  names MCP tools (server.tool) and argument patterns; the Core Brain matches
 *  them in the same clauseMatches() as every other rule. */
export const MCP_TOOL_CONTRACT: IntentContract = {
  id: "ic-mcp-tools",
  name: "MCP tool policy",
  author: "u-priya",
  createdAt: now - 12 * d,
  version: 2,
  status: "ACTIVE",
  sourceText:
    "Tool calls to unregistered MCP servers are blocked. Agents may not delete files through the GitHub MCP server. MCP pushes straight to main require engineering review. MCP file tools may not write secrets files.",
  clauses: [
    {
      id: "cl-mcp-1",
      text: "Tool calls to unregistered MCP servers are blocked",
      dataClasses: [], destinations: "ANY", actions: "ANY",
      effect: "BLOCK", requiredCapabilities: ["cap-gw-mcp"], failClosed: true,
      mcp: { registered: false },
    },
    {
      id: "cl-mcp-2",
      text: "Agents may not delete files through the GitHub MCP server",
      dataClasses: [], destinations: "ANY", actions: "ANY",
      effect: "BLOCK", requiredCapabilities: ["cap-gw-mcp"], failClosed: true,
      mcp: { tools: ["github.delete_file"] },
    },
    {
      id: "cl-mcp-3",
      text: "MCP pushes straight to main require engineering review",
      dataClasses: [], destinations: "ANY", actions: "ANY",
      effect: "REVIEW", requiredCapabilities: ["cap-gw-mcp"], failClosed: true,
      mcp: { tools: ["github.push_files"], args: { branch: "^main$" } },
    },
    {
      id: "cl-mcp-4",
      text: "MCP file tools may not write secrets files",
      dataClasses: [], destinations: "ANY", actions: "ANY",
      effect: "BLOCK", requiredCapabilities: ["cap-ep-mcp-stdio"], failClosed: true,
      mcp: { tools: ["filesystem.write_file"], args: { path: "(^|/)\\.env$|credentials" } },
    },
  ],
  coverage: "DEGRADED",
};

/** Everything the seeded Veridian workspace runs with. */
export const DEMO_CONTRACTS: IntentContract[] = [...SEED_CONTRACTS, MCP_TOOL_CONTRACT];
