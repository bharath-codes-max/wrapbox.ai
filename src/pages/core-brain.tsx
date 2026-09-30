// Core Brain — the one decision engine. The check order below is the real order
// in engine/brain.ts decide(), and each count is how many recorded actions that
// step decided (event.decidedBy), so the page can't drift from the engine.
import type { ReactNode } from "react";
import { useAppState } from "../state/store";
import { PageHead, SectionHead, Chip, StatusChip, SimNote, DecisionChip, MetricBar, Avatar, AgentMark, DestMark, PageTabs, timeAgo, EntityCard, CardGrid, useCardFilters, FilterBar, usePaged, Pager } from "../ui/kit";
import { describe } from "../ui/describe";
import type { DecidedBy } from "../model/types";
import { DETECTORS, CAPABILITIES, TRANSFORMS } from "../model/registries";
import { ScanSearch, Shuffle, ShieldCheck, Cpu, Laptop, Network, Server, ArrowRight, ArrowDown, Undo2, Lock, Globe, Cloud } from "lucide-react";

function Block({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  return (
    <div className="card">
      <b className="small" style={tone ? { color: `var(--${tone})` } : undefined}>{title}</b>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
        {items.map((i) => (
          <div key={i} className="row small" style={{ gap: 9, flexWrap: "nowrap" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: tone ? `var(--${tone})` : "var(--fg-4)" }} />
            <span className="dim">{i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ORDER: { layer: DecidedBy["layer"]; name: string; asks: string; page?: [string, string] }[] = [
  { layer: "killswitch", name: "Kill switch", asks: "Has someone stopped this agent — or any agent in its delegation chain — everywhere? Then no, before anything else.", page: ["agents", "Agent Inventory"] },
  { layer: "uninspectable", name: "Can we see inside?", asks: "If the content can't be read (e.g. an encrypted zip) and a rule protects that kind of data, stop — fail closed." },
  { layer: "contract", name: "Your rules", asks: "Which of your Intent Contract rules match this action? The strictest one wins.", page: ["intent", "Intent Studio"] },
  { layer: "safety", name: "Safety Kernel", asks: "Does a built-in, always-on rule say no? Your rules can't switch these off.", page: ["safety", "Safety Kernel"] },
  { layer: "supplier", name: "Supplier contract", asks: "Is this agent run by a supplier? Then only what its contract covers, and nothing once the contract ends.", page: ["agents", "Agent Inventory"] },
  { layer: "blast", name: "Blast radius", asks: "How much could this break — rows, files, services? Too big means it waits for a yes.", page: ["simlab", "Simulation Lab"] },
  { layer: "context", name: "Context", asks: "Is this production, or privileged? Risky verbs there need a yes even without a rule.", page: ["simlab", "Simulation Lab"] },
  { layer: "injection", name: "Untrusted input", asks: "Did this agent just read untrusted content (a web page, an outside issue or email)? Its next risky action waits for a person.", page: ["simlab/agentic", "Simulation Lab"] },
  { layer: "output", name: "Output check", asks: "Does what the agent says match the result Wrapbox sealed when the real system answered?", page: ["simlab/agentic", "Simulation Lab"] },
  { layer: "envelope", name: "Task permission slip", asks: "Inside a task: is this within the slip's systems, actions, time and file budget?", page: ["tasks", "Tasks"] },
  { layer: "standing", name: "Standing permission", asks: "Outside a task: does this agent have everyday permission here, within its limits?", page: ["standing", "Standing Permissions"] },
  { layer: "delegation", name: "Delegation chain", asks: "Was this asked for by another agent? Every agent in the chain is checked — authority can't grow along it.", page: ["simlab/agentic", "Simulation Lab"] },
  { layer: "breakglass", name: "Break Glass", asks: "Is an emergency override on for exactly this system? It can lift a hold — never a Safety Kernel no.", page: ["breakglass", "Break Glass"] },
  { layer: "default", name: "Nothing objected", asks: "No rule restricts this action, so it's allowed and recorded." },
];

const PLANES = [
  { icon: <Laptop size={17} />, name: "Endpoint", desc: "local actions on the laptop" },
  { icon: <Network size={17} />, name: "Network", desc: "traffic & data in flight" },
  { icon: <Server size={17} />, name: "Gateway", desc: "resources, systems & MCP tools" },
  { icon: <Globe size={17} />, name: "Browser", desc: "browser agents' page actions" },
  { icon: <Cloud size={17} />, name: "Hosted", desc: "agents on hosted platforms" },
];

const PLANE_ICON: Record<string, ReactNode> = {
  ENDPOINT: <Laptop size={16} />, NETWORK: <Network size={16} />, GATEWAY: <Server size={16} />, BROWSER: <Globe size={16} />, HOSTED: <Cloud size={16} />, BRAIN: <Cpu size={16} />,
};
const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

const INPUTS = ["WHO", "DEVICE", "AGENT", "DELEGATION CHAIN", "ACTION", "MCP TOOL + ARGUMENTS", "RESOURCE", "DATA", "DESTINATION", "CONTEXT", "RECENT UNTRUSTED INPUT", "INTENT CONTRACT", "SAFETY KERNEL", "SUPPLIER CONTRACT", "TASK / STANDING AUTHORITY"];

export function CoreBrainPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const decided = (l: string) => s.events.filter((e) => e.decidedBy?.layer === l).length;
  const byTime = [...s.events].sort((a, b) => b.timestamp - a.timestamp);
  const root = byTime.find((e) => /checkout/i.test(e.resource)) ?? byTime[0];
  const detectorsEnforced = DETECTORS.filter((d) => d.status === "ENFORCED").length;
  const transformsReversible = TRANSFORMS.filter((t) => t.reversible).length;
  const capsEnforced = CAPABILITIES.filter((c) => c.status === "ENFORCED").length;
  const planeCount = new Set(CAPABILITIES.filter((c) => c.plane !== "BRAIN").map((c) => c.plane)).size;
  const capabilityGaps = CAPABILITIES.filter((c) => c.status !== "ENFORCED");

  const detF = useCardFilters(DETECTORS, {
    search: (d) => `${d.id} ${d.method} ${d.detects.join(" ")}`,
    filters: [
      { id: "status", label: "Status", get: (d) => d.status, format: titleCase },
      { id: "detects", label: "Detects", get: (d) => d.detects },
    ],
  });
  const detPaged = usePaged(detF.filtered, 8, detF.resetKey);

  const trF = useCardFilters(TRANSFORMS, {
    search: (t) => `${t.kind} ${t.label} ${t.example}`,
    filters: [{ id: "rev", label: "Reversible", get: (t) => (t.reversible ? "yes" : "no"), format: (v) => (v === "yes" ? "Reversible" : "Irreversible") }],
  });
  const trPaged = usePaged(trF.filtered, 8, trF.resetKey);

  const capF = useCardFilters(capabilityGaps, {
    search: (c) => `${c.label} ${c.note} ${c.plane}`,
    filters: [
      { id: "plane", label: "Plane", get: (c) => c.plane, format: titleCase },
      { id: "status", label: "Status", get: (c) => c.status, format: titleCase },
    ],
  });
  const capPaged = usePaged(capF.filtered, 8, capF.resetKey);

  return (
    <div className="page">
      <PageHead
        eyebrow="System"
        title="Core Brain"
        sub="The one engine that makes every decision you've seen — from the laptop, the network and the gateways alike. Same checks, same order, every time, with the reasons written down."
        right={<SimNote>Architecture view — components simulated, decision flow real</SimNote>}
      />

      <div className="card" style={{ padding: "10px 22px" }}>
        <MetricBar
          band
          items={[
            { label: "Decisions made", value: s.events.length, note: `${planeCount} planes · one brain`, tone: "info", onClick: () => nav("evidence") },
            { label: "Detectors", value: DETECTORS.length, note: `${detectorsEnforced} enforced`, tone: "good" },
            { label: "Transforms", value: TRANSFORMS.length, note: `${transformsReversible} reversible` },
            { label: "Capabilities", value: CAPABILITIES.length, note: `${capsEnforced} enforced`, tone: "good", onClick: () => nav("coverage") },
          ]}
        />
      </div>

      <PageTabs storageKey="brain" tabs={[
        { id: "decides", label: "How it decides", count: ORDER.length, content: (
          <div>
            {/* Lead — the decision console: a proven decision, then every gate it ran through */}
            <SectionHead
              title="How the brain decides"
              sub="Every action runs through these gates in this exact order. The first one that objects wins. The count is how many of your recorded actions each gate decided."
            />

            {root && (
              <div
                className="card"
                style={{ background: "var(--accent-soft)", borderColor: "color-mix(in oklab, var(--accent) 28%, var(--surface))" }}
              >
                <div className="spread">
                  <span className="eyebrow" style={{ color: "var(--accent)" }}>Latest action on your checkout code</span>
                  <span className="small faint mono">{timeAgo(root.timestamp)}</span>
                </div>
                <div className="row" style={{ gap: 10, marginTop: 12 }}>
                  <Avatar userId={root.user} size={26} />
                  <AgentMark agentId={root.agent} size={18} />
                  {root.destination && <DestMark destId={root.destination} size={16} />}
                  <DecisionChip d={root.decision} />
                  <b style={{ minWidth: 0 }}>{describe(root)}</b>
                </div>
                <div className="row small" style={{ gap: 8, marginTop: 10 }}>
                  <span className="faint">Decided by</span>
                  <span className="dim" style={{ fontWeight: 550 }}>{root.decidedBy?.label ?? "—"}</span>
                  <span className="faint mono">· {root.id}</span>
                </div>
              </div>
            )}

            <div style={{ marginTop: root ? 16 : 0 }}>
              <CardGrid cols={3}>
                {ORDER.map((o, i) => {
                  const n = decided(o.layer);
                  return (
                    <EntityCard
                      key={o.layer}
                      icon={<span className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>{i + 1}</span>}
                      eyebrow={`Step ${i + 1}`}
                      title={o.name}
                      status={<Chip tone={n > 0 ? "violet" : "neutral"}>Decided {n}</Chip>}
                      fields={[{ label: "What it asks", value: <span className="dim">{o.asks}</span> }]}
                    >
                      {/* The link sits under the card body: in a three-column grid a button beside the
                          title squeezed short names like "Context" into two broken lines. */}
                      {o.page && (
                        <div style={{ marginTop: 12 }}>
                          <button className="btn btn-sm" onClick={() => nav(o.page![0])}>{o.page[1]} <ArrowRight size={12} /></button>
                        </div>
                      )}
                    </EntityCard>
                  );
                })}
              </CardGrid>
            </div>
          </div>
        ) },
        { id: "architecture", label: "Architecture", content: (
          <div>
            <SectionHead title="One brain, three arms" sub="Every plane routes to a single deterministic decision engine that returns one of four outcomes" />
            <div className="card">
              <div className="grid g3">
                {PLANES.map((p) => (
                  <div
                    key={p.name}
                    className="row"
                    style={{ gap: 12, justifyContent: "center", padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--r)", background: "var(--surface-2)" }}
                  >
                    <span className="plane-icon">{p.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="small" style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="small faint">{p.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="row" style={{ justifyContent: "center", padding: "8px 0" }}>
                <ArrowDown size={18} style={{ color: "var(--fg-4)" }} />
              </div>

              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 13, padding: "16px 20px", borderRadius: "var(--r)", background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--surface))" }}
              >
                <span style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--accent-fg)", flexShrink: 0 }}>
                  <Cpu size={21} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>Wrapbox Core Brain</div>
                  <div className="small dim">One decision engine · five enforcement planes · same order every time</div>
                </div>
              </div>

              <div className="row" style={{ justifyContent: "center", padding: "8px 0" }}>
                <ArrowDown size={18} style={{ color: "var(--fg-4)" }} />
              </div>

              <div className="row" style={{ justifyContent: "center", gap: 10 }}>
                <DecisionChip d="ALLOW" />
                <DecisionChip d="CONSTRAIN" />
                <DecisionChip d="REVIEW" />
                <DecisionChip d="BLOCK" />
              </div>
            </div>

            <div className="section">
              <SectionHead title="Four stages" sub="From natural-language policy to a deterministic, explainable decision" />
              <div className="grid g4">
                <Block title="1 · Policy Compiler" items={["Intent Parser (NL → policy)", "Policy IR", "Policy Validator", "Versioned Policy Store"]} />
                <Block title="2 · Registries (pluggable)" items={["Data Type Registry", "Detector Registry", "Parser/Extractor Registry", "Destination Registry", "Transform Registry", "Capability Registry", "Action Ontology", "Safety Kernel Rules"]} />
                <Block title="3 · Analysis & Classification" items={["Content Analysis", "Detectors (PII/secrets/EDM)", "Parsers & OCR", "Semantic Classification", "Source-Code Analysis", "Action Understanding", "Context Enrichment"]} />
                <Block title="4 · Decision Engine" items={["Policy Evaluation", "Safety Kernel", "Risk & Context", "Blast-Radius Governor", "Transform Planning", "Standing Permissions", "Task Envelopes", "Break-Glass", "Park / Resume"]} tone="accent" />
              </div>
            </div>
          </div>
        ) },
        { id: "inputs", label: "Decision inputs", count: INPUTS.length, content: (
          <div>
            <SectionHead title="Decision inputs" sub="Every consequential action is judged against this full set of signals" />
            <div className="card">
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {INPUTS.map((x, i, arr) => (
                  <span key={x} className="row" style={{ gap: 6 }}>
                    <Chip tone="violet">{x}</Chip>{i < arr.length - 1 ? <span className="faint">+</span> : <span className="faint">→ DECISION</span>}
                  </span>
                ))}
              </div>
              <div className="small dim" style={{ marginTop: 14 }}>
                Decisions are deterministic and explainable. Semantic/ML signals are inputs; the final decision always carries
                explicit reasons — no opaque risk scores.
              </div>
            </div>
          </div>
        ) },
        { id: "detectors", label: "Detectors", count: DETECTORS.length, content: (
          <div>
            <SectionHead title="Detector Registry" sub="Pluggable analyzers that classify content into typed data findings" right={<span className="row" style={{ gap: 6 }}><ScanSearch size={13} /><span className="small dim">{DETECTORS.length} registered</span></span>} />
            {DETECTORS.length === 0 ? (
              <div className="card empty">No detectors registered.</div>
            ) : (
              <>
                <FilterBar {...detF.bar} placeholder="Search detectors, methods, data types…" />
                {detF.filtered.length === 0 ? (
                  <div className="card empty">No detectors match these filters.</div>
                ) : (
                  <CardGrid>
                    {detPaged.rows.map((d) => (
                      <EntityCard
                        key={d.id}
                        icon={<ScanSearch size={16} />}
                        eyebrow={d.method}
                        title={<span className="mono">{d.id} <span className="faint">v{d.version}</span></span>}
                        status={<StatusChip s={d.status} />}
                        fields={[{ label: "Detects", value: <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>{d.detects.map((x) => <Chip key={x} tone="violet">{x}</Chip>)}</div> }]}
                      />
                    ))}
                  </CardGrid>
                )}
                <Pager {...detPaged} />
              </>
            )}
          </div>
        ) },
        { id: "transforms", label: "Transforms", count: TRANSFORMS.length, content: (
          <div>
            <SectionHead title="Transform Registry" sub="How sensitive data is neutralized when an action is constrained rather than blocked" right={<span className="row" style={{ gap: 6 }}><Shuffle size={13} /><span className="small dim">{TRANSFORMS.length} kinds</span></span>} />
            {TRANSFORMS.length === 0 ? (
              <div className="card empty">No transforms registered.</div>
            ) : (
              <>
                <FilterBar {...trF.bar} placeholder="Search transforms…" />
                {trF.filtered.length === 0 ? (
                  <div className="card empty">No transforms match these filters.</div>
                ) : (
                  <CardGrid>
                    {trPaged.rows.map((t) => (
                      <EntityCard
                        key={t.kind}
                        icon={t.reversible ? <Undo2 size={16} /> : <Lock size={16} />}
                        eyebrow={t.reversible ? "Reversible" : "Irreversible"}
                        title={t.kind}
                        status={t.reversible ? <Chip tone="allow">Token Vault</Chip> : <Chip tone="neutral">one-way</Chip>}
                        fields={[
                          { label: "Example", value: <span className="mono small dim">{t.example}</span> },
                        ]}
                      />
                    ))}
                  </CardGrid>
                )}
                <Pager {...trPaged} />
              </>
            )}
          </div>
        ) },
        { id: "capabilities", label: "Capability truthfulness", count: capabilityGaps.length, content: (
          <div>
            <SectionHead
              title="Capability truthfulness"
              sub="Capabilities that are not fully enforced gate contract activation honestly — nothing claims coverage it lacks"
              right={<><span className="row" style={{ gap: 6 }}><ShieldCheck size={13} style={{ color: "var(--allow)" }} /><span className="small dim">{capsEnforced} of {CAPABILITIES.length} enforced</span></span><button className="btn btn-sm" onClick={() => nav("coverage")}>Coverage Map <ArrowRight size={13} /></button></>}
            />
            {capabilityGaps.length === 0 ? (
              <div className="card empty">Every capability is enforced — no gaps gate contract activation.</div>
            ) : (
              <>
                <FilterBar {...capF.bar} placeholder="Search capabilities…" />
                {capF.filtered.length === 0 ? (
                  <div className="card empty">No capabilities match these filters.</div>
                ) : (
                  <CardGrid>
                    {capPaged.rows.map((c) => (
                      <EntityCard
                        key={c.id}
                        icon={PLANE_ICON[c.plane]}
                        eyebrow={titleCase(c.plane)}
                        title={c.label}
                        status={<StatusChip s={c.status} />}
                        fields={[{ label: "Why", value: <span className="dim">{c.note}</span> }]}
                      />
                    ))}
                  </CardGrid>
                )}
                <Pager {...capPaged} />
              </>
            )}
          </div>
        ) },
      ]} />
    </div>
  );
}
