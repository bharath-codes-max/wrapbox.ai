/**
 * Destination Registry — how a host becomes a CLASS the policy can reason about.
 *
 * The old model had one closed catalogue ("external AI" = nine vendors) and a
 * hidden never-decrypt list in the daemon. Both are replaced by:
 *
 *   catalogue   services the product knows (hosts, kind, aliases, path rules)
 *   tenant      what THIS tenant approved, owns, partners with, or exempts
 *   classes     a small closed set every host resolves into — INCLUDING hosts
 *               nobody has ever catalogued (UNKNOWN_EXTERNAL), so a policy on
 *               ANY_EXTERNAL covers the AI service that launches tomorrow
 *
 * Classification runs on the DEVICE per request (the daemon emits
 * `tool_input.destination_class`), not only at compile time. That is what
 * closes the "uncatalogued destination escapes the protection" gap.
 *
 * Exemptions (an employee's bank, doctor, payroll; OS update and certificate
 * infrastructure) are first-class classes with `inspection: "never"`, declared
 * in coverage on every clause they exclude, and tenant-editable. A catalogue
 * SERVICE always wins over an exemption pattern: `copilot.microsoft.com` is
 * Copilot, never "Microsoft infrastructure".
 */

export type DestinationClass =
  | "APPROVED_AI" | "KNOWN_AI_UNAPPROVED" | "APPROVED_SAAS" | "INTERNAL" | "PARTNER"
  | "GENERIC_EXTERNAL" | "UNKNOWN_EXTERNAL" | "PERSONAL_EXEMPT" | "INFRA_EXEMPT";

export const DESTINATION_CLASSES: DestinationClass[] = [
  "APPROVED_AI", "KNOWN_AI_UNAPPROVED", "APPROVED_SAAS", "INTERNAL", "PARTNER",
  "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL", "PERSONAL_EXEMPT", "INFRA_EXEMPT",
];

/** Pseudo-classes a policy may name; each expands to concrete classes. */
export const CLASS_GROUPS: Record<string, DestinationClass[]> = {
  ANY_EXTERNAL: ["APPROVED_AI", "KNOWN_AI_UNAPPROVED", "APPROVED_SAAS", "PARTNER", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL"],
  ANY_AI: ["APPROVED_AI", "KNOWN_AI_UNAPPROVED"],
  ANY_UNAPPROVED: ["KNOWN_AI_UNAPPROVED", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL"],
  EXEMPT: ["PERSONAL_EXEMPT", "INFRA_EXEMPT"],
};

export function expandClass(name: string): DestinationClass[] {
  if (Object.hasOwn(CLASS_GROUPS, name)) return CLASS_GROUPS[name];
  return DESTINATION_CLASSES.includes(name as DestinationClass) ? [name as DestinationClass] : [];
}

export type ServiceKind = "ai" | "saas" | "code" | "storage" | "chat" | "search" | "infra" | "personal_finance" | "health" | "payroll" | "other";

export interface DestinationService {
  id: string;
  label: string;
  kind: ServiceKind;
  /** Domain suffixes: a host matches if it equals one or ends with "." + one. */
  hosts: string[];
  aliases: string[];
  /** Path-scoped overrides on a shared host, e.g. bing.com/chat is Copilot. */
  paths?: Array<{ host: string; prefix: string; kind: ServiceKind; serviceId?: string }>;
  /** "never" = Wrapbox will not decrypt this service by policy (privacy). */
  inspection?: "default" | "never";
}

export const SERVICE_SEED: DestinationService[] = [
  { id: "chatgpt", label: "ChatGPT", kind: "ai", hosts: ["chatgpt.com", "openai.com", "oaiusercontent.com", "oaistatic.com"], aliases: ["chatgpt", "chat gpt", "openai", "open ai", "gpt"] },
  { id: "claude", label: "Claude", kind: "ai", hosts: ["claude.ai", "anthropic.com"], aliases: ["claude", "anthropic", "claude ai"] },
  { id: "copilot", label: "Microsoft Copilot", kind: "ai", hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft", "m365.cloud.microsoft", "githubcopilot.com", "copilot.github.com"],
    aliases: ["copilot", "microsoft copilot", "ms copilot", "github copilot", "m365 copilot", "microsoft 365 copilot"],
    paths: [{ host: "bing.com", prefix: "/chat", kind: "ai", serviceId: "copilot" }, { host: "bing.com", prefix: "/copilot", kind: "ai", serviceId: "copilot" }] },
  { id: "bing", label: "Bing", kind: "search", hosts: ["bing.com"], aliases: ["bing", "bing search"] },
  { id: "gemini", label: "Gemini", kind: "ai", hosts: ["gemini.google.com", "generativelanguage.googleapis.com", "aistudio.google.com"], aliases: ["gemini", "google gemini", "bard", "google ai"] },
  { id: "perplexity", label: "Perplexity", kind: "ai", hosts: ["perplexity.ai"], aliases: ["perplexity"] },
  { id: "mistral", label: "Mistral", kind: "ai", hosts: ["mistral.ai"], aliases: ["mistral", "le chat"] },
  { id: "cursor", label: "Cursor", kind: "ai", hosts: ["cursor.com", "cursor.sh"], aliases: ["cursor"] },
  { id: "deepseek", label: "DeepSeek", kind: "ai", hosts: ["deepseek.com"], aliases: ["deepseek"] },
  { id: "grok", label: "Grok", kind: "ai", hosts: ["x.ai", "grok.com"], aliases: ["grok", "xai"] },
  { id: "huggingface", label: "Hugging Face", kind: "ai", hosts: ["huggingface.co"], aliases: ["hugging face", "huggingface"] },
  { id: "github", label: "GitHub", kind: "code", hosts: ["github.com", "githubusercontent.com"], aliases: ["github"] },
  { id: "gitlab", label: "GitLab", kind: "code", hosts: ["gitlab.com"], aliases: ["gitlab"] },
  { id: "slack", label: "Slack", kind: "chat", hosts: ["slack.com"], aliases: ["slack"] },
  { id: "notion", label: "Notion", kind: "saas", hosts: ["notion.so", "notion.site"], aliases: ["notion"] },
  { id: "gdrive", label: "Google Drive", kind: "storage", hosts: ["drive.google.com", "docs.google.com"], aliases: ["google drive", "gdrive", "google docs"] },
  { id: "dropbox", label: "Dropbox", kind: "storage", hosts: ["dropbox.com"], aliases: ["dropbox"] },
  { id: "pastebin", label: "Pastebin", kind: "other", hosts: ["pastebin.com"], aliases: ["pastebin"] },
  { id: "httpbin", label: "httpbin (test echo)", kind: "other", hosts: ["httpbin.org"], aliases: ["httpbin"] },
];

/**
 * Exemption patterns: hosts Wrapbox declines to decrypt by policy. They are a
 * registry attribute (tenant-editable, shown in coverage), not a hidden list.
 * A catalogue service match ALWAYS takes precedence over these patterns.
 */
export interface ExemptionRule { pattern: string; class: "PERSONAL_EXEMPT" | "INFRA_EXEMPT"; label: string }
export const EXEMPTION_SEED: ExemptionRule[] = [
  // Personal finance
  { pattern: "(^|\\.)bank(ing)?\\.", class: "PERSONAL_EXEMPT", label: "banking" },
  { pattern: "(^|\\.)chase\\.com$", class: "PERSONAL_EXEMPT", label: "banking" },
  { pattern: "(^|\\.)hdfcbank\\.com$", class: "PERSONAL_EXEMPT", label: "banking" },
  { pattern: "(^|\\.)icicibank\\.com$", class: "PERSONAL_EXEMPT", label: "banking" },
  { pattern: "(^|\\.)sbi\\.co\\.in$", class: "PERSONAL_EXEMPT", label: "banking" },
  { pattern: "(^|\\.)paypal\\.com$", class: "PERSONAL_EXEMPT", label: "payments" },
  { pattern: "(^|\\.)stripe\\.com$", class: "PERSONAL_EXEMPT", label: "payments" },
  { pattern: "(^|\\.)razorpay\\.com$", class: "PERSONAL_EXEMPT", label: "payments" },
  // Health
  { pattern: "(^|\\.)health\\.", class: "PERSONAL_EXEMPT", label: "health" },
  { pattern: "(^|\\.)nhs\\.uk$", class: "PERSONAL_EXEMPT", label: "health" },
  { pattern: "(^|\\.)practo\\.com$", class: "PERSONAL_EXEMPT", label: "health" },
  // Payroll / HR self-service
  { pattern: "(^|\\.)payroll\\.", class: "PERSONAL_EXEMPT", label: "payroll" },
  { pattern: "(^|\\.)adp\\.com$", class: "PERSONAL_EXEMPT", label: "payroll" },
  { pattern: "(^|\\.)gusto\\.com$", class: "PERSONAL_EXEMPT", label: "payroll" },
  { pattern: "(^|\\.)workday\\.com$", class: "PERSONAL_EXEMPT", label: "payroll" },
  // OS, certificate and update infrastructure — pinned; breaking them breaks the machine.
  { pattern: "(^|\\.)apple\\.com$", class: "INFRA_EXEMPT", label: "Apple infrastructure" },
  { pattern: "(^|\\.)icloud\\.com$", class: "INFRA_EXEMPT", label: "Apple infrastructure" },
  { pattern: "(^|\\.)mzstatic\\.com$", class: "INFRA_EXEMPT", label: "Apple infrastructure" },
  { pattern: "(^|\\.)windowsupdate\\.com$", class: "INFRA_EXEMPT", label: "Microsoft update infrastructure" },
  // Narrowed from the old blanket microsoft.com: only the pinned infrastructure
  // subdomains. copilot.microsoft.com is a catalogue service and is inspected.
  { pattern: "^(login|update|download|settings-win|ctldl\\.windowsupdate|go|aka)\\.microsoft(online)?\\.com$", class: "INFRA_EXEMPT", label: "Microsoft sign-in/update infrastructure" },
  { pattern: "(^|\\.)ocsp\\.", class: "INFRA_EXEMPT", label: "certificate status" },
  { pattern: "(^|\\.)crl\\.", class: "INFRA_EXEMPT", label: "certificate revocation" },
  { pattern: "(^|\\.)pki\\.", class: "INFRA_EXEMPT", label: "certificate infrastructure" },
  { pattern: "^localhost$", class: "INFRA_EXEMPT", label: "local" },
  { pattern: "^127\\.", class: "INFRA_EXEMPT", label: "local" },
  { pattern: "^::1$", class: "INFRA_EXEMPT", label: "local" },
  { pattern: "\\.local$", class: "INFRA_EXEMPT", label: "local" },
];

export interface TenantDestinationConfig {
  tenant: string;
  approvedAi: string[];        // service ids
  approvedSaas: string[];      // service ids (kind saas/code/storage/chat)
  internalDomains: string[];   // suffixes
  partnerDomains: string[];    // suffixes
  extraServices: DestinationService[];
  exemptions: ExemptionRule[]; // replaces the seed when non-empty
  /** Admin-defined named sets, e.g. approved_ai → [chatgpt, claude, copilot]. */
  groups: Array<{ id: string; label: string; members: string[] }>;
}

export const EMPTY_TENANT: TenantDestinationConfig = {
  tenant: "default", approvedAi: [], approvedSaas: [], internalDomains: [], partnerDomains: [], extraServices: [], exemptions: [], groups: [],
};

export interface HostClassification {
  host: string;
  class: DestinationClass;
  service?: string;
  serviceLabel?: string;
  kind?: ServiceKind;
  /** Whether the runtime may decrypt and inspect traffic to this host. */
  inspection: "default" | "never";
  /** How the class was decided, for evidence. */
  via: "service" | "internal" | "partner" | "exemption" | "catalogue" | "unknown";
}

const norm = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith("." + suffix);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class DestinationRegistry {
  readonly version: string;
  private services: DestinationService[];
  private tenant: TenantDestinationConfig;
  private exemptions: Array<ExemptionRule & { re: RegExp }>;

  constructor(tenant: TenantDestinationConfig = EMPTY_TENANT, seed: DestinationService[] = SERVICE_SEED, version = "1.0.0") {
    this.version = version;
    this.tenant = tenant;
    const byId = new Map<string, DestinationService>();
    for (const s of seed) byId.set(s.id, s);
    for (const s of tenant.extraServices) byId.set(s.id, s);   // tenant overrides seed
    this.services = [...byId.values()];
    const ex = tenant.exemptions.length ? tenant.exemptions : EXEMPTION_SEED;
    this.exemptions = ex.map((e) => ({ ...e, re: new RegExp(e.pattern, "i") }));
  }

  tenantConfig(): TenantDestinationConfig { return this.tenant; }
  allServices(): DestinationService[] { return this.services; }
  service(id: string): DestinationService | undefined { return this.services.find((s) => s.id === id); }

  /** Find a service by id or alias (whole-word phrase match, never substring). */
  findService(name: string): DestinationService | null {
    const n = norm(name);
    for (const s of this.services) if (s.id === n || s.aliases.some((a) => norm(a) === n)) return s;
    const words = n.replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
    for (const s of this.services) {
      for (const a of s.aliases) {
        const aw = norm(a).split(" ").filter(Boolean);
        for (let i = 0; i + aw.length <= words.length; i++) if (aw.every((w, j) => words[i + j] === w)) return s;
      }
    }
    return null;
  }

  /** The service whose host suffix matches (longest suffix wins), honouring path overrides. */
  serviceForHost(host: string, path = ""): DestinationService | null {
    const h = host.toLowerCase().replace(/\.$/, "");
    // Path overrides first (bing.com/chat → copilot).
    for (const s of this.services) for (const p of s.paths ?? []) {
      if (hostMatches(h, p.host) && path.startsWith(p.prefix)) return this.service(p.serviceId ?? s.id) ?? s;
    }
    let best: { s: DestinationService; len: number } | null = null;
    for (const s of this.services) for (const suf of s.hosts) {
      if (hostMatches(h, suf) && (!best || suf.length > best.len)) best = { s, len: suf.length };
    }
    return best?.s ?? null;
  }

  /** Classify one host. Deterministic; every host gets a class. */
  classify(host: string, path = ""): HostClassification {
    const h = host.toLowerCase().replace(/\.$/, "");
    const t = this.tenant;
    // 1. Tenant-internal domains and private address space.
    if (t.internalDomains.some((d) => hostMatches(h, d.toLowerCase())) || isPrivateAddress(h)) {
      return { host: h, class: "INTERNAL", inspection: "default", via: "internal" };
    }
    // 2. Catalogue service (wins over exemption patterns).
    const svc = this.serviceForHost(h, path);
    if (svc) {
      const inspection = svc.inspection ?? "default";
      const base = { host: h, service: svc.id, serviceLabel: svc.label, kind: svc.kind, inspection, via: "service" as const };
      if (svc.kind === "ai") return { ...base, class: t.approvedAi.includes(svc.id) ? "APPROVED_AI" : "KNOWN_AI_UNAPPROVED" };
      if (["personal_finance", "health", "payroll"].includes(svc.kind)) return { ...base, class: "PERSONAL_EXEMPT", inspection: "never" };
      if (svc.kind === "infra") return { ...base, class: "INFRA_EXEMPT", inspection: "never" };
      return { ...base, class: t.approvedSaas.includes(svc.id) ? "APPROVED_SAAS" : "GENERIC_EXTERNAL" };
    }
    // 3. Partner domains.
    if (t.partnerDomains.some((d) => hostMatches(h, d.toLowerCase()))) {
      return { host: h, class: "PARTNER", inspection: "default", via: "partner" };
    }
    // 4. Exemptions.
    for (const e of this.exemptions) if (e.re.test(h)) {
      return { host: h, class: e.class, inspection: "never", via: "exemption", serviceLabel: e.label };
    }
    // 5. Everything else is an external host nobody catalogued.
    return { host: h, class: "UNKNOWN_EXTERNAL", inspection: "default", via: "unknown" };
  }

  /** Whether the runtime may decrypt traffic to this host (replaces DEFAULT_NO_INSPECT). */
  shouldInspect(host: string, path = ""): boolean {
    return this.classify(host, path).inspection === "default";
  }

  /** Hosts for a set of service ids / aliases / literal domains. Never widens. */
  resolveNames(names: string[]): { hosts: string[]; resolved: { name: string; hosts: string[] }[]; unresolved: string[] } {
    const out = { hosts: [] as string[], resolved: [] as { name: string; hosts: string[] }[], unresolved: [] as string[] };
    for (const raw of names) {
      const n = raw.trim();
      if (!n) continue;
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(n)) { out.hosts.push(n.toLowerCase()); out.resolved.push({ name: n, hosts: [n.toLowerCase()] }); continue; }
      const svc = this.findService(n);
      if (svc) { out.hosts.push(...svc.hosts); out.resolved.push({ name: n, hosts: svc.hosts }); continue; }
      out.unresolved.push(n);
    }
    out.hosts = [...new Set(out.hosts)];
    return out;
  }

  /** Hosts of every service in a class (for coverage display; runtime uses classify()). */
  hostsForClass(cls: DestinationClass): string[] {
    const t = this.tenant;
    const hosts: string[] = [];
    for (const s of this.services) {
      const c = this.classifyService(s);
      if (c === cls) hosts.push(...s.hosts);
    }
    if (cls === "INTERNAL") hosts.push(...t.internalDomains);
    if (cls === "PARTNER") hosts.push(...t.partnerDomains);
    return [...new Set(hosts)];
  }

  private classifyService(s: DestinationService): DestinationClass {
    const t = this.tenant;
    if (s.kind === "ai") return t.approvedAi.includes(s.id) ? "APPROVED_AI" : "KNOWN_AI_UNAPPROVED";
    if (["personal_finance", "health", "payroll"].includes(s.kind)) return "PERSONAL_EXEMPT";
    if (s.kind === "infra") return "INFRA_EXEMPT";
    return t.approvedSaas.includes(s.id) ? "APPROVED_SAAS" : "GENERIC_EXTERNAL";
  }

  /** Regex the network plane evaluates against tool_input.host for a host set. */
  static hostInRegex(hosts: string[]): string { return `(^|\\.)(${hosts.map(escapeRe).join("|")})$`; }
  static hostNotInRegex(hosts: string[]): string { return `^(?!(?:.*\\.)?(?:${hosts.map(escapeRe).join("|")})$).+$`; }
}

function isPrivateAddress(h: string): boolean {
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  return false;
}

let defaultDest: DestinationRegistry | null = null;
export function destinations(): DestinationRegistry {
  if (!defaultDest) defaultDest = new DestinationRegistry();
  return defaultDest;
}
export function setDestinationRegistry(r: DestinationRegistry | null): void { defaultDest = r; }
