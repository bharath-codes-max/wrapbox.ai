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
export type DestinationClass = "APPROVED_AI" | "KNOWN_AI_UNAPPROVED" | "APPROVED_SAAS" | "INTERNAL" | "PARTNER" | "GENERIC_EXTERNAL" | "UNKNOWN_EXTERNAL" | "PERSONAL_EXEMPT" | "INFRA_EXEMPT";
export declare const DESTINATION_CLASSES: DestinationClass[];
/** Pseudo-classes a policy may name; each expands to concrete classes. */
export declare const CLASS_GROUPS: Record<string, DestinationClass[]>;
export declare function expandClass(name: string): DestinationClass[];
export type ServiceKind = "ai" | "saas" | "code" | "storage" | "chat" | "search" | "infra" | "personal_finance" | "health" | "payroll" | "other";
export interface DestinationService {
    id: string;
    label: string;
    kind: ServiceKind;
    /** Domain suffixes: a host matches if it equals one or ends with "." + one. */
    hosts: string[];
    aliases: string[];
    /** Path-scoped overrides on a shared host, e.g. bing.com/chat is Copilot. */
    paths?: Array<{
        host: string;
        prefix: string;
        kind: ServiceKind;
        serviceId?: string;
    }>;
    /** "never" = Wrapbox will not decrypt this service by policy (privacy). */
    inspection?: "default" | "never";
}
export declare const SERVICE_SEED: DestinationService[];
/**
 * Exemption patterns: hosts Wrapbox declines to decrypt by policy. They are a
 * registry attribute (tenant-editable, shown in coverage), not a hidden list.
 * A catalogue service match ALWAYS takes precedence over these patterns.
 */
export interface ExemptionRule {
    pattern: string;
    class: "PERSONAL_EXEMPT" | "INFRA_EXEMPT";
    label: string;
}
export declare const EXEMPTION_SEED: ExemptionRule[];
export interface TenantDestinationConfig {
    tenant: string;
    approvedAi: string[];
    approvedSaas: string[];
    internalDomains: string[];
    partnerDomains: string[];
    extraServices: DestinationService[];
    exemptions: ExemptionRule[];
    /** Admin-defined named sets, e.g. approved_ai → [chatgpt, claude, copilot]. */
    groups: Array<{
        id: string;
        label: string;
        members: string[];
    }>;
}
export declare const EMPTY_TENANT: TenantDestinationConfig;
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
export declare class DestinationRegistry {
    readonly version: string;
    private services;
    private tenant;
    private exemptions;
    constructor(tenant?: TenantDestinationConfig, seed?: DestinationService[], version?: string);
    tenantConfig(): TenantDestinationConfig;
    allServices(): DestinationService[];
    service(id: string): DestinationService | undefined;
    /** Find a service by id or alias (whole-word phrase match, never substring). */
    findService(name: string): DestinationService | null;
    /** The service whose host suffix matches (longest suffix wins), honouring path overrides. */
    serviceForHost(host: string, path?: string): DestinationService | null;
    /** Classify one host. Deterministic; every host gets a class. */
    classify(host: string, path?: string): HostClassification;
    /** Whether the runtime may decrypt traffic to this host (replaces DEFAULT_NO_INSPECT). */
    shouldInspect(host: string, path?: string): boolean;
    /** Hosts for a set of service ids / aliases / literal domains. Never widens. */
    resolveNames(names: string[]): {
        hosts: string[];
        resolved: {
            name: string;
            hosts: string[];
        }[];
        unresolved: string[];
    };
    /** Hosts of every service in a class (for coverage display; runtime uses classify()). */
    hostsForClass(cls: DestinationClass): string[];
    private classifyService;
    /** Regex the network plane evaluates against tool_input.host for a host set. */
    static hostInRegex(hosts: string[]): string;
    static hostNotInRegex(hosts: string[]): string;
}
export declare function destinations(): DestinationRegistry;
export declare function setDestinationRegistry(r: DestinationRegistry | null): void;
