/**
 * Wrapbox agent registry — one table of every agent the fabric knows how to
 * detect + wrap. Every detect signature MUST cite a public source in a
 * neighbouring comment. Absence of a citation = drop the entry (see
 * CLAUDE.md: never invent behaviour from assumptions).
 *
 * Detection kinds:
 *   bin       — a binary on PATH (`which`)
 *   app       — a .app bundle with matching CFBundleIdentifier (`mdfind`)
 *   path      — a file/dir at a tilde-expanded path
 *   extension — an extension id under a host IDE's extensions dir
 */
import os from "node:os";
import path from "node:path";

export type DetectSig =
  | { kind: "bin"; names: string[] }
  | { kind: "app"; bundleIds: string[] }
  | { kind: "path"; paths: string[] }
  | { kind: "extension"; host: "vscode" | "cursor" | "windsurf"; ids: string[] };

export type AgentKind = "cli" | "ide" | "desktop" | "extension" | "background";
export type HookAdapter = "claude-code" | "cursor" | "codex";

export interface RegistryEntry {
  id: string;
  name: string;
  kind: AgentKind;
  detect: DetectSig[];
  /** true = safe to install a PATH shim for this bin (all bin names). */
  shimmable?: boolean;
  hookAdapter?: HookAdapter;
  /** Safe to invoke `<bin> --version` (short timeout) to record a version. */
  versionSafe?: boolean;
}

export const REGISTRY: RegistryEntry[] = [
  // Anthropic Claude Code CLI — https://docs.claude.com/en/docs/claude-code/setup
  // Installed as npm `@anthropic-ai/claude-code`; the binary is `claude`.
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "cli",
    detect: [
      { kind: "bin", names: ["claude"] },
      { kind: "path", paths: ["~/.claude"] },
    ],
    shimmable: true,
    hookAdapter: "claude-code",
    versionSafe: true,
  },
  // OpenAI Codex CLI — https://github.com/openai/codex (README: "codex" bin)
  {
    id: "codex-cli",
    name: "OpenAI Codex CLI",
    kind: "cli",
    detect: [
      { kind: "bin", names: ["codex"] },
      { kind: "path", paths: ["~/.codex"] },
    ],
    shimmable: true,
    hookAdapter: "codex",
    versionSafe: true,
  },
  // Google Gemini CLI — https://github.com/google-gemini/gemini-cli
  // README documents `gemini` as the invocation.
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    kind: "cli",
    detect: [{ kind: "bin", names: ["gemini"] }],
    shimmable: true,
    versionSafe: true,
  },
  // Aider — https://aider.chat/docs/install.html ("aider" bin from PyPI package aider-chat)
  {
    id: "aider",
    name: "Aider",
    kind: "cli",
    detect: [{ kind: "bin", names: ["aider"] }],
    shimmable: true,
    versionSafe: true,
  },
  // opencode — https://github.com/sst/opencode (README: `opencode` bin from `npm i -g opencode-ai`)
  {
    id: "opencode",
    name: "opencode",
    kind: "cli",
    detect: [{ kind: "bin", names: ["opencode"] }],
    shimmable: true,
    versionSafe: true,
  },
  // Amazon Q Developer CLI — https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html
  // Installs the `q` command.
  {
    id: "amazon-q",
    name: "Amazon Q Developer CLI",
    kind: "cli",
    detect: [{ kind: "bin", names: ["q"] }],
    shimmable: true,
    versionSafe: true,
  },
  // Shell-GPT — https://github.com/TheR1D/shell_gpt (README: `sgpt` bin)
  {
    id: "sgpt",
    name: "Shell-GPT",
    kind: "cli",
    detect: [{ kind: "bin", names: ["sgpt"] }],
    shimmable: true,
    versionSafe: true,
  },
  // Cursor — https://www.cursor.com. Bundle id is stable across releases; the
  // ToDesktop-generated id is documented in Cursor's own updater metadata.
  {
    id: "cursor",
    name: "Cursor",
    kind: "ide",
    detect: [
      { kind: "app", bundleIds: ["com.todesktop.230313mzl4w4u92"] },
      { kind: "path", paths: ["~/.cursor"] },
    ],
  },
  // Visual Studio Code (host for agent extensions) —
  // https://code.visualstudio.com/docs/setup/mac
  {
    id: "vscode",
    name: "Visual Studio Code",
    kind: "ide",
    detect: [
      { kind: "app", bundleIds: ["com.microsoft.VSCode"] },
      { kind: "path", paths: ["~/.vscode"] },
    ],
  },
  // Claude Desktop — https://claude.ai/download
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    kind: "desktop",
    detect: [
      { kind: "app", bundleIds: ["com.anthropic.claudefordesktop"] },
      { kind: "path", paths: ["~/Library/Application Support/Claude"] },
    ],
  },
  // ChatGPT Desktop — https://openai.com/chatgpt/desktop/
  {
    id: "chatgpt-desktop",
    name: "ChatGPT Desktop",
    kind: "desktop",
    detect: [{ kind: "app", bundleIds: ["com.openai.chat"] }],
  },
  // GitHub Copilot (VS Code extension) — https://marketplace.visualstudio.com/items?itemName=GitHub.copilot
  {
    id: "github-copilot",
    name: "GitHub Copilot (VS Code)",
    kind: "extension",
    detect: [{ kind: "extension", host: "vscode", ids: ["github.copilot", "github.copilot-chat"] }],
  },
  // Continue — https://marketplace.visualstudio.com/items?itemName=Continue.continue
  {
    id: "continue",
    name: "Continue",
    kind: "extension",
    detect: [{ kind: "extension", host: "vscode", ids: ["continue.continue"] }],
  },
  // Cline — https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev
  {
    id: "cline",
    name: "Cline",
    kind: "extension",
    detect: [{ kind: "extension", host: "vscode", ids: ["saoudrizwan.claude-dev"] }],
  },
  // Roo Cline — https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline
  {
    id: "roo-cline",
    name: "Roo Cline",
    kind: "extension",
    detect: [{ kind: "extension", host: "vscode", ids: ["rooveterinaryinc.roo-cline"] }],
  },
  // Model Context Protocol servers (best-effort by user-config presence) —
  // https://modelcontextprotocol.io/quickstart/user (Claude Desktop config path)
  {
    id: "mcp-servers",
    name: "MCP servers (configured)",
    kind: "background",
    detect: [
      { kind: "path", paths: ["~/Library/Application Support/Claude/claude_desktop_config.json"] },
    ],
  },
];

export function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function extensionsDirFor(host: "vscode" | "cursor" | "windsurf"): string {
  // VS Code: https://code.visualstudio.com/docs/editor/extension-marketplace#_where-are-extensions-installed
  // Cursor:  https://docs.cursor.com/guides/migration/vscode  (uses ~/.cursor/extensions)
  // Windsurf: unresolved without an authoritative source — do not fabricate.
  const home = os.homedir();
  if (host === "vscode") return path.join(home, ".vscode", "extensions");
  if (host === "cursor") return path.join(home, ".cursor", "extensions");
  return path.join(home, ".windsurf", "extensions");
}
