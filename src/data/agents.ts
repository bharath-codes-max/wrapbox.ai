export type Decision = "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK";
export type CategoryId = "ide" | "cli" | "cloud" | "custom" | "mcp" | "saas" | "browser" | "a2a";
export type Assurance =
  | "observe-only"
  | "hook-enforced"
  | "gateway-enforced"
  | "endpoint-enforced"
  | "resource-verified";

export type Adapter =
  | "claude"
  | "codex"
  | "gemini"
  | "copilot"
  | "cursor"
  | "runtime"
  | "mcp"
  | "sdk-py"
  | "sdk-ts"
  | "adk"
  | "cloud"
  | "connector"
  | "browser"
  | "a2a"
  // Native pre-tool hooks with their own wire format (verified against vendor docs)
  | "windsurf"
  | "cline"
  | "opencode"
  | "droid"
  | "kiro"
  | "auggie";

export type Surface = "terminal" | "ide" | "github" | "graph" | "chat" | "crm" | "browser" | "delegation";

/* ================= How Wrapbox connects =================
   Every agent connects through exactly one of five mechanisms. This is the axis buyers ask
   about ("does it have hooks?"), so it is shown on every card, and it decides whether an
   agent is connectable today or on the roadmap. */
export type Mechanism = "hooks" | "sdk" | "gateway" | "runtime" | "connector";
export const MECHANISM: Record<Mechanism, { label: string; short: string; plain: string }> = {
  hooks: { label: "Native hooks", short: "Hooks", plain: "The agent's own pre-tool hook asks Wrapbox before it acts. A config file — pushed by MDM, committed to the repo, or installed with one command." },
  sdk: { label: "Wrapbox SDK", short: "SDK", plain: "Your code calls guard() before every tool runs. The service behind it can also verify the signed permit." },
  gateway: { label: "MCP / API gateway", short: "Gateway", plain: "The agent reaches tools through mcp.wrapbox.ai. Only approved calls are forwarded to the real server." },
  runtime: { label: "Endpoint runtime", short: "Runtime", plain: "For agents without hooks: Wrapbox mediates file, process and network calls below the agent." },
  connector: { label: "Platform connector", short: "Connector", plain: "The platform hosts the agent. Wrapbox attaches through the platform's connector or API — on the roadmap." },
};
export function mechanismOf(a: Pick<Agent, "adapter">): Mechanism {
  switch (a.adapter) {
    case "claude":
    case "codex":
    case "gemini":
    case "copilot":
    case "cursor":
    case "windsurf":
    case "cline":
    case "opencode":
    case "droid":
    case "kiro":
    case "auggie":
      return "hooks";
    case "sdk-py":
    case "sdk-ts":
    case "adk":
      return "sdk";
    case "mcp":
    case "cloud":
      return "gateway";
    case "runtime":
      return "runtime";
    default:
      return "connector";
  }
}
/* Governance honesty: only agents with a verified enforcement mechanism today get a real
   connect flow. Connector-only platforms appear in the inventory with a roadmap badge. */
export const enforcementOf = (a: Pick<Agent, "adapter">): "connectable" | "roadmap" => (mechanismOf(a) === "connector" ? "roadmap" : "connectable");
export const PLANNED_MECHANISM: Partial<Record<Adapter, string>> = {
  connector: "Custom connector / API proxy + evidence export",
  browser: "Controlled executor + semantic action gate",
  a2a: "A2A gateway + attenuated delegation tokens",
};

/* ================= Product taxonomy =================
   What the buyer recognises. Coding merges the engine's ide/cli/cloud classes into one
   product family; every product maps to the engine CategoryId(s) it governs, so the
   evaluator's category model stays untouched. Used by onboarding, Agents and Overview. */
export interface ProductCat {
  id: string;
  name: string;
  sub: string;
  cats: CategoryId[];
  enforcement: "connectable" | "roadmap";
  mechanism?: string;
}
export const PRODUCT_CATS: ProductCat[] = [
  { id: "coding", name: "Coding agents", sub: "Agents that read, write, test and ship code — in the IDE, the terminal or a hosted runner", cats: ["ide", "cli", "cloud"], enforcement: "connectable" },
  { id: "custom", name: "Custom AI agents", sub: "Agents your company builds on a framework or SDK", cats: ["custom"], enforcement: "connectable" },
  { id: "mcp", name: "MCP tools & servers", sub: "Tools and data your agents reach through MCP", cats: ["mcp"], enforcement: "connectable" },
  { id: "enterprise", name: "Enterprise AI agents", sub: "Agents that live inside business platforms", cats: ["saas"], enforcement: "roadmap", mechanism: "Custom connector / API proxy" },
  { id: "browser", name: "Browser & computer agents", sub: "Agents that browse, click, type and operate apps", cats: ["browser"], enforcement: "roadmap", mechanism: "Controlled executor + semantic action gate" },
  { id: "a2a", name: "Agent-to-agent systems", sub: "Agents that delegate to or call other agents", cats: ["a2a"], enforcement: "roadmap", mechanism: "A2A gateway + attenuated delegation tokens" },
  { id: "other", name: "Other agent systems", sub: "Internal or emerging agent systems", cats: [], enforcement: "roadmap", mechanism: "Inventory only" },
];
export const productOf = (c: CategoryId) => PRODUCT_CATS.find((p) => p.cats.includes(c))!;

export interface Category {
  id: CategoryId;
  n: number;
  name: string;
  plain: string;
  method: string;
  timing: "NOW" | "NEXT" | "LATER";
  why: string;
  scenario: string;
}

export interface Method {
  id: string;
  name: string;
  assurance: Assurance;
  desc: string;
  recommended?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  vendor: string;
  category: CategoryId;
  logo: string;
  bleed?: boolean;
  adapter: Adapter;
  surface: Surface;
  file: string;
  fileNote: string;
  lang: "json" | "ts" | "py" | "yaml" | "bash" | "toml";
  snippet: string;
  install: string;
  hookEvents: string[];
  docs: string;
  scenario?: string;
  /** Where this product runs. One config covers every surface listed here. */
  surfaces?: string[];
  connected: boolean;
  owner: string;
  env: string;
}

export const ASSURANCE: Record<Assurance, { rank: number; label: string; desc: string }> = {
  "observe-only": { rank: 1, label: "Observe-only", desc: "Wrapbox sees actions but cannot stop them." },
  "hook-enforced": {
    rank: 2,
    label: "Hook-enforced",
    desc: "The agent's official pre-execution hook asks Wrapbox first. Strong UX; only as strong as the host's hook.",
  },
  "gateway-enforced": {
    rank: 3,
    label: "Gateway-enforced",
    desc: "Traffic must pass through the Wrapbox MCP / API gateway. Bypass requires a different network path.",
  },
  "endpoint-enforced": {
    rank: 4,
    label: "Endpoint-enforced",
    desc: "Wrapbox runtime mediates file, process and network primitives below the agent.",
  },
  "resource-verified": {
    rank: 5,
    label: "Resource-verified",
    desc: "The target service itself verifies a signed permit. Skipping every hook still cannot execute.",
  },
};

export const CATEGORIES: Category[] = [
  {
    id: "ide",
    n: 1,
    name: "Coding agents · IDE",
    plain: "An AI agent inside a code editor that can read files, edit code, run the terminal and call tools.",
    method: "Official hooks + endpoint runtime",
    timing: "NOW",
    why: "Sits next to source code, local credentials and the developer's terminal.",
    scenario: "ide",
  },
  {
    id: "cli",
    n: 2,
    name: "Coding agents · CLI",
    plain: "A coding agent that lives in the terminal, next to shell, Git and cloud CLIs.",
    method: "Pre-tool hook + process gate",
    timing: "NOW",
    why: "Highest local privilege. One wrong instruction becomes a real kubectl or rm.",
    scenario: "cli",
  },
  {
    id: "cloud",
    n: 3,
    name: "Coding agents · cloud",
    plain: "Agents that work unattended in a hosted runner and open pull requests while nobody watches each step.",
    method: "MCP/API gateway + task-scoped identity",
    timing: "NEXT",
    why: "Unattended execution with repo tokens and tools. Separate code autonomy from production authority.",
    scenario: "cloud",
  },
  {
    id: "custom",
    n: 4,
    name: "Custom AI agents",
    plain: "Agents your company builds itself — claims, procurement, IT access — on an agent framework or SDK.",
    method: "Wrapbox SDK + service-side permit",
    timing: "NOW",
    why: "You own the code, so Wrapbox can be the mandatory call before every executor.",
    scenario: "custom",
  },
  {
    id: "mcp",
    n: 5,
    name: "MCP tools & servers",
    plain: "MCP is how agents call tools. Point every client at Wrapbox and it forwards only approved calls.",
    method: "Wrapbox MCP Gateway",
    timing: "NOW",
    why: "One chokepoint covers many agents and many tools — Stripe, GitHub, databases, internal servers.",
    scenario: "mcp-stripe",
  },
  {
    id: "saas",
    n: 6,
    name: "Enterprise AI agents",
    plain: "Agents built inside business platforms that update CRM records, issue credits and message customers.",
    method: "Custom connector / API proxy",
    timing: "NEXT",
    why: "Platforms govern themselves. Wrapbox brings one policy across all of them.",
    scenario: "saas",
  },
  {
    id: "browser",
    n: 7,
    name: "Browser & computer agents",
    plain: "Agents that click, type and submit forms in a real browser, often with a human's logged-in session.",
    method: "Controlled executor + semantic actions",
    timing: "NEXT",
    why: "A hidden line on a web page can turn into a real transfer unless the final click is authorized.",
    scenario: "browser",
  },
  {
    id: "a2a",
    n: 8,
    name: "Agent-to-agent systems",
    plain: "Agents that delegate work to other agents. The question is how much authority travels with the task.",
    method: "Delegation SDK + attenuated tokens",
    timing: "LATER",
    why: "A child agent must never receive more authority than its parent granted.",
    scenario: "a2a",
  },
];

export const METHODS: Record<CategoryId, Method[]> = {
  ide: [
    { id: "hook", name: "Official agent hooks", assurance: "hook-enforced", desc: "Commit a hooks file to the repo or push it via MDM. Fastest to roll out.", recommended: true },
    { id: "runtime", name: "Hooks + endpoint runtime", assurance: "endpoint-enforced", desc: "Also mediates file/process/network below the agent — catches python reading .env." },
    { id: "mcp", name: "MCP gateway only", assurance: "gateway-enforced", desc: "Route the IDE's MCP tools through Wrapbox. Doesn't cover local shell." },
  ],
  cli: [
    { id: "hook", name: "Pre-tool hook adapter", assurance: "hook-enforced", desc: "Managed hook fires before every tool call, including MCP and subagents.", recommended: true },
    { id: "runtime", name: "Hook + process/filesystem gate", assurance: "endpoint-enforced", desc: "Host-independent backstop for indirect commands." },
    { id: "launcher", name: "Enterprise launcher", assurance: "hook-enforced", desc: "Injects identity, workspace and managed policy at launch." },
  ],
  cloud: [
    { id: "gateway", name: "MCP / API gateway + task identity", assurance: "gateway-enforced", desc: "All tool egress of the hosted runner goes through Wrapbox with a task-scoped token.", recommended: true },
    { id: "app", name: "GitHub App + status checks", assurance: "observe-only", desc: "Attaches decisions and evidence to every PR." },
  ],
  custom: [
    { id: "sdk", name: "Wrapbox SDK guard", assurance: "hook-enforced", desc: "Wrap each tool executor. Richest context, best developer experience." },
    { id: "verified", name: "SDK + service-side permit", assurance: "resource-verified", desc: "The payment/API service verifies the permit. Bypassing the SDK grants nothing.", recommended: true },
    { id: "gateway", name: "API gateway", assurance: "gateway-enforced", desc: "Route outbound tool calls through a Wrapbox sidecar." },
  ],
  mcp: [
    { id: "gateway", name: "Wrapbox MCP Gateway", assurance: "gateway-enforced", desc: "Clients point at mcp.wrapbox.ai. Approved calls are forwarded to the real server.", recommended: true },
    { id: "middleware", name: "Server middleware", assurance: "resource-verified", desc: "If you own the MCP server, verify permits inside each tool handler." },
  ],
  saas: [
    { id: "connector", name: "Custom connector / action", assurance: "gateway-enforced", desc: "The platform's agent calls Wrapbox-authorized actions.", recommended: true },
    { id: "export", name: "Evidence export only", assurance: "observe-only", desc: "Mirror platform decisions into Wrapbox, SIEM and GRC." },
  ],
  browser: [
    { id: "executor", name: "Controlled executor", assurance: "endpoint-enforced", desc: "Every consequential click is re-normalized and authorized before dispatch.", recommended: true },
    { id: "wrapper", name: "Action wrapper", assurance: "hook-enforced", desc: "Wrap the framework's action registry." },
  ],
  a2a: [
    { id: "delegation", name: "Delegation SDK + A2A gateway", assurance: "gateway-enforced", desc: "Authority is attenuated on every handoff and the root human is always recoverable.", recommended: true },
  ],
};

const ORG = "wrapbox";

export const AGENTS: Agent[] = [
  // 1 · IDE
  {
    id: "cursor",
    name: "Cursor Agent",
    surfaces: ["Cursor IDE", "Cursor CLI"],
    vendor: "Anysphere",
    category: "ide",
    logo: "cursor",
    adapter: "cursor",
    surface: "ide",
    file: ".cursor/hooks.json",
    fileNote: "Commit to the repo, or distribute via Cursor Team dashboard / MDM",
    lang: "json",
    install: `npx @wrapbox/cli install cursor --org ${ORG}`,
    hookEvents: ["preToolUse", "beforeReadFile", "beforeShellExecution", "beforeMCPExecution"],
    docs: "cursor.com/docs/hooks",
    snippet: `{
  "version": 1,
  "hooks": {
    "preToolUse":           [{ "command": "wrapbox hook cursor", "failClosed": true }],
    "beforeReadFile":       [{ "command": "wrapbox hook cursor", "failClosed": true }],
    "beforeShellExecution": [{ "command": "wrapbox hook cursor", "failClosed": true }],
    "beforeMCPExecution":   [{ "command": "wrapbox hook cursor", "failClosed": true }]
  }
}`,
    connected: true,
    owner: "Platform team",
    env: "dev workstations",
  },
  {
    id: "copilot-ide",
    name: "GitHub Copilot agent mode",
    surfaces: ["VS Code", "JetBrains", "Visual Studio", "Xcode", "Eclipse"],
    vendor: "GitHub · VS Code",
    category: "ide",
    logo: "githubcopilot",
    adapter: "copilot",
    surface: "ide",
    file: ".github/hooks/wrapbox.json",
    fileNote: "Picked up by Copilot agent mode in VS Code and by Copilot CLI",
    lang: "json",
    install: `npx @wrapbox/cli install copilot --org ${ORG}`,
    hookEvents: ["preToolUse", "postToolUse"],
    docs: "docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks",
    snippet: `{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "wrapbox hook copilot",
        "powershell": "wrapbox.exe hook copilot",
        "timeoutSec": 10
      }
    ]
  }
}`,
    connected: true,
    owner: "Platform team",
    env: "dev workstations",
  },
  {
    id: "junie",
    name: "JetBrains Junie",
    vendor: "JetBrains",
    category: "ide",
    logo: "junie",
    adapter: "runtime",
    surface: "ide",
    file: ".junie/mcp/mcp.json",
    fileNote: "Junie tools via the MCP gateway; local effects via the Wrapbox endpoint runtime",
    lang: "json",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --ide jetbrains --org ${ORG}`,
    hookEvents: ["file.open", "process.spawn", "net.connect", "tools/call"],
    docs: "jetbrains.com/help/junie/model-context-protocol-mcp.html",
    snippet: `{
  "mcpServers": {
    "wrapbox-gateway": {
      "url": "https://mcp.wrapbox.ai",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    connected: false,
    owner: "Platform team",
    env: "dev workstations",
  },
  // 2 · CLI
  {
    id: "claude-code",
    name: "Claude Code",
    surfaces: ["Terminal", "VS Code", "JetBrains", "Desktop app", "Claude Code on the web", "GitHub Actions"],
    vendor: "Anthropic",
    category: "cli",
    logo: "claudecode",
    adapter: "claude",
    surface: "terminal",
    file: ".claude/settings.json",
    fileNote: "Commit to the repo, or push org-wide as managed settings. Fires before every tool call — including MCP tools and subagents. An HTTP hook that times out fails open, so pair high-risk actions with the MCP gateway or a service-side permit.",
    lang: "json",
    install: `npx @wrapbox/cli install claude-code --org ${ORG}`,
    hookEvents: ["PreToolUse", "UserPromptSubmit", "PostToolUse", "SessionStart"],
    docs: "code.claude.com/docs/en/hooks",
    snippet: `{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "https://api.wrapbox.ai/v1/check",
        "headers": { "Authorization": "Bearer $WRAPBOX_TOKEN" },
        "allowedEnvVars": ["WRAPBOX_TOKEN"],
        "timeout": 5
      }]
    }]
  }
}

// Wrapbox returns, to deny:
// {
//   "hookSpecificOutput": {
//     "hookEventName": "PreToolUse",
//     "permissionDecision": "deny",
//     "permissionDecisionReason": "wrapbox: secrets are never read autonomously (rule secrets.read)"
//   }
// }`,
    connected: true,
    owner: "Platform team",
    env: "dev workstations",
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    surfaces: ["Terminal", "Codex IDE extension (VS Code, Cursor, Windsurf)", "Codex desktop app"],
    vendor: "OpenAI",
    category: "cli",
    logo: "codex",
    adapter: "codex",
    surface: "terminal",
    file: "~/.codex/hooks.json",
    fileNote: "Per-user, or shipped by the Wrapbox installer on every laptop",
    lang: "json",
    install: `npx @wrapbox/cli install codex --org ${ORG}`,
    hookEvents: ["PreToolUse", "PostToolUse", "SessionStart"],
    docs: "developers.openai.com/codex/hooks",
    snippet: `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "wrapbox hook codex", "timeout": 15 }]
      }
    ]
  }
}`,
    connected: true,
    owner: "Platform team",
    env: "dev workstations",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    surfaces: ["Terminal", "Gemini Code Assist agent mode (VS Code, JetBrains)", "GitHub Actions (run-gemini-cli)"],
    vendor: "Google",
    category: "cli",
    logo: "geminicli",
    adapter: "gemini",
    surface: "terminal",
    file: ".gemini/settings.json",
    fileNote: "Project or user settings; BeforeTool matches built-in and MCP tools",
    lang: "json",
    install: `npx @wrapbox/cli install gemini --org ${ORG}`,
    hookEvents: ["BeforeTool", "AfterTool"],
    docs: "geminicli.com/docs/hooks",
    snippet: `{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "wrapbox hook gemini", "timeout": 5000 }]
      }
    ]
  }
}`,
    connected: false,
    owner: "Platform team",
    env: "dev workstations",
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    surfaces: ["Terminal", "GitHub Actions"],
    vendor: "GitHub",
    category: "cli",
    logo: "githubcopilot",
    adapter: "copilot",
    surface: "terminal",
    file: ".github/hooks/wrapbox.json",
    fileNote: "Same file as Copilot agent mode — one install covers both",
    lang: "json",
    install: `npx @wrapbox/cli install copilot --org ${ORG}`,
    hookEvents: ["preToolUse", "postToolUse", "sessionStart"],
    docs: "docs.github.com/copilot/how-tos/copilot-cli",
    snippet: `{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "type": "command", "bash": "wrapbox hook copilot", "timeoutSec": 10 }
    ]
  }
}`,
    connected: false,
    owner: "Platform team",
    env: "dev workstations",
  },
  // 3 · Cloud
  {
    id: "copilot-cloud",
    name: "Copilot cloud agent",
    surfaces: ["github.com (assign an issue)", "Agents panel", "VS Code delegate", "Copilot in Slack / Teams"],
    vendor: "GitHub",
    category: "cloud",
    logo: "githubcopilot",
    adapter: "cloud",
    surface: "github",
    file: "Repo → Settings → Copilot → Coding agent → MCP configuration",
    fileNote: "Secrets prefixed COPILOT_MCP_ are injected into the ephemeral runner only",
    lang: "json",
    install: `gh extension install wrapbox/gh-wrapbox && gh wrapbox connect --repo wrapbox/billing`,
    hookEvents: ["tools/call", "git push", "check_run"],
    docs: "docs.github.com/copilot/concepts/coding-agent",
    snippet: `{
  "mcpServers": {
    "wrapbox": {
      "type": "http",
      "url": "https://mcp.wrapbox.ai",
      "headers": { "Authorization": "Bearer $COPILOT_MCP_WRAPBOX_TOKEN" },
      "tools": ["*"]
    }
  }
}`,
    connected: true,
    owner: "Billing squad",
    env: "ephemeral runner",
  },
  {
    id: "codex-cloud",
    name: "Codex cloud tasks",
    surfaces: ["chatgpt.com/codex", "Codex code review on GitHub", "Codex in Slack", "Codex in the ChatGPT app"],
    vendor: "OpenAI",
    category: "cloud",
    logo: "codex",
    adapter: "cloud",
    surface: "github",
    file: "Codex → Environments → Setup script",
    fileNote: "Task-scoped token expires with the task; egress goes through Wrapbox",
    lang: "bash",
    install: `wrapbox tokens create --task-scoped --for codex-cloud`,
    hookEvents: ["PreToolUse", "egress", "tools/call"],
    docs: "developers.openai.com/codex/cloud",
    snippet: `# Codex cloud → Environment → Setup script
npm i -g @wrapbox/cli
wrapbox login --task-token "$WRAPBOX_TASK_TOKEN"   # expires with the task
wrapbox install codex --egress-via https://egress.wrapbox.ai`,
    connected: false,
    owner: "Billing squad",
    env: "ephemeral runner",
  },
  // 4 · Custom
  {
    id: "langgraph",
    name: "LangGraph claims agent",
    vendor: "LangChain",
    category: "custom",
    logo: "langgraph",
    adapter: "sdk-ts",
    surface: "graph",
    file: "src/claims/graph.ts",
    fileNote: "REVIEW decisions surface as a LangGraph interrupt() and resume on approval",
    lang: "ts",
    install: `npm i @wrapbox/sdk`,
    hookEvents: ["guard()", "interrupt", "resume"],
    docs: "langchain-ai.github.io/langgraph/concepts/human_in_the_loop",
    snippet: `import { wrapbox } from "@wrapbox/sdk";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// Every call is checked against wrapbox.yaml before it executes.
const payClaim = wrapbox.guard("claims.payout", async (args) => {
  return paymentService.pay(args, { permit: args.permit }); // service verifies
});

export const tools = new ToolNode([payClaim, fetchPolicy, readClaimDocs]);`,
    connected: true,
    owner: "Claims engineering",
    env: "production",
  },
  {
    id: "openai-agents",
    name: "OpenAI Agents SDK",
    vendor: "OpenAI",
    category: "custom",
    logo: "openai",
    adapter: "sdk-py",
    surface: "graph",
    file: "agents/claims.py",
    fileNote: "Decorate the function tool; the executor runs only with a valid permit",
    lang: "py",
    install: `pip install wrapbox`,
    hookEvents: ["@guard", "tool_input_guardrail"],
    docs: "openai.github.io/openai-agents-python/guardrails",
    snippet: `from agents import Agent, function_tool
from wrapbox import guard

@function_tool
@guard("claims.payout", resource=lambda a: f"claim:{a['claim_id']}")
def pay_claim(claim_id: str, amount: int) -> str:
    return payments.pay(claim_id, amount)   # runs only with a valid permit

claims_agent = Agent(name="claims-agent-prod", tools=[pay_claim])`,
    connected: false,
    owner: "Claims engineering",
    env: "production",
  },
  {
    id: "google-adk",
    name: "Google ADK",
    vendor: "Google",
    category: "custom",
    logo: "gemini",
    adapter: "adk",
    surface: "graph",
    file: "procurement/agent.py",
    fileNote: "ADK's before_tool_callback returns Wrapbox's decision",
    lang: "py",
    install: `pip install "wrapbox[adk]"`,
    hookEvents: ["before_tool_callback"],
    docs: "google.github.io/adk-docs/callbacks",
    snippet: `from google.adk.agents import Agent
from wrapbox.adk import before_tool_callback

agent = Agent(
    name="claims-agent-prod",
    model="gemini-2.5-pro",
    tools=[pay_claim, fetch_policy],
    before_tool_callback=before_tool_callback(org="${ORG}"),  # ALLOW / REVIEW / BLOCK
)`,
    connected: false,
    owner: "Procurement",
    env: "production",
  },
  // 5 · MCP
  {
    id: "stripe-mcp",
    name: "Stripe MCP",
    vendor: "Stripe",
    category: "mcp",
    logo: "stripe",
    adapter: "mcp",
    surface: "chat",
    file: "mcp.json",
    fileNote: "Replace https://mcp.stripe.com with the Wrapbox URL — works in any MCP client",
    lang: "json",
    install: `wrapbox mcp add stripe --upstream https://mcp.stripe.com`,
    hookEvents: ["tools/call", "tools/list"],
    docs: "modelcontextprotocol.io/specification",
    scenario: "mcp-stripe",
    snippet: `{
  "mcpServers": {
    "stripe": {
      "url": "https://mcp.wrapbox.ai/stripe",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    connected: true,
    owner: "Payments",
    env: "production",
  },
  {
    id: "github-mcp",
    name: "GitHub MCP server",
    vendor: "GitHub",
    category: "mcp",
    logo: "github_light",
    adapter: "mcp",
    surface: "chat",
    file: "mcp.json",
    fileNote: "Replace api.githubcopilot.com/mcp with the Wrapbox URL",
    lang: "json",
    install: `wrapbox mcp add github --upstream https://api.githubcopilot.com/mcp/`,
    hookEvents: ["tools/call"],
    docs: "github.com/github/github-mcp-server",
    scenario: "mcp-github",
    snippet: `{
  "mcpServers": {
    "github": {
      "url": "https://mcp.wrapbox.ai/github",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    connected: true,
    owner: "Platform team",
    env: "production",
  },
  {
    id: "postgres-mcp",
    name: "Postgres MCP",
    vendor: "PostgreSQL",
    category: "mcp",
    logo: "postgresql",
    adapter: "mcp",
    surface: "chat",
    file: "mcp.json",
    fileNote: "Postgres MCP Pro behind Wrapbox · SQL is classified (SELECT / DML / DDL) and PII columns masked",
    lang: "json",
    install: `wrapbox mcp add postgres-prod --upstream stdio:"postgres-mcp --access-mode=unrestricted"`,
    hookEvents: ["tools/call"],
    docs: "github.com/crystaldba/postgres-mcp",
    scenario: "mcp-postgres",
    snippet: `{
  "mcpServers": {
    "postgres-prod": {
      "url": "https://mcp.wrapbox.ai/postgres-prod",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    connected: true,
    owner: "Data platform",
    env: "production",
  },
  {
    id: "razorpay-mcp",
    name: "Razorpay MCP",
    vendor: "Razorpay",
    category: "mcp",
    logo: "razorpay",
    adapter: "mcp",
    surface: "chat",
    file: "mcp.json",
    fileNote: "Payment gateway wrapped as an MCP server behind Wrapbox",
    lang: "json",
    install: `wrapbox mcp add razorpay --upstream https://mcp.razorpay.com/mcp`,
    hookEvents: ["tools/call"],
    docs: "razorpay.com/docs/mcp-server",
    scenario: "mcp-razorpay",
    snippet: `{
  "mcpServers": {
    "razorpay": {
      "url": "https://mcp.wrapbox.ai/razorpay",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    connected: false,
    owner: "Payments",
    env: "production",
  },
  // 6 · SaaS
  {
    id: "agentforce",
    name: "Salesforce Agentforce",
    vendor: "Salesforce",
    category: "saas",
    logo: "salesforce",
    adapter: "connector",
    surface: "crm",
    file: "Setup → Named Credential + Agent Action",
    fileNote: "Agentforce calls the Wrapbox-authorized action instead of writing directly",
    lang: "yaml",
    install: `wrapbox connectors add salesforce --org ${ORG}`,
    hookEvents: ["Agent Action", "External Service"],
    docs: "help.salesforce.com — Agentforce actions",
    snippet: `# Setup → Named Credentials → New
named_credential:
  label: Wrapbox
  url: https://api.wrapbox.ai/v1
  header: "Authorization: Bearer {!$Credential.Wrapbox.token}"

# Agentforce Builder → Topic: Renewals → Add Action
agent_action:
  type: external_service
  service: Wrapbox.authorize_and_execute
  effect: crm.apply_discount      # answers ALLOW / REVIEW / BLOCK`,
    connected: true,
    owner: "Revenue ops",
    env: "production",
  },
  {
    id: "copilot-studio",
    name: "Microsoft Copilot Studio",
    vendor: "Microsoft",
    category: "saas",
    logo: "copilotstudio",
    adapter: "connector",
    surface: "crm",
    file: "wrapbox-connector.swagger.yaml",
    fileNote: "Import as a custom connector; add the actions as agent tools",
    lang: "yaml",
    install: `wrapbox connectors export --format power-platform > wrapbox-connector.swagger.yaml`,
    hookEvents: ["Custom connector action"],
    docs: "learn.microsoft.com/microsoft-copilot-studio",
    snippet: `swagger: "2.0"
info: { title: Wrapbox Authorized Actions, version: "1.0" }
host: api.wrapbox.ai
basePath: /v1/actions
securityDefinitions:
  wrapbox: { type: apiKey, in: header, name: Authorization }
paths:
  /crm.apply_discount:
    post:
      operationId: ApplyDiscount
      summary: Apply a renewal discount (Wrapbox-authorized)`,
    connected: false,
    owner: "Revenue ops",
    env: "production",
  },
  {
    id: "servicenow",
    name: "ServiceNow AI Agents",
    vendor: "ServiceNow",
    category: "saas",
    logo: "servicenow",
    bleed: true,
    adapter: "connector",
    surface: "crm",
    file: "IntegrationHub → REST step",
    fileNote: "Consequential flow actions call Wrapbox first",
    lang: "yaml",
    install: `wrapbox connectors add servicenow --instance wrapbox.service-now.com`,
    hookEvents: ["Flow action", "REST step"],
    docs: "servicenow.com/docs — AI Agent Studio",
    snippet: `# Flow Designer → Action → REST step
endpoint: https://api.wrapbox.ai/v1/actions/{effect}
method: POST
auth: Connection alias "Wrapbox" (Bearer)
body:
  effect: itsm.grant_access
  subject_agent: \${agent.sys_id}
  on_behalf_of: \${requested_for.email}`,
    connected: false,
    owner: "IT",
    env: "production",
  },
  {
    id: "zapier",
    name: "Zapier Agents",
    vendor: "Zapier",
    category: "saas",
    logo: "zapier",
    adapter: "connector",
    surface: "crm",
    file: "Zap step · Webhooks by Zapier (POST)",
    fileNote: "Add as the step before any consequential action; continue only on ALLOW",
    lang: "json",
    install: `wrapbox connectors add zapier`,
    hookEvents: ["authorize step", "Paths"],
    docs: "zapier.com/apps/webhook",
    snippet: `{
  "action": "Webhooks by Zapier · POST",
  "url": "https://api.wrapbox.ai/v1/authorize",
  "headers": { "Authorization": "Bearer {{WRAPBOX_TOKEN}}" },
  "data": {
    "effect": "crm.apply_discount",
    "subject_agent": "zapier-renewals-agent",
    "args": "{{previous_step.output}}"
  },
  "next": "Paths → continue only when decision == ALLOW"
}`,
    connected: false,
    owner: "Ops",
    env: "production",
  },
  // 7 · Browser
  {
    id: "browser-use",
    name: "Browser Use",
    vendor: "Browser Use",
    category: "browser",
    logo: "browseruse",
    bleed: true,
    adapter: "browser",
    surface: "browser",
    file: "ap_agent.py",
    fileNote: "Wraps click, input, upload and submit before they reach the page",
    lang: "py",
    install: `pip install "wrapbox[browser-use]"`,
    hookEvents: ["click", "input", "upload", "submit"],
    docs: "docs.browser-use.com/customize/tools",
    snippet: `from browser_use import Agent, Tools
from wrapbox.browser_use import guard_actions

tools = guard_actions(Tools(), org="${ORG}")    # semantic: payment.submit, email.send
agent = Agent(task="Pay invoice INV-2291 on the vendor portal", llm=llm, tools=tools)
await agent.run()`,
    connected: true,
    owner: "Finance ops",
    env: "production",
  },
  {
    id: "computer-use",
    name: "Claude Computer Use",
    vendor: "Anthropic",
    category: "browser",
    logo: "claude",
    adapter: "browser",
    surface: "browser",
    file: "executor.py",
    fileNote: "The app that executes computer-use tool calls asks Wrapbox first",
    lang: "py",
    install: `pip install "wrapbox[computer]"`,
    hookEvents: ["computer tool_use"],
    docs: "docs.claude.com — computer use tool",
    snippet: `from wrapbox.computer import ControlledExecutor

executor = ControlledExecutor(org="${ORG}", semantic_actions={
    "Submit payment": "payment.submit",
    "Send": "email.send",
})
result = executor.run(tool_use_block)   # consequential clicks need a permit`,
    connected: false,
    owner: "Finance ops",
    env: "sandbox VM",
  },
  {
    id: "playwright",
    name: "Playwright agents",
    vendor: "Microsoft",
    category: "browser",
    logo: "playwright",
    adapter: "browser",
    surface: "browser",
    file: "pay.spec.ts",
    fileNote: "guardPage() authorizes semantic actions before dispatching the click",
    lang: "ts",
    install: `npm i @wrapbox/playwright`,
    hookEvents: ["page.click", "page.fill"],
    docs: "playwright.dev",
    snippet: `import { chromium } from "playwright";
import { guardPage } from "@wrapbox/playwright";

const page = guardPage(await (await chromium.launch()).newPage(), { org: "${ORG}" });
await page.getByRole("button", { name: "Submit payment" }).click();
// → payment.submit {amount, payee, origin} is authorized before the click`,
    connected: false,
    owner: "QA",
    env: "CI",
  },
  // 8 · A2A
  {
    id: "openai-handoffs",
    name: "OpenAI handoffs",
    vendor: "OpenAI",
    category: "a2a",
    logo: "openai",
    adapter: "a2a",
    surface: "delegation",
    file: "ops/supervisor.py",
    fileNote: "delegate() attaches an attenuated capability token to the handoff",
    lang: "py",
    install: `pip install wrapbox`,
    hookEvents: ["handoff", "tool call"],
    docs: "openai.github.io/openai-agents-python/handoffs",
    snippet: `from agents import Agent
from wrapbox import delegate

purchasing = Agent(name="purchasing-subagent", tools=[place_order])
supervisor = Agent(
    name="ops-supervisor",
    handoffs=[delegate(purchasing, budget_usd=10_000, ttl="30m", tools=["place_order"])],
)   # the child can never exceed what the parent granted`,
    connected: true,
    owner: "Ops",
    env: "production",
  },
  {
    id: "a2a",
    name: "A2A protocol peers",
    vendor: "Linux Foundation A2A",
    category: "a2a",
    logo: "a2a",
    bleed: true,
    adapter: "a2a",
    surface: "delegation",
    file: ".well-known/agent-card.json",
    fileNote: "Publish the peer's Agent Card at the Wrapbox A2A gateway URL",
    lang: "json",
    install: `wrapbox a2a register vendor-quotes --card https://vendor.example/.well-known/agent-card.json`,
    hookEvents: ["message/send", "tasks/get"],
    docs: "a2a-protocol.org",
    snippet: `{
  "name": "vendor-quotes-agent",
  "url": "https://a2a.wrapbox.ai/vendor-quotes",
  "capabilities": { "streaming": true },
  "securitySchemes": { "wrapbox": { "type": "http", "scheme": "bearer" } },
  "x-wrapbox": { "attenuate": true, "max_budget_usd": 10000, "delegation_ttl": "30m" }
}`,
    surfaces: ["Google ADK", "LangGraph", "CrewAI", "Microsoft Agent Framework", "AutoGen"],
    connected: false,
    owner: "Ops",
    env: "production",
  },

  /* ================= Catalog expansion =================
     Formats below follow each vendor's published hook / plugin / SDK docs. Agents with a
     native pre-tool hook use their own wire format (see nativeFor); agents without one
     connect through the MCP gateway (any MCP client) or the endpoint runtime; hosted
     platforms with no hook and no SDK are listed honestly as roadmap. */

  // ---- Coding · IDE ----
  {
    id: "windsurf",
    name: "Windsurf Cascade",
    vendor: "Cognition (Windsurf)",
    category: "ide",
    logo: "windsurf",
    adapter: "windsurf",
    surface: "ide",
    file: ".windsurf/hooks.json",
    fileNote: "Workspace hooks. User level: ~/.codeium/windsurf/hooks.json. System level via MDM: /Library/Application Support/Windsurf/hooks.json. Pre-hooks block with exit code 2; the stderr line is shown to Cascade.",
    lang: "json",
    install: `npx @wrapbox/cli install windsurf --org ${ORG}`,
    hookEvents: ["pre_run_command", "pre_mcp_tool_use", "pre_read_code", "pre_write_code"],
    docs: "docs.windsurf.com/windsurf/cascade/hooks",
    snippet: `{
  "hooks": {
    "pre_run_command":  [{ "command": "wrapbox hook windsurf", "show_output": true }],
    "pre_mcp_tool_use": [{ "command": "wrapbox hook windsurf", "show_output": true }],
    "pre_read_code":    [{ "command": "wrapbox hook windsurf" }],
    "pre_write_code":   [{ "command": "wrapbox hook windsurf" }]
  }
}`,
    surfaces: ["Windsurf editor", "Windsurf JetBrains plugin"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "cline",
    name: "Cline",
    vendor: "Cline",
    category: "ide",
    logo: "cline",
    adapter: "cline",
    surface: "ide",
    file: ".clinerules/hooks/PreToolUse",
    fileNote: "An executable named exactly after the event, no extension. Global: ~/Documents/Cline/Rules/Hooks/. Cline pipes the tool call in as JSON and reads {cancel, errorMessage} back.",
    lang: "bash",
    install: `npx @wrapbox/cli install cline --org ${ORG}`,
    hookEvents: ["PreToolUse", "PostToolUse", "UserPromptSubmit", "TaskStart"],
    docs: "docs.cline.bot/customization/hooks",
    snippet: `#!/usr/bin/env bash
# .clinerules/hooks/PreToolUse  (chmod +x)
# Cline sends {"hookName":"PreToolUse","toolName":"execute_command","toolInput":{...}} on stdin.
exec wrapbox hook cline

# Wrapbox answers on stdout, for example:
# {"cancel": true, "errorMessage": "wrapbox: secrets are never read autonomously (rule secrets.read)"}`,
    surfaces: ["VS Code", "JetBrains", "Cline CLI"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    vendor: "Google",
    category: "ide",
    logo: "antigravity",
    adapter: "runtime",
    surface: "ide",
    file: "mcp_config.json",
    fileNote: "Antigravity → Agent panel → MCP servers → raw config. Tool calls go through the gateway; local shell and file effects are covered by the endpoint runtime. A native adapter for Antigravity's harness hooks follows the published spec.",
    lang: "json",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --ide antigravity --org ${ORG}`,
    hookEvents: ["tools/call", "process.spawn", "file.open"],
    docs: "antigravity.google/docs",
    snippet: `{
  "mcpServers": {
    "wrapbox-gateway": {
      "serverUrl": "https://mcp.wrapbox.ai",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    surfaces: ["Antigravity IDE", "Antigravity CLI", "Antigravity extension (VS Code, JetBrains, Zed)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "zed",
    name: "Zed Agent",
    vendor: "Zed Industries",
    category: "ide",
    logo: "zed",
    adapter: "runtime",
    surface: "ide",
    file: ".zed/settings.json",
    fileNote: "Zed's agent reaches tools through context servers (MCP). Point it at the Wrapbox stdio bridge; local effects are covered by the endpoint runtime.",
    lang: "json",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --ide zed --org ${ORG}`,
    hookEvents: ["tools/call", "process.spawn", "file.open"],
    docs: "zed.dev/docs/ai/mcp",
    snippet: `{
  "context_servers": {
    "wrapbox": {
      "source": "custom",
      "command": "wrapbox",
      "args": ["mcp-bridge", "--org", "${ORG}"]
    }
  }
}`,
    surfaces: ["Zed editor", "External agents via ACP (Claude Code, Gemini CLI)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "continue",
    name: "Continue",
    vendor: "Continue",
    category: "ide",
    logo: "continue",
    adapter: "runtime",
    surface: "ide",
    file: ".continue/config.yaml",
    fileNote: "Continue has no pre-tool hook. Its MCP tools route through the gateway; the endpoint runtime covers terminal and file effects.",
    lang: "yaml",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --ide continue --org ${ORG}`,
    hookEvents: ["tools/call", "process.spawn", "file.open"],
    docs: "docs.continue.dev/customize/deep-dives/mcp",
    snippet: `mcpServers:
  - name: wrapbox
    command: wrapbox
    args: ["mcp-bridge", "--org", "${ORG}"]`,
    surfaces: ["VS Code", "JetBrains", "Continue CLI (cn)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "roocode",
    name: "Roo Code",
    vendor: "Roo Code",
    category: "ide",
    logo: "roocode",
    adapter: "runtime",
    surface: "ide",
    file: ".roo/mcp.json",
    fileNote: "Roo Code has no pre-tool hook. Its MCP tools route through the gateway; the endpoint runtime covers terminal and file effects.",
    lang: "json",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --ide roocode --org ${ORG}`,
    hookEvents: ["tools/call", "process.spawn", "file.open"],
    docs: "docs.roocode.com/features/mcp/using-mcp-in-roo",
    snippet: `{
  "mcpServers": {
    "wrapbox": { "command": "wrapbox", "args": ["mcp-bridge", "--org", "${ORG}"] }
  }
}`,
    surfaces: ["VS Code"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },

  // ---- Coding · CLI ----
  {
    id: "kiro-cli",
    name: "Kiro CLI",
    vendor: "AWS",
    category: "cli",
    logo: "kiro",
    adapter: "kiro",
    surface: "terminal",
    file: ".kiro/agents/default.json",
    fileNote: "Kiro agent config — workspace .kiro/agents/ or global ~/.kiro/agents/. Matchers use Kiro's internal tool names. Exit code 2 blocks and hands stderr back to the model.",
    lang: "json",
    install: `npx @wrapbox/cli install kiro --org ${ORG}`,
    hookEvents: ["preToolUse", "postToolUse", "agentSpawn", "userPromptSubmit"],
    docs: "kiro.dev/docs/cli/hooks",
    snippet: `{
  "name": "default",
  "hooks": {
    "preToolUse": [
      { "matcher": "execute_bash", "command": "wrapbox hook kiro" },
      { "matcher": "fs_write",     "command": "wrapbox hook kiro" },
      { "matcher": "fs_read",      "command": "wrapbox hook kiro" },
      { "matcher": "use_aws",      "command": "wrapbox hook kiro" }
    ]
  }
}`,
    surfaces: ["Kiro CLI", "Kiro IDE (tools via the MCP gateway)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "droid",
    name: "Factory Droid",
    vendor: "Factory",
    category: "cli",
    logo: "factory",
    adapter: "droid",
    surface: "terminal",
    file: ".factory/hooks.json",
    fileNote: "Project hooks; user level ~/.factory/hooks.json (or a hooks key in settings.json). Deny with exit code 2, or permissionDecision: deny on stdout.",
    lang: "json",
    install: `npx @wrapbox/cli install droid --org ${ORG}`,
    hookEvents: ["PreToolUse", "PostToolUse", "SessionStart", "Stop"],
    docs: "docs.factory.ai/cli/configuration/hooks-guide",
    snippet: `{
  "PreToolUse": [
    {
      "matcher": "Execute|Edit|Create|ApplyPatch|Read",
      "hooks": [{ "type": "command", "command": "wrapbox hook droid", "timeout": 10 }]
    }
  ]
}`,
    surfaces: ["Droid CLI", "Droid in VS Code / JetBrains", "droid exec (CI)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    category: "cli",
    logo: "opencode",
    adapter: "opencode",
    surface: "terminal",
    file: ".opencode/plugins/wrapbox.ts",
    fileNote: "Project plugin; global ~/.config/opencode/plugins/. Throwing inside tool.execute.before stops the call; editing output.args rewrites it.",
    lang: "ts",
    install: `npx @wrapbox/cli install opencode --org ${ORG}`,
    hookEvents: ["tool.execute.before", "tool.execute.after"],
    docs: "opencode.ai/docs/plugins",
    snippet: `import type { Plugin } from "@opencode-ai/plugin";
import { check } from "@wrapbox/sdk/opencode";

export const WrapboxPlugin: Plugin = async ({ project }) => ({
  "tool.execute.before": async (input, output) => {
    const v = await check({ tool: input.tool, args: output.args, project: project.id });
    if (v.decision === "BLOCK") throw new Error("wrapbox: " + v.reason + " (rule " + v.rule + ")");
    if (v.rewritten) Object.assign(output.args, v.rewritten);   // e.g. --force → --force-with-lease
  },
});`,
    surfaces: ["OpenCode TUI", "OpenCode desktop", "OpenCode in VS Code"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "auggie",
    name: "Auggie CLI",
    vendor: "Augment Code",
    category: "cli",
    logo: "augment",
    adapter: "auggie",
    surface: "terminal",
    file: "~/.augment/settings.json",
    fileNote: "Global settings. PreToolUse can deny with exit code 2 or permissionDecision: deny, and runs inside sub-agent sessions too.",
    lang: "json",
    install: `npx @wrapbox/cli install auggie --org ${ORG}`,
    hookEvents: ["PreToolUse", "PostToolUse", "SessionStart", "Stop"],
    docs: "docs.augmentcode.com/cli/hooks",
    snippet: `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "wrapbox hook auggie", "timeout": 5000 }]
      }
    ]
  }
}`,
    surfaces: ["Auggie CLI", "Augment in VS Code / JetBrains (endpoint runtime)"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },
  {
    id: "goose",
    name: "Goose",
    vendor: "Block",
    category: "cli",
    logo: "goose",
    adapter: "runtime",
    surface: "terminal",
    file: "~/.config/goose/config.yaml",
    fileNote: "Goose has no pre-tool hook; every tool is an extension (MCP). Add Wrapbox as an extension so tool calls pass the gateway; the endpoint runtime covers shell effects.",
    lang: "yaml",
    install: `brew install wrapbox/tap/wrapbox && wrapbox runtime enable --agent goose --org ${ORG}`,
    hookEvents: ["tools/call", "process.spawn"],
    docs: "block.github.io/goose/docs/getting-started/using-extensions",
    snippet: `extensions:
  wrapbox:
    enabled: true
    type: stdio
    cmd: wrapbox
    args: ["mcp-bridge", "--org", "${ORG}"]`,
    surfaces: ["Goose CLI", "Goose desktop"],
    connected: false,
    owner: "Unassigned",
    env: "dev workstations",
  },

  // ---- Coding · cloud ----
  {
    id: "claude-code-cloud",
    name: "Claude Code on the web & CI",
    vendor: "Anthropic",
    category: "cloud",
    logo: "claudecode",
    adapter: "claude",
    surface: "github",
    file: ".claude/settings.json",
    fileNote: "The same repo settings file the CLI reads. Sessions on the web and the GitHub Action run in a sandbox and honour it — one hooks file covers laptop, web and CI.",
    lang: "json",
    install: `npx @wrapbox/cli install claude-code --repo --org ${ORG}`,
    hookEvents: ["PreToolUse", "PostToolUse", "SessionStart"],
    docs: "code.claude.com/docs/en/claude-code-on-the-web",
    snippet: `{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "https://api.wrapbox.ai/v1/check",
        "headers": { "Authorization": "Bearer $WRAPBOX_TOKEN" },
        "allowedEnvVars": ["WRAPBOX_TOKEN"],
        "timeout": 5
      }]
    }]
  }
}`,
    surfaces: ["Claude Code on the web", "claude-code-action (GitHub Actions)", "Claude Code desktop app sessions"],
    connected: false,
    owner: "Unassigned",
    env: "hosted runners",
  },
  {
    id: "cursor-cloud",
    name: "Cursor Cloud Agents",
    vendor: "Anysphere",
    category: "cloud",
    logo: "cursor",
    adapter: "cursor",
    surface: "github",
    file: ".cursor/hooks.json",
    fileNote: "Cloud agents run the repo's command hooks, plus team and enterprise-managed hooks. ~/.cursor/hooks.json is not on the cloud VM — commit the file.",
    lang: "json",
    install: `npx @wrapbox/cli install cursor --repo --org ${ORG}`,
    hookEvents: ["preToolUse", "beforeShellExecution", "beforeMCPExecution", "afterFileEdit"],
    docs: "cursor.com/docs/cloud-agent",
    snippet: `{
  "version": 1,
  "hooks": {
    "preToolUse":           [{ "command": "wrapbox hook cursor", "failClosed": true }],
    "beforeShellExecution": [{ "command": "wrapbox hook cursor", "failClosed": true }],
    "beforeMCPExecution":   [{ "command": "wrapbox hook cursor", "failClosed": true }]
  }
}`,
    surfaces: ["Cloud agents (cursor.com, Slack, GitHub)"],
    connected: false,
    owner: "Unassigned",
    env: "hosted runners",
  },
  {
    id: "devin",
    name: "Devin",
    vendor: "Cognition",
    category: "cloud",
    logo: "devin",
    adapter: "mcp",
    surface: "github",
    file: "Devin → Settings → MCP → Custom server",
    fileNote: "Devin has no pre-tool hook. Its tools reach the outside world through MCP, so point them at the gateway; PR evidence attaches through the GitHub App.",
    lang: "json",
    install: `wrapbox gateway client add devin --org ${ORG}`,
    hookEvents: ["tools/call"],
    docs: "docs.devin.ai",
    snippet: `{
  "mcpServers": {
    "wrapbox": {
      "url": "https://mcp.wrapbox.ai",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    surfaces: ["Devin (web)", "Devin in Slack, Linear, Jira", "Devin API"],
    connected: false,
    owner: "Unassigned",
    env: "hosted runners",
  },
  {
    id: "jules",
    name: "Google Jules",
    vendor: "Google",
    category: "cloud",
    logo: "google",
    adapter: "connector",
    surface: "github",
    file: "GitHub App · wrapbox",
    fileNote: "Jules exposes no pre-tool hook and no SDK. Wrapbox attaches as a GitHub App: a decision on every PR it opens, evidence only — enforcement is on the roadmap.",
    lang: "json",
    install: `wrapbox app install --github --agent jules`,
    hookEvents: ["pull_request", "check_run"],
    docs: "jules.google/docs",
    snippet: `{ "app": "wrapbox", "agent": "jules", "events": ["pull_request", "check_run"], "mode": "observe" }`,
    surfaces: ["jules.google", "Jules CLI", "Jules API"],
    connected: false,
    owner: "Unassigned",
    env: "hosted runners",
  },

  // ---- Custom AI agents (frameworks & SDKs) ----
  {
    id: "claude-agent-sdk",
    name: "Claude Agent SDK",
    vendor: "Anthropic",
    category: "custom",
    logo: "anthropic",
    adapter: "sdk-ts",
    surface: "graph",
    file: "agent.ts",
    fileNote: "PreToolUse hooks run first and can deny; anything left over lands in canUseTool. Both call the same Wrapbox guard.",
    lang: "ts",
    install: `npm i @anthropic-ai/claude-agent-sdk @wrapbox/sdk`,
    hookEvents: ["PreToolUse", "canUseTool", "PostToolUse"],
    docs: "platform.claude.com/docs/en/agent-sdk/hooks",
    snippet: `import { query } from "@anthropic-ai/claude-agent-sdk";
import { createClient } from "@wrapbox/sdk";

const wb = createClient({ org: "${ORG}", agent: "claims-agent", policy: process.env.WRAPBOX_TOKEN! });

for await (const msg of query({
  prompt: "Reconcile yesterday's claim payouts",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Bash|Write|Edit|mcp__.*", hooks: [async (input) => {
        const v = await wb.guard("tool." + input.tool_name, input.tool_input);
        if (v.allowed) return { continue: true };
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "wrapbox: " + v.reason } };
      }] }],
    },
    canUseTool: async (tool, input) =>
      (await wb.guard("tool." + tool, input)).allowed ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "wrapbox: not permitted" },
  },
})) { /* stream */ }`,
    surfaces: ["TypeScript SDK", "Python SDK"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "vercel-ai-sdk",
    name: "Vercel AI SDK",
    vendor: "Vercel",
    category: "custom",
    logo: "vercel",
    adapter: "sdk-ts",
    surface: "graph",
    file: "tools.ts",
    fileNote: "needsApproval pauses the loop; Wrapbox decides when that is required and mints the permit the executor verifies.",
    lang: "ts",
    install: `npm i ai @wrapbox/sdk`,
    hookEvents: ["needsApproval", "execute", "ToolLoopAgent"],
    docs: "ai-sdk.dev/docs/agents/tool-approval",
    snippet: `import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@wrapbox/sdk";

const wb = createClient({ org: "${ORG}", agent: "support-agent", policy: process.env.WRAPBOX_TOKEN! });

export const issueRefund = tool({
  description: "Refund a payment",
  inputSchema: z.object({ paymentId: z.string(), amount: z.number() }),
  // The SDK pauses only when Wrapbox says a person is required.
  needsApproval: async ({ amount }) => (await wb.guard("payments.refund", { amount })).decision === "REVIEW",
  execute: wb.guardTool("payments.refund", async ({ paymentId, amount }) => stripe.refunds.create({ payment_intent: paymentId, amount })),
});`,
    surfaces: ["Next.js / Node", "ToolLoopAgent", "Vercel AI Gateway"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "strands",
    name: "Strands Agents",
    vendor: "AWS",
    category: "custom",
    logo: "aws",
    adapter: "sdk-py",
    surface: "graph",
    file: "agent.py",
    fileNote: "BeforeToolCallEvent can interrupt for approval or cancel the call with a message the model sees.",
    lang: "py",
    install: `pip install strands-agents wrapbox`,
    hookEvents: ["BeforeToolCallEvent", "AfterToolCallEvent", "interrupt"],
    docs: "strandsagents.com/docs/user-guide/concepts/agents/hooks",
    snippet: `from strands import Agent
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
from wrapbox import Client

wb = Client(org="${ORG}", agent="ops-agent")

class Wrapbox(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.before_tool)

    def before_tool(self, event: BeforeToolCallEvent) -> None:
        v = wb.guard("tool." + event.tool_use["name"], event.tool_use["input"])
        if v.decision == "REVIEW":
            if event.interrupt("wrapbox_approval", reason=v.reason) != "APPROVE":
                event.cancel_tool = "wrapbox: not approved"
        elif not v.allowed:
            event.cancel_tool = f"wrapbox: {v.reason} (rule {v.rule})"

agent = Agent(tools=[deploy, rollback], hooks=[Wrapbox()])`,
    surfaces: ["Python", "TypeScript", "Bedrock AgentCore Runtime"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "pydantic-ai",
    name: "Pydantic AI",
    vendor: "Pydantic",
    category: "custom",
    logo: "pydantic",
    adapter: "sdk-py",
    surface: "graph",
    file: "agent.py",
    fileNote: "Raise ApprovalRequired when Wrapbox returns REVIEW; the run ends with DeferredToolRequests until the approver signs.",
    lang: "py",
    install: `pip install pydantic-ai wrapbox`,
    hookEvents: ["requires_approval", "ApprovalRequired", "DeferredToolRequests"],
    docs: "ai.pydantic.dev/deferred-tools",
    snippet: `from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import ApprovalRequired
from wrapbox import Client

wb = Client(org="${ORG}", agent="finance-agent")
agent = Agent("anthropic:claude-sonnet-5")

@agent.tool
def pay_vendor(ctx: RunContext, vendor_id: str, amount: int) -> str:
    v = wb.guard("purchase.order", {"vendor_id": vendor_id, "amount": amount})
    if v.decision == "REVIEW" and not ctx.tool_call_approved:
        raise ApprovalRequired(metadata={"wrapbox_decision": v.id})
    v.require()  # raises WrapboxDenied on BLOCK
    return ledger.pay(vendor_id, amount, permit=v.permit)`,
    surfaces: ["Python"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "mastra",
    name: "Mastra",
    vendor: "Mastra",
    category: "custom",
    logo: "mastra",
    adapter: "sdk-ts",
    surface: "graph",
    file: "tools.ts",
    fileNote: "requireApproval pauses the run and emits a tool-call-approval chunk; Wrapbox owns the decision and the permit.",
    lang: "ts",
    install: `npm i @mastra/core @wrapbox/sdk`,
    hookEvents: ["requireApproval", "approveToolCall", "declineToolCall"],
    docs: "mastra.ai/docs/agents/human-in-the-loop",
    snippet: `import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createClient } from "@wrapbox/sdk";

const wb = createClient({ org: "${ORG}", agent: "billing-agent", policy: process.env.WRAPBOX_TOKEN! });

export const cancelSubscription = createTool({
  id: "cancel-subscription",
  inputSchema: z.object({ customerId: z.string() }),
  requireApproval: true,   // Mastra pauses; Wrapbox decides and mints the permit
  execute: wb.guardTool("billing.cancel", async ({ customerId }) => billing.cancel(customerId)),
});`,
    surfaces: ["TypeScript", "Mastra Cloud"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "ms-agent-framework",
    name: "Microsoft Agent Framework",
    vendor: "Microsoft",
    category: "custom",
    logo: "microsoft",
    adapter: "sdk-py",
    surface: "graph",
    file: "agent.py",
    fileNote: "approval_mode=\"always_require\" pauses the run with a FunctionApprovalRequestContent; Wrapbox resolves it and signs the permit. Successor to Semantic Kernel and AutoGen.",
    lang: "py",
    install: `pip install agent-framework wrapbox`,
    hookEvents: ["approval_mode", "FunctionApprovalRequestContent", "FunctionInvocationMiddleware"],
    docs: "learn.microsoft.com/agent-framework/agents/tools/tool-approval",
    snippet: `from agent_framework import ai_function
from wrapbox import Client

wb = Client(org="${ORG}", agent="it-access-agent")

@ai_function(approval_mode="always_require")
def grant_admin(user: str, group: str) -> str:
    v = wb.guard("iam.grant", {"user": user, "group": group})
    v.require()   # BLOCK raises; REVIEW resolves through the approval round-trip
    return iam.add(user, group, permit=v.permit)`,
    surfaces: ["Python", "C# / .NET", "Azure AI Foundry"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "crewai",
    name: "CrewAI",
    vendor: "CrewAI",
    category: "custom",
    logo: "crewai",
    adapter: "sdk-py",
    surface: "graph",
    file: "tools.py",
    fileNote: "Wrap each tool body with guard(); a BLOCK never reaches the executor and a REVIEW waits for the approver.",
    lang: "py",
    install: `pip install crewai wrapbox`,
    hookEvents: ["tool", "before_kickoff"],
    docs: "docs.crewai.com/concepts/tools",
    snippet: `from crewai.tools import tool
from wrapbox import Client

wb = Client(org="${ORG}", agent="procurement-crew")

@tool("Create purchase order")
def create_po(vendor: str, amount: int) -> str:
    """Raise a PO with a vendor."""
    v = wb.guard("purchase.order", {"vendor": vendor, "amount": amount})
    v.require()
    return erp.create_po(vendor, amount, permit=v.permit)`,
    surfaces: ["Python", "CrewAI AMP"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    vendor: "LlamaIndex",
    category: "custom",
    logo: "llamaindex",
    adapter: "sdk-py",
    surface: "graph",
    file: "tools.py",
    fileNote: "FunctionTool bodies call guard(); workflows surface REVIEW as an InputRequiredEvent.",
    lang: "py",
    install: `pip install llama-index wrapbox`,
    hookEvents: ["FunctionTool", "InputRequiredEvent"],
    docs: "docs.llamaindex.ai/en/stable/module_guides/deploying/agents/tools",
    snippet: `from llama_index.core.tools import FunctionTool
from wrapbox import Client

wb = Client(org="${ORG}", agent="research-agent")

def send_email(to: str, body: str) -> str:
    v = wb.guard("email.send", {"to": to})
    v.require()
    return mail.send(to, body, permit=v.permit)

tools = [FunctionTool.from_defaults(fn=send_email)]`,
    surfaces: ["Python", "TypeScript", "LlamaCloud"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "bedrock-agentcore",
    name: "Amazon Bedrock AgentCore",
    vendor: "AWS",
    category: "custom",
    logo: "aws",
    adapter: "mcp",
    surface: "graph",
    file: "AgentCore Gateway → target",
    fileNote: "AgentCore Gateway already speaks MCP and enforces Cedar policies. Add mcp.wrapbox.ai as a target so every tool call carries a Wrapbox permit, or verify permits inside Lambda targets.",
    lang: "json",
    install: `wrapbox gateway client add agentcore --org ${ORG}`,
    hookEvents: ["tools/call", "Cedar policy"],
    docs: "docs.aws.amazon.com/bedrock-agentcore",
    snippet: `{
  "mcpServers": {
    "wrapbox": {
      "url": "https://mcp.wrapbox.ai",
      "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
    }
  }
}`,
    surfaces: ["AgentCore Runtime", "AgentCore Gateway", "AgentCore Identity"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },
  {
    id: "azure-foundry",
    name: "Azure AI Foundry Agent Service",
    vendor: "Microsoft",
    category: "custom",
    logo: "microsoft",
    adapter: "mcp",
    surface: "graph",
    file: "agent tools (McpTool)",
    fileNote: "Foundry agents call MCP tools with a per-server approval mode. Point them at the gateway; REVIEW is held at Wrapbox, not in Foundry.",
    lang: "py",
    install: `pip install azure-ai-agents wrapbox`,
    hookEvents: ["tools/call", "require_approval"],
    docs: "learn.microsoft.com/azure/ai-foundry/agents/how-to/tools/model-context-protocol",
    snippet: `from azure.ai.agents.models import McpTool

wrapbox = McpTool(server_label="wrapbox", server_url="https://mcp.wrapbox.ai")
wrapbox.set_approval_mode("never")   # Wrapbox decides; REVIEW is held at the gateway
wrapbox.update_headers("Authorization", "Bearer " + os.environ["WRAPBOX_TOKEN"])

agent = client.create_agent(model="gpt-5", name="ops-agent", tools=wrapbox.definitions)`,
    surfaces: ["Foundry Agent Service", "Foundry portal"],
    connected: false,
    owner: "Unassigned",
    env: "your services",
  },

  // ---- Enterprise AI agents ----
  {
    id: "m365-copilot",
    name: "Microsoft 365 Copilot agents",
    vendor: "Microsoft",
    category: "saas",
    logo: "microsoft",
    adapter: "connector",
    surface: "chat",
    file: "declarativeAgent.json",
    fileNote: "Declarative agents act through API plugins. Wrapbox ships as an API plugin so consequential actions are authorized — connector on the roadmap.",
    lang: "json",
    install: `wrapbox connector add m365-copilot --org ${ORG}`,
    hookEvents: ["API plugin", "Copilot connector"],
    docs: "learn.microsoft.com/microsoft-365-copilot/extensibility",
    snippet: `{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.5/schema.json",
  "name": "Finance assistant",
  "actions": [{ "id": "wrapbox", "file": "wrapbox-plugin.json" }]
}`,
    surfaces: ["Copilot Chat", "Teams", "Copilot Studio agents"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "gemini-enterprise",
    name: "Gemini Enterprise agents",
    vendor: "Google",
    category: "saas",
    logo: "gemini",
    adapter: "connector",
    surface: "chat",
    file: "Agent Designer → Actions",
    fileNote: "Gemini Enterprise (Agentspace) agents call OpenAPI actions. Wrapbox registers as the action every consequential step must go through — connector on the roadmap.",
    lang: "json",
    install: `wrapbox connector add gemini-enterprise --org ${ORG}`,
    hookEvents: ["action", "connector"],
    docs: "cloud.google.com/gemini/enterprise",
    snippet: `{ "action": "wrapbox.authorize", "openapi": "https://api.wrapbox.ai/openapi.json", "auth": "oauth2" }`,
    surfaces: ["Gemini Enterprise", "Agentspace", "Gemini in Workspace"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "sap-joule",
    name: "SAP Joule agents",
    vendor: "SAP",
    category: "saas",
    logo: "sap",
    adapter: "connector",
    surface: "crm",
    file: "Joule Studio → skill",
    fileNote: "Joule agents act through skills bound to SAP APIs. Wrapbox wraps the skill's API call — connector on the roadmap.",
    lang: "json",
    install: `wrapbox connector add sap-joule --org ${ORG}`,
    hookEvents: ["skill", "API destination"],
    docs: "help.sap.com/joule",
    snippet: `{ "skill": "approve-invoice", "destination": "wrapbox-authorize", "effect": "purchase.order" }`,
    surfaces: ["S/4HANA", "SuccessFactors", "Ariba"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "atlassian-rovo",
    name: "Atlassian Rovo agents",
    vendor: "Atlassian",
    category: "saas",
    logo: "atlassian",
    adapter: "connector",
    surface: "chat",
    file: "manifest.yml (Forge)",
    fileNote: "Rovo agents act through Forge actions. Wrapbox authorizes each action before it touches Jira or Confluence — connector on the roadmap.",
    lang: "yaml",
    install: `wrapbox connector add rovo --org ${ORG}`,
    hookEvents: ["rovo:agent", "action"],
    docs: "developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent",
    snippet: `modules:
  rovo:agent:
    - key: release-agent
      actions: [wrapbox-authorize]
  action:
    - key: wrapbox-authorize
      function: authorize`,
    surfaces: ["Jira", "Confluence", "Rovo Dev"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "n8n",
    name: "n8n AI Agent",
    vendor: "n8n",
    category: "saas",
    logo: "n8n",
    adapter: "mcp",
    surface: "graph",
    file: "MCP Client Tool node",
    fileNote: "The AI Agent node's MCP Client Tool points at the gateway, so every tool the workflow agent calls is authorized.",
    lang: "json",
    install: `wrapbox gateway client add n8n --org ${ORG}`,
    hookEvents: ["tools/call"],
    docs: "docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp",
    snippet: `{
  "endpointUrl": "https://mcp.wrapbox.ai/stripe",
  "serverTransport": "httpStreamable",
  "authentication": "headerAuth"
}`,
    surfaces: ["n8n Cloud", "self-hosted"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "dify",
    name: "Dify agents",
    vendor: "Dify",
    category: "saas",
    logo: "dify",
    adapter: "mcp",
    surface: "graph",
    file: "Tools → MCP → add server",
    fileNote: "Dify agents and workflows call MCP servers; register the gateway URL and its tools are governed.",
    lang: "json",
    install: `wrapbox gateway client add dify --org ${ORG}`,
    hookEvents: ["tools/call"],
    docs: "docs.dify.ai",
    snippet: `{
  "wrapbox": {
    "transport": "streamable_http",
    "url": "https://mcp.wrapbox.ai",
    "headers": { "Authorization": "Bearer \${WRAPBOX_TOKEN}" }
  }
}`,
    surfaces: ["Dify Cloud", "self-hosted"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },

  // ---- Browser & computer agents ----
  {
    id: "chatgpt-agent",
    name: "ChatGPT agent",
    vendor: "OpenAI",
    category: "browser",
    logo: "openai",
    adapter: "browser",
    surface: "browser",
    file: "ChatGPT → Settings → Connectors",
    fileNote: "Agent mode clicks inside a hosted browser with no pre-action hook. Connectors (MCP) route its tool calls through the gateway today; authorizing the final click is on the roadmap.",
    lang: "json",
    install: `wrapbox connector add chatgpt --org ${ORG}`,
    hookEvents: ["connector (MCP)", "browser.action"],
    docs: "openai.com/index/introducing-chatgpt-agent",
    snippet: `{ "connector": "wrapbox", "type": "mcp", "url": "https://mcp.wrapbox.ai" }`,
    surfaces: ["ChatGPT agent mode", "ChatGPT Atlas browser", "Operator (merged)"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "claude-chrome",
    name: "Claude for Chrome & Cowork",
    vendor: "Anthropic",
    category: "browser",
    logo: "claude",
    adapter: "browser",
    surface: "browser",
    file: "Claude → Settings → Connectors",
    fileNote: "Claude in Chrome acts inside the user's logged-in session. MCP connectors route tool calls through the gateway today; the controlled executor for clicks is on the roadmap.",
    lang: "json",
    install: `wrapbox connector add claude --org ${ORG}`,
    hookEvents: ["connector (MCP)", "browser.action"],
    docs: "claude.com/chrome",
    snippet: `{ "name": "wrapbox", "url": "https://mcp.wrapbox.ai", "type": "mcp" }`,
    surfaces: ["Claude for Chrome", "Claude Cowork (desktop)", "Claude computer use (API)"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "gemini-chrome",
    name: "Gemini in Chrome",
    vendor: "Google",
    category: "browser",
    logo: "gemini",
    adapter: "browser",
    surface: "browser",
    file: "Chrome enterprise policy",
    fileNote: "Agent mode (Project Mariner) browses inside Chrome. No pre-action hook is published; Wrapbox's controlled executor is on the roadmap, Chrome enterprise policy limits the blast radius today.",
    lang: "json",
    install: `wrapbox connector add gemini-chrome --org ${ORG}`,
    hookEvents: ["browser.action"],
    docs: "support.google.com/chrome/a",
    snippet: `{ "GeminiSettings": 1, "GenAIDefaultSettings": 2 }`,
    surfaces: ["Gemini in Chrome", "Agent mode (Project Mariner)"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "comet",
    name: "Perplexity Comet",
    vendor: "Perplexity",
    category: "browser",
    logo: "perplexity",
    adapter: "browser",
    surface: "browser",
    file: "Comet → Settings → Connectors",
    fileNote: "Comet browses and buys inside the user's session with no pre-action hook. Controlled executor on the roadmap.",
    lang: "json",
    install: `wrapbox connector add comet --org ${ORG}`,
    hookEvents: ["browser.action"],
    docs: "perplexity.ai/comet",
    snippet: `{ "connector": "wrapbox", "type": "mcp", "url": "https://mcp.wrapbox.ai" }`,
    surfaces: ["Comet browser"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "manus",
    name: "Manus",
    vendor: "Manus",
    category: "browser",
    logo: "manus",
    adapter: "browser",
    surface: "browser",
    file: "Manus → Integrations",
    fileNote: "Manus runs in a hosted browser and desktop with no pre-action hook. Controlled executor on the roadmap.",
    lang: "json",
    install: `wrapbox connector add manus --org ${ORG}`,
    hookEvents: ["browser.action"],
    docs: "manus.im",
    snippet: `{ "integration": "wrapbox", "type": "mcp", "url": "https://mcp.wrapbox.ai" }`,
    surfaces: ["manus.im", "Manus desktop"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "stagehand",
    name: "Stagehand",
    vendor: "Browserbase",
    category: "browser",
    logo: "browserbase",
    adapter: "sdk-ts",
    surface: "browser",
    file: "agent.ts",
    fileNote: "You own the code, so every consequential act() is normalized and authorized before dispatch — the same SDK guard as any custom agent.",
    lang: "ts",
    install: `npm i @browserbasehq/stagehand @wrapbox/sdk`,
    hookEvents: ["act", "agent.execute"],
    docs: "docs.stagehand.dev",
    snippet: `import { Stagehand } from "@browserbasehq/stagehand";
import { createClient } from "@wrapbox/sdk";

const wb = createClient({ org: "${ORG}", agent: "ap-browser-agent", policy: process.env.WRAPBOX_TOKEN! });
const { page } = new Stagehand({ env: "BROWSERBASE" });

// Every consequential act() is authorized before the click is dispatched.
const act = wb.guardTool("browser.act", (instruction: string) => page.act(instruction), (instruction) => ({ instruction }));
await act("Submit the vendor payment form for $50,000");`,
    surfaces: ["Stagehand SDK (TypeScript, Python)", "Browserbase cloud browsers"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
  {
    id: "nova-act",
    name: "Amazon Nova Act",
    vendor: "AWS",
    category: "browser",
    logo: "aws",
    adapter: "sdk-py",
    surface: "browser",
    file: "agent.py",
    fileNote: "Nova Act is an SDK you drive from your own code, so guard() runs before each act() that changes state.",
    lang: "py",
    install: `pip install nova-act wrapbox`,
    hookEvents: ["act"],
    docs: "nova.amazon.com/act",
    snippet: `from nova_act import NovaAct
from wrapbox import Client

wb = Client(org="${ORG}", agent="procure-browser-agent")

with NovaAct(starting_page="https://vendor.example/orders") as nova:
    step = "Place the order for 40 units"
    v = wb.guard("purchase.order", {"instruction": step, "amount": 100000})
    v.require()          # REVIEW waits for the approver; BLOCK never clicks
    nova.act(step)`,
    surfaces: ["Nova Act SDK", "Nova Act on AgentCore"],
    connected: false,
    owner: "Unassigned",
    env: "production",
  },
];

/* A process the Runtime attributed to a model call but could not match to any profile. It renders
   like any agent (name, logo, activity) so Evidence and Fleet can show it; nothing is known about it. */
const unknownAgents = new Map<string, Agent>();
export const isUnknownAgent = (id: string) => id.startsWith("unknown:");
function unknownAgent(id: string): Agent {
  let a = unknownAgents.get(id);
  if (!a) {
    // Only strip the prefix when it is actually there — a bare id like
    // "discovery" would otherwise be sliced into nonsense ("y").
    const binary = id.startsWith("unknown:") ? id.slice("unknown:".length) : id;
    a = { id, name: binary, vendor: "Unrecognized process", category: "custom", logo: "process", adapter: "runtime", surface: "terminal", file: "—", fileNote: "Not matched to any agent profile. Seen only through the model-egress gate.", lang: "bash", snippet: "", install: "", hookEvents: [], docs: "", connected: false, owner: "—", env: "—" };
    unknownAgents.set(id, a);
  }
  return a;
}
export const agentById = (id: string): Agent => AGENTS.find((a) => a.id === id) ?? unknownAgent(id);
export const categoryById = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!;
export const agentsIn = (c: CategoryId) => AGENTS.filter((a) => a.category === c);
