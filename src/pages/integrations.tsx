// Integrations — simulated enterprise connections. Each connection's status is
// derived from the capability registry (the same one Coverage uses), and its
// usage from the recorded events; nothing here is a typed-in figure.
import { useState } from "react";
import { useAppState } from "../state/store";
import {
  PageHead, Chip, StatusChip, SimNote, SectionHead, DecisionChip, names, timeAgo,
  MetricBar, Avatar, AgentMark, DestMark, PageTabs,
  EntityCard, CardGrid, FilterBar, Pager, useCardFilters, usePaged,
} from "../ui/kit";
import { ORG, RESOURCES, DEVICES, USERS, AGENTS, deviceById, userById, resourceById, agentById } from "../model/org";
import { ACTION_NORMALIZATION, CAPABILITIES, MCP_SERVERS } from "../model/registries";
import { logoUrl } from "../ui/logos";
import { describe } from "../ui/describe";
import { AgentTerminal } from "../ui/agent-terminal";
import { EventDetail } from "../ui/event-detail";
import { pipelineFor } from "../engine/simulate";
import { scenarioById } from "../engine/scenarios";
import type { SimulationEvent } from "../model/types";
import { Plug, Laptop, Fingerprint, Shuffle, ArrowRight, TerminalSquare, Share2 } from "lucide-react";

interface Connection {
  name: string; logo: string; kind: string; caps: string[]; detail: string;
  uses: (e: SimulationEvent) => boolean;
}

const enrolled = DEVICES.filter((d) => d.enrolled).length;
const discovered = AGENTS.filter((a) => a.discovered).length;

const CONNECTIONS: Connection[] = [
  { name: "GitHub Organization", logo: "github_light", kind: "Gateway connector", caps: ["cap-gw-github"],
    detail: `github.com/${ORG.slug} · push, PR and branch operations on checkout-service`,
    uses: (e) => e.application === "GitHub MCP" || (e.plane === "GATEWAY" && e.resource === "r-checkout") },
  { name: "PostgreSQL gateway", logo: "postgresql", kind: "Gateway connector", caps: ["cap-gw-sql"],
    detail: "payments-prod, customer-db · query preflight + row estimates",
    uses: (e) => e.application === "SQL MCP" || e.resource === "r-customer-db" || e.resource === "r-payments-prod" },
  { name: "AWS", logo: "aws", kind: "Gateway connector", caps: ["cap-gw-cloud"],
    detail: "Production and staging accounts",
    uses: (e) => e.application === "AWS API" || e.resource.startsWith("r-aws") },
  { name: "Stripe & support desk", logo: "stripe", kind: "Gateway connector", caps: ["cap-gw-saas"],
    detail: "Refunds, tickets and customer replies",
    uses: (e) => e.application === "Stripe API" || e.application === "Support SaaS API" || e.resource === "r-stripe" },
  { name: "macOS Endpoint runtime", logo: "wrapbox-icon", kind: "Endpoint plane", caps: ["cap-ep-file", "cap-ep-exec", "cap-ep-clipboard"],
    detail: `${enrolled} enrolled devices · file and process authorization`,
    uses: (e) => e.plane === "ENDPOINT" },
  { name: "Network Extension", logo: "wrapbox-icon", kind: "Network plane", caps: ["cap-net-https", "cap-net-quic", "cap-net-websocket", "cap-net-file"],
    detail: "What leaves each device for AI tools and other sites",
    uses: (e) => e.plane === "NETWORK" },
  { name: "MCP registry", logo: "mcp", kind: "Gateway connector", caps: ["cap-gw-mcp", "cap-ep-mcp-stdio"],
    detail: `${MCP_SERVERS.filter((m) => m.registered).length} registered MCP servers · ${MCP_SERVERS.filter((m) => !m.registered).length} unknown server discovered, not registered`,
    uses: (e) => !!e.mcp || !!AGENTS.find((a) => a.id === e.agent)?.discovered },
  { name: "Managed browser extension", logo: "chrome", kind: "Browser plane", caps: ["cap-br-extension"],
    detail: "Chrome and Edge, force-installed by policy · browser agents' page actions",
    uses: (e) => e.plane === "BROWSER" },
  { name: "AWS AgentCore Gateway", logo: "aws", kind: "Hosted agent plane", caps: ["cap-hosted-agentcore"],
    detail: "Wrapbox as the gateway's REQUEST interceptor · hosted agents' tool calls",
    uses: (e) => e.plane === "HOSTED" },
];

/** Ecosystem integrations — simulated representations only (no live APIs in the
 *  prototype). Each card says what the production integration would do; none of
 *  them participates in enforcement status or capability truth. */
const ECOSYSTEM: { name: string; logos?: string[]; icon?: "siem"; role: string; would: string; feeds: string; live?: string }[] = [
  { name: "Okta · Microsoft Entra", logos: ["okta", "microsoft"], role: "Identity & approver routing",
    would: "Users, devices and roles resolve from the IdP; approver routing (e.g. Finance Controller) follows directory group membership.",
    feeds: "Identity chain · Review Center routing" },
  { name: "Slack · Microsoft Teams", logos: ["slack", "teams"], role: "Approval delivery",
    would: "REVIEW requests arrive as actionable messages; an approve or deny writes back to the Review Center with the responder's identity.",
    feeds: "Review Center · Tasks (park / resume)" },
  { name: "SIEM export — OCSF / OpenTelemetry", icon: "siem", role: "Evidence export (e.g. Splunk)",
    would: "Export works today: Evidence downloads the records shown as OCSF 1.3.0 events or OTLP/JSON logs. Streaming them to a SIEM such as Splunk (HTTP Event Collector) is the part still simulated.",
    feeds: "Evidence ledger · Live Actions", live: "Export live · streaming simulated" },
];

const RANK: Record<string, number> = { ENFORCED: 0, DEGRADED: 1, UNDERSTOOD_ONLY: 2, UNINSPECTABLE: 3 };
const capOf = (id: string) => CAPABILITIES.find((c) => c.id === id)!;
/** Worst live capability; planned (PENDING) ones are listed but don't count yet. */
function statusOf(c: Connection): string {
  const live = c.caps.map(capOf).filter((x) => x.status !== "PENDING");
  return live.reduce((w, x) => ((RANK[x.status] ?? 0) > (RANK[w] ?? 0) ? x.status : w), "ENFORCED");
}

// Decorative brand mark for a governed resource / application — derived purely
// from the resource's own name and kind (no new data, no logic change).
function resLogo(r?: { name: string; kind: string }): string {
  const name = r?.name ?? "";
  if (/github/i.test(name) || r?.kind === "repo") return "github_light";
  if (r?.kind === "database") return "postgresql";
  if (r?.kind === "cloud") return "aws";
  if (/stripe/i.test(name)) return "stripe";
  if (/salesforce|support/i.test(name)) return "salesforce";
  if (r?.kind === "mcp") return "mcp";
  return "wrapbox-icon";
}
const APP_LOGO: Record<string, string> = {
  "GitHub MCP": "github_light", "SQL MCP": "postgresql", "AWS API": "aws",
  "Stripe API": "stripe", "Support SaaS API": "salesforce",
};

/** The coding agents Wrapbox governs — same org registry the Agents page uses. */
const CODING_AGENTS = AGENTS.filter((a) => a.kind === "coding");
const isCodingEvent = (e: SimulationEvent) => agentById(e.agent)?.kind === "coding";

export function IntegrationsPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [openEvt, setOpenEvt] = useState<SimulationEvent | null>(null);
  const statuses = CONNECTIONS.map(statusOf);
  const enforced = statuses.filter((x) => x === "ENFORCED").length;
  const degraded = statuses.filter((x) => x === "DEGRADED").length;
  const understood = statuses.filter((x) => x === "UNDERSTOOD_ONLY").length;
  const used = (c: Connection) => s.events.filter(c.uses).length;

  // Presentation only: search + filters for the resource and ontology card lists.
  const rf = useCardFilters(RESOURCES, {
    search: (r) => `${r.name} ${r.detail}`,
    filters: [
      { id: "kind", label: "Kind", get: (r) => r.kind },
      { id: "env", label: "Environment", get: (r) => r.environment },
      { id: "sens", label: "Sensitivity", get: (r) => r.sensitivity },
    ],
  });
  const rPaged = usePaged(rf.filtered, 8, rf.resetKey);
  const of = useCardFilters(ACTION_NORMALIZATION, {
    search: (a) => `${a.raw} ${a.via} ${a.verb}`,
    filters: [{ id: "verb", label: "Verb", get: (a) => a.verb }],
  });
  const oPaged = usePaged(of.filtered, 8, of.resetKey);

  // A real identity chain: the latest recorded action on the checkout code (the root), else the latest action.
  const byTime = [...s.events].sort((a, b) => b.timestamp - a.timestamp);
  const sample = byTime.find((e) => /checkout/i.test(names(e).resource)) ?? byTime[0];

  // The agent terminal replays the most recent recorded action a coding agent took —
  // the same event, scenario and pipeline stages the Simulation Lab rendered when it
  // ran. With no such action yet, the terminal shows the scenario prompt in its
  // pending state (no trace is invented).
  const codingEvents = s.events.filter(isCodingEvent);
  const codingEvt = byTime.find((e) => isCodingEvent(e) && e.scenario && scenarioById(e.scenario)) ?? null;
  const termScenario = (codingEvt?.scenario ? scenarioById(codingEvt.scenario) : undefined) ?? scenarioById("ep-run-tests");
  const termStages = codingEvt && termScenario ? pipelineFor(termScenario, codingEvt) : [];

  // Identity nodes — same values shown before, now logo-forward.
  const throughVal = sample ? (sample.application ?? sample.plane.toLowerCase()) : "";
  const throughLogo = sample?.application ? APP_LOGO[sample.application] : undefined;
  const chain = sample
    ? [
        { label: "User", value: userById(sample.user)?.name ?? sample.user,
          mark: <Avatar userId={sample.user} size={22} /> },
        { label: "Device", value: deviceById(sample.device)?.name ?? sample.device,
          mark: <Laptop size={16} style={{ color: "var(--fg-3)" }} /> },
        { label: "Agent", value: names(sample).agent,
          mark: <AgentMark agentId={sample.agent} size={18} /> },
        { label: "Through", value: throughVal,
          mark: throughLogo
            ? <img src={logoUrl(throughLogo)} alt="" className="logo-img" style={{ width: 18, height: 18 }} />
            : <Plug size={16} style={{ color: "var(--fg-3)" }} /> },
        { label: "On", value: names(sample).resource,
          mark: <img src={logoUrl(resLogo(resourceById(sample.resource)))} alt="" className="logo-img" style={{ width: 18, height: 18 }} /> },
        ...(sample.destination
          ? [{ label: "To", value: names(sample).destination ?? sample.destination,
              mark: <DestMark destId={sample.destination} size={18} /> }]
          : []),
      ]
    : [];

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="System"
        title="Integrations"
        sub="The places Wrapbox sits to see and stop agent actions. Each status comes from the capability list Coverage uses; each count comes from your recorded actions."
        right={<SimNote>All connections simulated</SimNote>}
      />

      {/* Enforcement posture — a slim refined strip, not a wall of number boxes */}
      <div className="card" style={{ padding: "16px 22px" }}>
        <MetricBar
          band
          items={[
            { label: "Connections", value: CONNECTIONS.length, note: `plus Okta SSO · ${USERS.length} users` },
            { label: "Enforced", value: enforced, tone: "good", note: "can stop actions inline", onClick: () => nav("coverage") },
            { label: "Degraded", value: degraded, tone: degraded > 0 ? "warn" : "good", note: "some parts only watched", onClick: () => nav("coverage") },
            { label: "Understood only", value: understood, tone: understood > 0 ? "info" : "good", note: "watched, can't stop yet", onClick: () => nav("coverage") },
          ]}
        />
      </div>

      <PageTabs storageKey="integrations" tabs={[
        {
          id: "connections",
          label: "Connected systems",
          count: CONNECTIONS.length,
          content: (
            <>
              {/* "Connect to any AI" — the decision engine behind every coding agent, shown
                  through the agent's own terminal replaying a real recorded action. */}
              {termScenario && (
                <section
                  // Intrinsic split: two columns while each can be ≥420px, otherwise the terminal stacks under the copy.
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "clamp(24px, 4vw, 56px)", alignItems: "center", padding: "10px 0 36px", marginBottom: 28, borderBottom: "1px solid var(--line)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="eyebrow row" style={{ gap: 7 }}>
                      <TerminalSquare size={13} /> Coding agents
                    </div>
                    <h2 className="feature-hero-title" style={{ fontSize: "clamp(26px, 2.6vw, 34px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.12, margin: "12px 0 0", color: "var(--fg)" }}>
                      Take action from anywhere
                    </h2>
                    <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg-2)", margin: "14px 0 0", maxWidth: 460 }}>
                      The same decision engine sits behind Claude Code, Cursor, Codex and your own agents. Every shell
                      command, file write and push is held, judged and recorded before it runs — the terminal on the
                      right is a real recorded action, replayed line for line.
                    </p>

                    {/* The coding agents the org actually governs, plus the IDE agent Wrapbox sits behind */}
                    <div className="row" style={{ gap: 8, marginTop: 20, flexWrap: "wrap" }}>
                      {CODING_AGENTS.map((a) => (
                        <span key={a.id} className="row small" style={{ gap: 8, padding: "6px 12px 6px 8px", borderRadius: 999, border: "1px solid var(--line-strong)", background: "var(--surface)", fontWeight: 550, cursor: "pointer" }} onClick={() => nav("agents")}>
                          <AgentMark agentId={a.id} size={16} /> {a.name}
                        </span>
                      ))}
                      <span className="row small" style={{ gap: 8, padding: "6px 12px 6px 8px", borderRadius: 999, border: "1px solid var(--line-strong)", background: "var(--surface)", fontWeight: 550 }}>
                        <img src={logoUrl("cursor")} alt="" className="logo-img" style={{ width: 16, height: 16 }} /> Cursor
                      </span>
                    </div>

                    {/* Derived from the store — the actions those agents actually took */}
                    <div className="small dim" style={{ marginTop: 18, lineHeight: 1.6 }}>
                      <span className="mono tnum" style={{ fontWeight: 700, color: "var(--fg)" }}>{codingEvents.length}</span>
                      {" "}action{codingEvents.length === 1 ? "" : "s"} recorded from {CODING_AGENTS.length} coding agent{CODING_AGENTS.length === 1 ? "" : "s"}
                      {codingEvt && (
                        <>
                          {" · latest "}
                          <span className="row" style={{ display: "inline-flex", gap: 6, verticalAlign: "middle" }}>
                            <DecisionChip d={codingEvt.decision} small />
                            <span className="faint">{timeAgo(codingEvt.timestamp)}</span>
                          </span>
                        </>
                      )}
                    </div>

                    <div className="row" style={{ gap: 10, marginTop: 22 }}>
                      <button className="btn btn-primary btn-lg" onClick={() => nav("simlab")}>Run a scenario <ArrowRight size={16} /></button>
                      <button className="btn btn-lg" onClick={() => nav("agents")}>View agents</button>
                    </div>
                  </div>

                  <div className="glow-soft" style={{ borderRadius: 18, minWidth: 0 }}>
                    <AgentTerminal
                      scenario={termScenario}
                      event={codingEvt}
                      stages={termStages}
                      visible={termStages.length}
                      onOpenEvidence={() => codingEvt && setOpenEvt(codingEvt)}
                    />
                  </div>
                </section>
              )}

              {CONNECTIONS.length === 0 ? (
                <div className="card empty">No connections configured yet.</div>
              ) : (
                <>
                  {/* The connections themselves, logo-forward. Enforcement tallies live in the MetricBar above. */}
                  <SectionHead title="Connected systems" sub="Where Wrapbox sits in each system, what it can enforce there, and how many recorded actions passed through" />
                  <CardGrid>
                    {CONNECTIONS.map((c, i) => (
                      <EntityCard
                        key={c.name}
                        icon={<img src={logoUrl(c.logo)} alt="" className="logo-img" style={{ width: 22, height: 22, objectFit: "contain" }} />}
                        eyebrow={c.kind}
                        title={c.name}
                        status={<StatusChip s={statuses[i]} />}
                        fields={[
                          { label: "Scope", value: <span className="dim">{c.detail}</span> },
                          ...c.caps.map(capOf).map((cap) => ({
                            label: cap.label,
                            value: <><StatusChip s={cap.status} /> <span className="faint">{cap.note}</span></>,
                          })),
                          { label: "Recorded actions", value: <span className="mono tnum" style={{ fontWeight: 700 }}>{used(c)}</span> },
                        ]}
                      />
                    ))}
                  </CardGrid>

                  {/* Simulated ecosystem cards — clearly labelled; they never count toward enforcement. */}
                  <SectionHead
                    title="Ecosystem integrations"
                    sub="How Wrapbox plugs into the identity, chat and SIEM tooling you already run. Identity and chat delivery are simulated; decision export is real, streaming is simulated."
                    right={<SimNote>No live third-party APIs in this prototype</SimNote>}
                  />
                  <CardGrid>
                    {ECOSYSTEM.map((x) => (
                      <EntityCard
                        key={x.name}
                        icon={x.icon === "siem"
                          ? <Share2 size={20} />
                          : <span className="row" style={{ gap: 4 }}>{x.logos!.map((l) => <img key={l} src={logoUrl(l)} alt="" className="logo-img" style={{ width: 20, height: 20, objectFit: "contain" }} />)}</span>}
                        eyebrow={x.role}
                        title={x.name}
                        status={<Chip tone={x.live ? "allow" : "neutral"}>{x.live ?? "Simulated"}</Chip>}
                        fields={[
                          { label: "Would provide", value: <span className="dim">{x.would}</span> },
                          { label: "Feeds", value: <span className="faint">{x.feeds}</span> },
                        ]}
                      />
                    ))}
                  </CardGrid>
                </>
              )}
            </>
          ),
        },
        {
          id: "identity",
          label: "Identity model",
          content: !sample ? (
            <div className="card empty">No actions recorded yet — run one in the Simulation Lab.</div>
          ) : (
            <>
              {/* The who/what/through/on chain from a real action */}
              <SectionHead title="Identity model" sub="Who, on which laptop, with which agent, through what, on what — taken from a real recorded action" />
              <div className="card">
                <div className="spread" style={{ marginBottom: 16, gap: 10 }}>
                  <span className="row" style={{ gap: 10, minWidth: 0 }}>
                    <DecisionChip d={sample.decision} />
                    <span className="small" style={{ fontWeight: 550 }}>{describe(sample)}</span>
                  </span>
                  <span className="faint mono small">{sample.id}</span>
                </div>

                <div className="row" style={{ gap: 0, rowGap: 12 }}>
                  {chain.map((nd, idx) => (
                    <span key={nd.label} className="row" style={{ gap: 0, flexWrap: "nowrap" }}>
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 9,
                          padding: "8px 13px", borderRadius: 10,
                          border: "1px solid var(--line)", background: "var(--surface-2)",
                        }}
                      >
                        {nd.mark}
                        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                          <span className="faint" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{nd.label}</span>
                          <span className="small" style={{ fontWeight: 550 }}>{nd.value}</span>
                        </span>
                      </span>
                      {idx < chain.length - 1 && (
                        <span style={{ color: "var(--fg-4)", padding: "0 6px", display: "inline-flex" }}><ArrowRight size={14} /></span>
                      )}
                    </span>
                  ))}
                </div>

                <div className="small dim" style={{ marginTop: 18, lineHeight: 1.55, display: "flex", gap: 8 }}>
                  <Fingerprint size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    User (from Okta SSO, simulated) + device + agent + tool + resource flow into every decision and
                    every evidence record. “Traffic came from Chrome” is never an identity.
                  </span>
                </div>
              </div>
            </>
          ),
        },
        {
          id: "resources",
          label: "Governed resources",
          count: RESOURCES.length,
          content: RESOURCES.length === 0 ? (
            <div className="card empty">No governed resources defined yet.</div>
          ) : (
            <>
              <SectionHead title="Governed resources" sub="The systems policy is written against, with environment and sensitivity" />
              <FilterBar {...rf.bar} placeholder="Search resources…" />
              {rf.filtered.length === 0 ? (
                <div className="card empty">No resources match these filters.</div>
              ) : (
                <CardGrid>
                  {rPaged.rows.map((r) => (
                    <EntityCard
                      key={r.id}
                      icon={<img src={logoUrl(resLogo(r))} alt="" className="logo-img" style={{ width: 22, height: 22 }} />}
                      eyebrow={r.kind}
                      title={r.name}
                      status={<Chip tone={r.sensitivity === "customer-impacting" ? "critical" : r.sensitivity === "sensitive" ? "high" : "neutral"}>{r.sensitivity}</Chip>}
                      fields={[
                        { label: "Kind", value: <Chip tone="neutral">{r.kind}</Chip> },
                        { label: "Environment", value: <Chip tone={r.environment === "production" ? "review" : "neutral"}>{r.environment}</Chip> },
                        { label: "Sensitivity", value: r.sensitivity },
                        { label: "Detail", value: <span className="dim">{r.detail}</span> },
                      ]}
                    />
                  ))}
                </CardGrid>
              )}
              <Pager {...rPaged} />
            </>
          ),
        },
        {
          id: "ontology",
          label: "Action ontology",
          count: ACTION_NORMALIZATION.length,
          content: ACTION_NORMALIZATION.length === 0 ? (
            <div className="card empty">No action normalizations registered yet.</div>
          ) : (
            <>
              {/* One verb, many mechanisms */}
              <SectionHead title="Action Ontology — normalization" sub="Different mechanisms normalize to one semantic verb, so policy is written once" />
              <FilterBar {...of.bar} placeholder="Search mechanisms…" />
              {of.filtered.length === 0 ? (
                <div className="card empty">No mechanisms match these filters.</div>
              ) : (
                <CardGrid>
                  {oPaged.rows.map((a) => (
                    <EntityCard
                      key={a.raw}
                      icon={<Shuffle size={18} style={{ color: "var(--fg-3)" }} />}
                      eyebrow={a.via}
                      title={<span className="mono">{a.raw}</span>}
                      status={<Chip tone="constrain">{a.verb}</Chip>}
                      fields={[
                        { label: "Raw mechanism", value: <span className="mono">{a.raw}</span> },
                        { label: "Via", value: <Chip tone="neutral">{a.via}</Chip> },
                        { label: "Normalized verb", value: <><ArrowRight size={13} style={{ color: "var(--fg-4)" }} /> <Chip tone="constrain">{a.verb}</Chip></> },
                      ]}
                    />
                  ))}
                </CardGrid>
              )}
              <Pager {...oPaged} />
              <div className="small faint row" style={{ gap: 6, marginTop: 12 }}>
                <Shuffle size={13} />
                Policy is written once against the verb. See it applied live in the{" "}
                <a onClick={() => nav("simlab")}>Simulation Lab</a>
                <ArrowRight size={12} />
              </div>
            </>
          ),
        },
      ]} />

      {openEvt && (
        <EventDetail
          e={s.events.find((x) => x.id === openEvt.id) ?? openEvt}
          onClose={() => setOpenEvt(null)}
          onNavigate={(r) => { setOpenEvt(null); nav(r); }}
        />
      )}
    </div>
  );
}
