// Agent profiles: the data the Runtime reads to discover an agent on a device and to write its adapter.
// Adding an agent means adding an entry here. Nothing in discovery, provisioning or coverage branches
// on an agent id — they read only these fields. Values follow each vendor's published documentation;
// the config formats themselves come from the catalog in ./agents.ts, which was verified the same way.

import { agentById } from "./agents";

export type DeviceOs = "macos" | "linux" | "windows";
export type AdapterKind = "managed-settings" | "hooks-json";
export type LaunchMode = "wrapbox" | "native-managed" | "native-unmanaged" | "unknown";
export type Kind = "fs.read" | "fs.write" | "exec" | "net.connect" | "model.request" | "mcp.tool_call" | "http.request" | "scm.push" | "payment";

export interface AgentProfile {
  id: string;
  /** Process names and app bundles discovery matches on the device. */
  binaries: string[];
  /** macOS code-signing identifier, when the vendor ships a signed app. */
  signingId?: string;
  /** Hosts the agent must reach to work. The model-egress gate keys on these. */
  modelEndpoints: string[];
  /** How the Runtime governs it once discovered. */
  launch: "wrapbox" | "native-managed";
  /** What the adapter's hooks see before execution — the Ceiling coverage it provides. */
  covers: Kind[];
  adapter?: {
    kind: AdapterKind;
    path: Record<DeviceOs, string>;
    /** true: the vendor only honours a managed location; false: user-writable, integrity-monitored by the Floor. */
    managedOnly: boolean;
    /** The file the Runtime writes, real format. */
    render: (org: string) => string;
  };
  docs: string;
}

/** Root-owned, code-signed shim every adapter points at. It forwards the event to wrapboxd over a local socket. */
export const HOOK_SHIM: Record<DeviceOs, string> = {
  macos: "/usr/local/libexec/wrapbox/wrapbox-hook",
  linux: "/usr/libexec/wrapbox/wrapbox-hook",
  windows: "C:\\Program Files\\Wrapbox\\wrapbox-hook.exe",
};

/** The catalog snippet, retargeted from the v1 CLI (`wrapbox hook <agent>`) to the Runtime's shim. */
const fromCatalog = (id: string) => (org: string) => agentById(id).snippet.replace(/wrapbox hook (\w+)/g, `${HOOK_SHIM.macos} $1`).replace(/\$\{?ORG\}?/g, org);

/* Managed settings for Claude Code. Keys per code.claude.com/docs/en/settings (managed settings locations,
   allowManaged*Only, permissions.disableBypassPermissionsMode) and the sandbox settings documented under
   code.claude.com/docs/en/sandboxing. The hook is a command hook so it works offline against the local engine. */
const claudeManagedSettings = (org: string) =>
  JSON.stringify(
    {
      allowManagedHooksOnly: true,
      allowManagedPermissionRulesOnly: true,
      allowManagedMcpServersOnly: true,
      permissions: { disableBypassPermissionsMode: "disable" },
      sandbox: { enabled: true, failIfUnavailable: true },
      hooks: {
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${HOOK_SHIM.macos} claude --org ${org}`, timeout: 5 }] }],
        SessionStart: [{ hooks: [{ type: "command", command: `${HOOK_SHIM.macos} claude --org ${org} --event SessionStart` }] }],
      },
    },
    null,
    2,
  );

export const PROFILES: AgentProfile[] = [
  {
    id: "claude-code",
    binaries: ["claude"],
    modelEndpoints: ["api.anthropic.com"],
    launch: "wrapbox",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "managed-settings",
      path: { macos: "/Library/Application Support/ClaudeCode/managed-settings.json", linux: "/etc/claude-code/managed-settings.json", windows: "C:\\ProgramData\\ClaudeCode\\managed-settings.json" },
      managedOnly: true,
      render: claudeManagedSettings,
    },
    docs: "code.claude.com/docs/en/settings",
  },
  {
    id: "cursor",
    binaries: ["Cursor", "cursor"],
    signingId: "com.todesktop.230313mzl4w4u92",
    modelEndpoints: ["api2.cursor.sh", "api3.cursor.sh"],
    launch: "native-managed",
    covers: ["fs.read", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: "~/.cursor/hooks.json", linux: "~/.cursor/hooks.json", windows: "%USERPROFILE%\\.cursor\\hooks.json" },
      managedOnly: false,
      render: fromCatalog("cursor"),
    },
    docs: "cursor.com/docs/hooks",
  },
  {
    id: "codex-cli",
    binaries: ["codex"],
    modelEndpoints: ["api.openai.com", "chatgpt.com"],
    launch: "native-managed",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: "~/.codex/hooks.json", linux: "~/.codex/hooks.json", windows: "%USERPROFILE%\\.codex\\hooks.json" },
      managedOnly: false,
      render: fromCatalog("codex-cli"),
    },
    docs: "developers.openai.com/codex/hooks",
  },
  {
    id: "windsurf",
    binaries: ["Windsurf"],
    signingId: "com.exafunction.windsurf",
    modelEndpoints: ["server.codeium.com", "inference.codeium.com"],
    launch: "native-managed",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: "/Library/Application Support/Windsurf/hooks.json", linux: "~/.codeium/windsurf/hooks.json", windows: "%APPDATA%\\Windsurf\\hooks.json" },
      managedOnly: false,
      render: fromCatalog("windsurf"),
    },
    docs: "docs.windsurf.com/windsurf/cascade/hooks",
  },
  {
    id: "copilot-ide",
    binaries: ["copilot", "code"],
    modelEndpoints: ["api.githubcopilot.com", "copilot-proxy.githubusercontent.com"],
    launch: "native-managed",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: ".github/hooks/wrapbox.json", linux: ".github/hooks/wrapbox.json", windows: ".github\\hooks\\wrapbox.json" },
      managedOnly: false,
      render: fromCatalog("copilot-ide"),
    },
    docs: "docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks",
  },
  {
    id: "gemini-cli",
    binaries: ["gemini"],
    modelEndpoints: ["generativelanguage.googleapis.com", "cloudcode-pa.googleapis.com"],
    launch: "native-managed",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: "~/.gemini/settings.json", linux: "~/.gemini/settings.json", windows: "%USERPROFILE%\\.gemini\\settings.json" },
      managedOnly: false,
      render: fromCatalog("gemini-cli"),
    },
    docs: "geminicli.com/docs/hooks",
  },
  {
    id: "cline",
    binaries: ["saoudrizwan.claude-dev"],
    modelEndpoints: ["api.anthropic.com", "api.openai.com", "openrouter.ai"],
    launch: "native-managed",
    covers: ["fs.read", "fs.write", "exec", "mcp.tool_call"],
    adapter: {
      kind: "hooks-json",
      path: { macos: "~/Documents/Cline/Rules/Hooks/PreToolUse", linux: "~/Documents/Cline/Rules/Hooks/PreToolUse", windows: "%USERPROFILE%\\Documents\\Cline\\Rules\\Hooks\\PreToolUse" },
      managedOnly: false,
      render: fromCatalog("cline"),
    },
    docs: "docs.cline.bot/customization/hooks",
  },
  {
    // A server-side agent: launched by the Runtime as a service, governed through the SDK guard and the Gateway. No adapter file.
    id: "langgraph",
    binaries: ["claims-agent"],
    modelEndpoints: ["api.anthropic.com"],
    launch: "wrapbox",
    covers: [],
    docs: "langchain-ai.github.io/langgraph/concepts/human_in_the_loop",
  },
];

export const profileOf = (agentId: string) => PROFILES.find((p) => p.id === agentId);

/** Every host any profiled agent talks to — the catalog the model-egress gate is keyed on. */
export const MODEL_ENDPOINTS = Array.from(new Set(PROFILES.flatMap((p) => p.modelEndpoints))).sort();
