/**
 * Destination Registry — how a NAMED destination becomes something the runtime
 * can actually observe.
 *
 * An administrator writes "ChatGPT, Claude, and Microsoft Copilot". That is a
 * precise list of three services, and the compiled contract must keep it that
 * precise: it is NOT "external AI". Collapsing named services into a category
 * silently widens the permission to every AI service on earth — the exact
 * failure this module exists to prevent.
 *
 * Two layers, both admin-configurable:
 *
 *   SERVICE   a vendor the admin can name  → the host patterns it uses on the wire
 *             chatgpt → chatgpt.com, openai.com, oaiusercontent.com
 *
 *   GROUP     an admin-defined set of services (or raw hosts)
 *             approved_ai → [chatgpt, claude, copilot]
 *
 * A clause keeps the SEMANTIC name (destination.group = "approved_ai"); the
 * network compiler lowers it to concrete host predicates. If a name cannot be
 * resolved to any host, the clause is not enforceable on that facet, and the
 * resolver says so — it never guesses a broader set.
 *
 * COMPLEMENTS are first-class: "any other external destination" is
 * { notIn: "approved_ai" }, which lowers to a host predicate that matches every
 * host NOT in the group. The runtime observes destination hosts, so this is a
 * genuinely enforceable predicate, not an abstract one.
 */

/* ------------------------------------------------------------------ *
 * Services — seeded with well-known vendors, extensible by the admin.
 * ------------------------------------------------------------------ */

export interface DestinationService {
  id: string;
  label: string;
  /** Domain suffixes observed on the wire. A host matches if it equals one of
   *  these or ends with "." + one of these. */
  hosts: string[];
  /** How an admin might refer to it in a sentence. Matched case-insensitively. */
  aliases: string[];
}

export const SERVICE_SEED: DestinationService[] = [
  { id: "chatgpt",    label: "ChatGPT",            hosts: ["chatgpt.com", "openai.com", "oaiusercontent.com"],
    aliases: ["chatgpt", "chat gpt", "openai", "open ai", "gpt"] },
  { id: "claude",     label: "Claude",             hosts: ["claude.ai", "anthropic.com"],
    aliases: ["claude", "anthropic", "claude ai"] },
  { id: "copilot",    label: "Microsoft Copilot",  hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft", "githubcopilot.com", "bing.com"],
    aliases: ["copilot", "microsoft copilot", "ms copilot", "github copilot", "m365 copilot"] },
  { id: "gemini",     label: "Gemini",             hosts: ["gemini.google.com", "generativelanguage.googleapis.com", "aistudio.google.com"],
    aliases: ["gemini", "google gemini", "bard", "google ai"] },
  { id: "perplexity", label: "Perplexity",         hosts: ["perplexity.ai"], aliases: ["perplexity"] },
  { id: "mistral",    label: "Mistral",            hosts: ["mistral.ai"], aliases: ["mistral", "le chat"] },
  { id: "cursor",     label: "Cursor",             hosts: ["cursor.com", "cursor.sh"], aliases: ["cursor"] },
  { id: "deepseek",   label: "DeepSeek",           hosts: ["deepseek.com"], aliases: ["deepseek"] },
  { id: "grok",       label: "Grok",               hosts: ["x.ai", "grok.com"], aliases: ["grok", "xai"] },
  { id: "github",     label: "GitHub",             hosts: ["github.com", "githubusercontent.com"], aliases: ["github"] },
  { id: "slack",      label: "Slack",              hosts: ["slack.com"], aliases: ["slack"] },
  { id: "notion",     label: "Notion",             hosts: ["notion.so", "notion.site"], aliases: ["notion"] },
  { id: "gdrive",     label: "Google Drive",       hosts: ["drive.google.com", "docs.google.com"], aliases: ["google drive", "gdrive", "google docs"] },
  { id: "dropbox",    label: "Dropbox",            hosts: ["dropbox.com"], aliases: ["dropbox"] },
];

/** A built-in category that names a KIND of destination. Resolvable only via
 *  the services tagged with it — never a wildcard. */
export const CATEGORY_MEMBERS: Record<string, string[]> = {
  external_ai:    ["chatgpt", "claude", "copilot", "gemini", "perplexity", "mistral", "cursor", "deepseek", "grok"],
  model_provider: ["chatgpt", "claude", "gemini", "mistral", "grok"],
  saas:           ["slack", "notion", "gdrive", "dropbox", "github"],
};

/* ------------------------------------------------------------------ *
 * Groups — admin-defined sets. Persisted; the contract can define them too.
 * ------------------------------------------------------------------ */

export interface DestinationGroup {
  id: string;                  // "approved_ai"
  label: string;               // "approved AI services"
  /** Member service ids and/or raw host suffixes. */
  members: string[];
  /** Where this group came from — the admin's registry or the contract text. */
  origin: "registry" | "contract";
}

const STORE_KEY = "wbx-destination-registry";

interface Persisted { services: DestinationService[]; groups: DestinationGroup[] }

function readStore(): Persisted {
  try {
    if (typeof localStorage === "undefined") return { services: [], groups: [] };
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { services: [], groups: [] };
    const p = JSON.parse(raw) as Partial<Persisted>;
    return { services: Array.isArray(p.services) ? p.services : [], groups: Array.isArray(p.groups) ? p.groups : [] };
  } catch { return { services: [], groups: [] }; }
}
function writeStore(p: Persisted): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* memory-only */ }
}

/** Groups defined by the CURRENT contract text — held per session so a
 *  contract's own definitions ("approved AI services, including X, Y, Z")
 *  resolve without the admin first saving them to the registry. */
let contractGroups: DestinationGroup[] = [];
export function setContractGroups(groups: DestinationGroup[]): void { contractGroups = groups; }
export function getContractGroups(): DestinationGroup[] { return contractGroups; }

export function allServices(): DestinationService[] {
  const extra = readStore().services;
  const byId = new Map<string, DestinationService>();
  for (const s of SERVICE_SEED) byId.set(s.id, s);
  for (const s of extra) byId.set(s.id, s);     // admin overrides seed
  return [...byId.values()];
}

export function allGroups(): DestinationGroup[] {
  const byId = new Map<string, DestinationGroup>();
  for (const g of readStore().groups) byId.set(g.id, g);
  for (const g of contractGroups) byId.set(g.id, g);  // contract definitions win for this session
  return [...byId.values()];
}

export function saveGroup(g: DestinationGroup): void {
  const p = readStore();
  p.groups = [...p.groups.filter((x) => x.id !== g.id), { ...g, origin: "registry" }];
  writeStore(p);
}

export function saveService(s: DestinationService): void {
  const p = readStore();
  p.services = [...p.services.filter((x) => x.id !== s.id), s];
  writeStore(p);
}

/* ------------------------------------------------------------------ *
 * Resolution — names → hosts. Deterministic. Never widens.
 * ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/** Find a service by id or alias. Whole-string match first, then a bounded
 *  substring match so "Microsoft Copilot (M365)" still resolves. */
export function findService(name: string): DestinationService | null {
  const n = norm(name);
  const services = allServices();
  for (const s of services) if (s.id === n || s.aliases.some((a) => norm(a) === n)) return s;
  // Whole-WORD phrase match, never a substring: "Microsoft Copilot (M365)"
  // contains the word "copilot"; "Notionary" does not contain the word
  // "notion" and must NOT resolve to Notion — that would route an unknown
  // vendor's traffic under a registered one's permissions.
  const words = n.replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  for (const s of services) {
    for (const a of s.aliases) {
      const aw = norm(a).split(" ").filter(Boolean);
      for (let i = 0; i + aw.length <= words.length; i++) {
        if (aw.every((w, j) => words[i + j] === w)) return s;
      }
    }
  }
  return null;
}

/** A group id from an admin's phrase ("approved AI services" → approved_ai). */
export function groupIdFor(label: string): string {
  return norm(label).replace(/\b(the|these|those|our|all)\b/g, "").trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "group";
}

export interface HostResolution {
  /** Concrete domain suffixes the runtime can match. Empty = unresolvable. */
  hosts: string[];
  /** Human trail: which names resolved to what, and which did not. */
  resolved: { name: string; hosts: string[] }[];
  unresolved: string[];
}

/** Resolve a list of service ids / aliases / raw hosts to domain suffixes. */
export function resolveNames(names: string[]): HostResolution {
  const out: HostResolution = { hosts: [], resolved: [], unresolved: [] };
  for (const raw of names) {
    const n = raw.trim();
    if (!n) continue;
    // A literal host/domain passes through as-is.
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(n)) { out.hosts.push(n.toLowerCase()); out.resolved.push({ name: n, hosts: [n.toLowerCase()] }); continue; }
    const svc = findService(n);
    if (svc) { out.hosts.push(...svc.hosts); out.resolved.push({ name: n, hosts: svc.hosts }); continue; }
    out.unresolved.push(n);
  }
  out.hosts = [...new Set(out.hosts)];
  return out;
}

/** Resolve a group id to hosts (members may be services or raw hosts). */
export function resolveGroup(groupId: string): HostResolution & { group: DestinationGroup | null } {
  const g = allGroups().find((x) => x.id === groupId || norm(x.label) === norm(groupId)) ?? null;
  if (!g) return { hosts: [], resolved: [], unresolved: [groupId], group: null };
  return { ...resolveNames(g.members), group: g };
}

/** Resolve a built-in category to hosts via its tagged member services. */
export function resolveCategory(category: string): HostResolution {
  const members = CATEGORY_MEMBERS[category] ?? [];
  return resolveNames(members);
}

/* ------------------------------------------------------------------ *
 * Host predicates — the regexes the runtime evaluates against tool_input.host.
 * ------------------------------------------------------------------ */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a host that IS one of the suffixes or a subdomain of one. */
export function hostInRegex(hosts: string[]): string {
  return `(^|\\.)(${hosts.map(escapeRe).join("|")})$`;
}

/** Matches any host that is NOT in the set — the complement. */
export function hostNotInRegex(hosts: string[]): string {
  return `^(?!(?:.*\\.)?(?:${hosts.map(escapeRe).join("|")})$).+$`;
}
