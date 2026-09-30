// Real vendor marks, bundled (same asset set as the main wrapbox-prototype).
const files = import.meta.glob("../assets/logos/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const base = path.split("/").pop()!.replace(/\.(svg|png)$/, "");
  byName[base] = url;
}

export const logoUrl = (name: string): string => byName[name] ?? byName["mcp"];

// People photos (same asset set + credits as the main prototype)
const photos = import.meta.glob("../assets/people/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const photoByName: Record<string, string> = {};
for (const [path, url] of Object.entries(photos)) {
  photoByName[path.split("/").pop()!.replace(/\.jpg$/, "")] = url;
}
const USER_PHOTOS: Record<string, string> = {
  "u-priya": "priya.m",
  "u-daniel": "dev.k",
  "u-maya": "meera.i",
  "u-alex": "rohan.d",
  "u-jordan": "kiran.b",
  "u-sam": "sara.t",
};
export const photoOf = (userId: string): string | undefined =>
  photoByName[USER_PHOTOS[userId] ?? ""];

// Agent id → vendor mark
export const AGENT_LOGOS: Record<string, string> = {
  "a-claude-code": "claudecode",
  "a-codex": "codex",
  "a-chatgpt": "openai",
  "a-claude": "claude",
  "a-copilot": "microsoft",
  "a-finance": "process",
  "a-support": "process",
  "a-unknown-mcp": "mcp",
};

// Destination id → vendor mark
export const DEST_LOGOS: Record<string, string> = {
  "dest-approved-ai": "copilotstudio",
  "dest-chatgpt": "openai",
  "dest-claude": "claude",
  "dest-unapproved-ai": "mcp",
  "dest-salesforce": "salesforce",
  "dest-internal": "postgresql",
  "dest-partner": "slack",
  "dest-generic": "chrome",
  "dest-unknown": "mcp",
};

// Resource/integration marks
export const INTEGRATION_LOGOS: Record<string, string> = {
  GitHub: "github_light",
  PostgreSQL: "postgresql",
  AWS: "aws",
  Salesforce: "salesforce",
  Okta: "okta",
  MCP: "mcp",
  Anthropic: "anthropic",
  OpenAI: "openai",
  Microsoft: "microsoft",
};
