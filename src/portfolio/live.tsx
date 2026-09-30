// Live widgets — every one of these calls the product's real engine
// (engine/brain.ts decide() via runScenario, engine/drafter.ts draftClauses,
// engine/coverage.ts). Nothing here types a decision in.
import { useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS, type Scenario } from "../engine/scenarios";
import { runScenario, pipelineFor } from "../engine/simulate";
import { draftClauses } from "../engine/drafter";
import { clauseCoverage, capability } from "../engine/coverage";
import { BASELINE_KERNEL } from "../engine/kernel";
import { DEMO_CONTRACTS } from "../model/contracts";
import { agentById, userById, deviceOfUser } from "../model/org";
import { AgentTerminal } from "../ui/agent-terminal";
import { logoUrl, AGENT_LOGOS } from "../ui/logos";
import type { SimulationEvent, ContractClause } from "../model/types";
import { Chip, decisionTone } from "./ui";

const ACTIVE = DEMO_CONTRACTS.filter((c) => c.status === "ACTIVE");
export const DEMO_IDS = ["ep-read-env", "net-pii-approved", "gw-force-main", "net-unknown-dest", "gw-export-500k", "gw-iam-admin", "ep-run-tests", "mcp-push-main", "sup-meridian-export", "a2a-unknown-hop", "hosted-export"];
export const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;

/** Runs one scenario through the real engine, chained on a local evidence hash. */
export function decideOnce(sc: Scenario, prevHash: string): SimulationEvent {
  return runScenario(sc, ACTIVE, prevHash, { timestamp: Date.now(), kernel: BASELINE_KERNEL }).event;
}

// The real order in engine/brain.ts: kill switch, then one agent's checks,
// then every agent in a delegation chain, then break-glass.
export const LAYERS: { key: string; label: string; cap: string }[] = [
  { key: "killswitch", label: "Kill switch", cap: "agent stopped everywhere" },
  { key: "uninspectable", label: "Fail closed", cap: "uninspectable content" },
  { key: "contract", label: "Intent Contracts", cap: "strictest wins · MCP tools" },
  { key: "safety", label: "Safety Kernel", cap: "vendor-managed" },
  { key: "supplier", label: "Supplier contract", cap: "third-party scope" },
  { key: "blast", label: "Blast-Radius Governor", cap: "thresholds" },
  { key: "context", label: "Context", cap: "production · privileged" },
  { key: "injection", label: "Untrusted input", cap: "read it → review" },
  { key: "output", label: "Output check", cap: "vs sealed result" },
  { key: "envelope", label: "Task envelope", cap: "scoped authority" },
  { key: "standing", label: "Standing permission", cap: "everyday budgets" },
  { key: "default", label: "Default", cap: "allow & record" },
  { key: "delegation", label: "Delegation chain", cap: "every agent checked" },
  { key: "breakglass", label: "Break-glass", cap: "never over the Kernel" },
];

/* ---------------- LiveDecide: pick a scenario, watch decide() run ---------------- */
export function LiveDecide({ active, autoplay = true }: { active: boolean; autoplay?: boolean }) {
  const [id, setId] = useState(DEMO_IDS[0]);
  const [event, setEvent] = useState<SimulationEvent | null>(null);
  const [visible, setVisible] = useState(0);
  const hash = useRef("genesis");
  const sc = scenario(id);
  const stages = useMemo(() => (event ? pipelineFor(sc, event) : []), [sc, event]);

  const run = (sid = id) => {
    const s = scenario(sid);
    const ev = decideOnce(s, hash.current);
    hash.current = ev.evidence.hash;
    setEvent(ev); setVisible(0);
  };
  useEffect(() => { if (active && autoplay) { const t = setTimeout(() => run(), 500); return () => clearTimeout(t); } /* eslint-disable-next-line */ }, [active]);
  useEffect(() => {
    if (!event) return;
    if (visible >= stages.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), visible === 0 ? 250 : 520);
    return () => clearTimeout(t);
  }, [event, visible, stages.length]);

  const decidedLayer = event?.decidedBy?.layer ?? "default";
  const litLayer = event && visible >= stages.findIndex((s) => s.key === "decision") + 1 ? decidedLayer : null;
  const brainIdx = stages.findIndex((s) => s.key === "brain");
  const scanning = event !== null && litLayer === null && visible > brainIdx && brainIdx >= 0;
  const scanPos = scanning ? Math.min(LAYERS.findIndex((l) => l.key === decidedLayer), Math.floor((visible - brainIdx) * 3)) : -1;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gridTemplateRows: "minmax(0, 1fr)", gap: 28, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        <div className="seg-btns">
          {DEMO_IDS.map((d) => { const s = scenario(d); return <button key={d} type="button" className={`btn sm ${d === id ? "on" : ""}`} onClick={() => { setId(d); run(d); }}><img src={logoUrl(AGENT_LOGOS[s.agent] ?? "mcp")} alt="" width={14} height={14} style={{ borderRadius: 3, background: "#fff", padding: 1 }} />{s.title}</button>; })}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <AgentTerminal scenario={sc} event={event} stages={stages} visible={visible} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <div className="label">brain.ts · decide() — in this order</div>
        <div className="layers compact">
          {LAYERS.map((l, i) => (
            <div key={l.key} className={`layer ${litLayer === l.key ? "decided" : scanPos === i ? "lit" : ""}`}>
              <em>{i + 1}</em><span>{l.label}</span><span className="cap">{l.cap}</span>
            </div>
          ))}
        </div>
        <div className="tile" style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="small">Decision</span>
          {event && visible >= stages.length ? <Chip tone={decisionTone(event.decision)}>{event.decision}</Chip> : <span className="muted mono" style={{ fontSize: 12 }}>{event ? "evaluating…" : "press Run"}</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- DrafterDemo: plain English → normalized clauses ---------------- */
export const DEFAULT_INTENT = "Customer email addresses and phone numbers must be reversibly tokenized before transmission to external AI. Credentials must never be transmitted externally. MCP pushes straight to main require engineering review.";

function clauseYaml(c: ContractClause, i: number): string {
  const list = (v: string[] | "ANY") => (v === "ANY" ? "ANY" : `[${v.join(", ")}]`);
  return [
    `- id: clause-${i + 1}`,
    `  text: "${c.text}"`,
    `  data: ${list(c.dataClasses)}`,
    `  destinations: ${list(c.destinations)}`,
    `  actions: ${list(c.actions)}`,
    ...(c.mcp ? [`  mcp: {${[c.mcp.registered === false ? "registered: false" : "", c.mcp.tools?.length ? `tools: [${c.mcp.tools.join(", ")}]` : "", c.mcp.args ? `args: {${Object.entries(c.mcp.args).map(([k, v]) => `${k}: /${v}/`).join(", ")}}` : ""].filter(Boolean).join(", ")}}`] : []),
    `  effect: ${c.effect}${c.transform ? `\n  transform: ${c.transform}` : ""}`,
    `  requires: ${list(c.requiredCapabilities)}`,
    `  failClosed: ${c.failClosed}`,
  ].join("\n");
}

export function DrafterDemo({ active }: { active: boolean }) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(true);
  useEffect(() => {
    if (!active) return;
    setText(""); setTyping(true);
    let i = 0; const iv = window.setInterval(() => { i += 2; setText(DEFAULT_INTENT.slice(0, i)); if (i >= DEFAULT_INTENT.length) { window.clearInterval(iv); setTyping(false); } }, 22);
    return () => window.clearInterval(iv);
  }, [active]);
  const clauses = useMemo(() => (text.trim().length > 4 ? draftClauses(text) : []), [text]);
  const yaml = useMemo(() => clauses.map(clauseYaml).join("\n"), [clauses]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 5fr) minmax(0, 6fr)", gap: 28, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        <div className="label">Describe — edit the sentence, the policy follows</div>
        <textarea className="ta" value={text} onChange={(e) => { setTyping(false); setText(e.target.value); }} spellCheck={false} aria-label="Intent in plain English" />
        <div className="stack" style={{ gap: 10, overflow: "auto", minHeight: 0 }}>
          {clauses.map((c, i) => {
            const cov = clauseCoverage(c);
            return (
              <div key={c.id} className="tile" style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{c.text}</div>
                  <div className="row" style={{ gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                    {c.dataClasses.map((d) => <span key={d} className="chip neutral" style={{ fontSize: 11 }}>{d}</span>)}
                    {c.requiredCapabilities.map((r) => <span key={r} className="chip neutral" style={{ fontSize: 11 }} title={capability(r)?.note}>needs {capability(r)?.label ?? r} · {capability(r)?.status.toLowerCase().replace("_", " ")}</span>)}
                  </div>
                </div>
                <div className="stack" style={{ gap: 3, alignItems: "flex-end" }}>
                  <Chip tone={decisionTone(c.effect)}>{c.effect}</Chip>
                  <span className="small mono" style={{ fontSize: 10.5 }}>coverage: {cov.toLowerCase().replace("_", " ")}</span>
                </div>
              </div>
            );
          })}
          {!clauses.length && !typing && <div className="small">No clause yet — describe what data may go where, and what needs a human.</div>}
        </div>
      </div>
      <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="code" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div className="cbar"><span className="lights"><i /><i /><i /></span><span>normalized rule — draftClauses() output, shown as YAML</span></div>
          <pre style={{ flex: 1, minHeight: 0, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{yaml ? yaml.split("\n").map((l, k) => <span key={k}>{l}{"\n"}</span>) : <span className="c"># waiting for intent…</span>}</pre>
        </div>
      </div>
    </div>
  );
}

/* ---------------- ArchFlow: the pipeline, animated with real decisions ---------------- */
type NodeId = string;
const EDGES: [NodeId, NodeId][] = [
  ["a-claude-code", "endpoint"], ["a-claude-code", "gateway"], ["a-codex", "endpoint"], ["a-copilot", "network"], ["a-chatgpt", "network"], ["a-finance", "gateway"], ["a-unknown-mcp", "network"], ["a-browser-hosted", "browser-hosted"],
  ["endpoint", "brain"], ["network", "brain"], ["gateway", "brain"], ["browser-hosted", "brain"],
  ["brain", "d-github"], ["brain", "d-db"], ["brain", "d-aws"], ["brain", "d-extai"], ["brain", "d-unknown"], ["brain", "d-evidence"],
];
const DEST_FOR: Record<string, string> = { "ep-read-env": "", "net-pii-approved": "d-extai", "gw-force-main": "d-github", "net-unknown-dest": "d-unknown", "gw-export-500k": "d-db", "gw-iam-admin": "d-aws", "ep-run-tests": "", "mcp-push-main": "d-github", "br-form-pii": "d-extai", "hosted-export": "d-db" };
const FLOW_IDS = ["net-pii-approved", "gw-force-main", "net-unknown-dest", "ep-read-env", "mcp-push-main", "br-form-pii", "hosted-export", "ep-run-tests"];
// Browser, hosted and supplier agents share one node on the diagram, as do their planes.
const AGENT_NODE = (agent: string) => (["a-claude-chrome", "a-billing-hosted", "a-meridian-recon", "a-northwind-desk"].includes(agent) ? "a-browser-hosted" : agent);
const PLANE_NODE = (plane: string) => (plane === "BROWSER" || plane === "HOSTED" ? "browser-hosted" : plane.toLowerCase());

export function ArchFlow({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ k: string; d: string }[]>([]);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [litWires, setLitWires] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState(-1);
  const [current, setCurrent] = useState<{ sc: Scenario; ev: SimulationEvent } | null>(null);
  const results = useMemo(() => { let h = "genesis"; return FLOW_IDS.map((id) => { const sc = scenario(id); const ev = decideOnce(sc, h); h = ev.evidence.hash; return { sc, ev }; }); }, []);

  // wires from element geometry (offsets are relative to the .arch container)
  useEffect(() => {
    const el = root.current; if (!el) return;
    const r = (id: string) => { const n = el.querySelector<HTMLElement>(`[data-n="${id}"]`); if (!n) return null; return { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight }; };
    const draw = () => setPaths(EDGES.map(([a, b]) => { const A = r(a), B = r(b); if (!A || !B) return null; const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, mx = x1 + (x2 - x1) / 2; return { k: `${a}>${b}`, d: `M${x1},${y1} H${mx} V${y2} H${x2 - 2}` }; }).filter(Boolean) as { k: string; d: string }[]);
    draw(); const t = setTimeout(draw, 400); window.addEventListener("resize", draw);
    return () => { clearTimeout(t); window.removeEventListener("resize", draw); };
  }, []);

  // auto-play loop over real results
  useEffect(() => {
    if (!active) return;
    let alive = true; let i = 0;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (alive) {
        const { sc, ev } = results[i % results.length]; i += 1;
        setCurrent({ sc, ev }); setLit(new Set()); setLitWires(new Set()); setStage(-1);
        const plane = PLANE_NODE(sc.plane);
        const agentNode = AGENT_NODE(sc.agent);
        setLit(new Set([agentNode])); await sleep(700); if (!alive) return;
        setLitWires(new Set([`${agentNode}>${plane}`])); setLit(new Set([agentNode, plane])); await sleep(800); if (!alive) return;
        setLitWires(new Set([`${plane}>brain`])); setLit(new Set([plane, "brain"]));
        for (let s = 0; s < 5; s++) { setStage(s); await sleep(s === 2 ? 900 : 520); if (!alive) return; }
        const dest = DEST_FOR[sc.id];
        const wires = new Set<string>(["brain>d-evidence"]); const nodes = new Set<string>(["brain", "d-evidence"]);
        if (dest && ev.decision !== "BLOCK" && ev.decision !== "REVIEW") { wires.add(`brain>${dest}`); nodes.add(dest); }
        if (dest && ev.decision === "BLOCK") nodes.add(`${dest}:blk`);
        setLitWires(wires); setLit(nodes); await sleep(2200); if (!alive) return;
      }
    })();
    return () => { alive = false; };
  }, [active, results]);

  const N = ({ id, title, sub, cap, logo, cls = "" }: { id: string; title: string; sub?: string; cap?: string; logo?: string; cls?: string }) => (
    <div data-n={id} className={`node ${cls} ${lit.has(id) ? "lit" : ""} ${lit.has(`${id}:blk`) ? "blk" : ""}`}>{logo && <img src={logoUrl(logo)} alt="" />}<b>{title}</b>{sub && <small>{sub}</small>}{cap && <span className="cap">{cap}</span>}</div>
  );
  const dec = current?.ev.decision;
  return (
    <div className="arch" ref={root} style={{ height: "100%" }}>
      <svg className="wires" aria-hidden="true">{paths.map((p) => <path key={p.k} d={p.d} className={`wire ${litWires.has(p.k) ? "lit" : ""}`} />)}</svg>
      <div className="col">
        <div className="col-title">Agents</div>
        <N id="a-claude-code" title="Claude Code" sub="coding · Anthropic" logo="claudecode" />
        <N id="a-codex" title="Codex" sub="coding · OpenAI" logo="codex" />
        <N id="a-copilot" title="Microsoft Copilot" sub="enterprise copilot" logo="microsoft" />
        <N id="a-chatgpt" title="ChatGPT · Claude" sub="in the browser" logo="openai" />
        <N id="a-finance" title="Internal agents" sub="finance · support" />
        <N id="a-unknown-mcp" title="Unknown MCP agent" sub="discovered" logo="mcp" cls="dashed" />
        <N id="a-browser-hosted" title="Browser · hosted · supplier" sub="Claude in Chrome · AgentCore · partners" />
      </div>
      <div className="col">
        <div className="col-title">Enforcement planes</div>
        <N id="endpoint" title="Endpoint runtime" sub="file · process · secrets" cap="plane: ENDPOINT" />
        <N id="network" title="Network Extension" sub="uploads · AI destinations" cap="plane: NETWORK" />
        <N id="gateway" title="Gateways" sub="GitHub · SQL · AWS · SaaS · MCP" cap="plane: GATEWAY" />
        <N id="browser-hosted" title="Browser + hosted" sub="managed extension · AgentCore gateway" cap="plane: BROWSER · HOSTED" />
      </div>
      <div data-n="brain" className={`brain ${lit.has("brain") ? "lit" : ""}`}>
        <div className="bstages">
          {[
            ["Request", "identity chain: user · device · agent · app · resource · destination"],
            ["Normalize + inspect", "one verb per mechanism · detectors classify content · encrypted = uninspectable"],
            ["Decide", "14 ordered checks · strictest wins · records which layer decided"],
            ["Transform", "tokenize / redact in flight · originals sealed in the vault"],
            ["Enforce + evidence", "ALLOW · CONSTRAIN · REVIEW · BLOCK · hash-chained record"],
          ].map(([t, p], i) => (
            <div key={t} className={`bstage ${stage === i || (stage === 4 && i === 4) ? "lit" : ""}`}>
              <h4><em>{i + 1}</em>{t}</h4><p>{p}</p>
              {i === 4 && <div className="dec">{["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"].map((d) => <span key={d} className={`${d.toLowerCase()} ${stage >= 4 && dec === d ? "lit" : ""}`}>{d}</span>)}</div>}
            </div>
          ))}
        </div>
        <div className="bt">CORE BRAIN · engine/brain.ts decide()</div>
      </div>
      <div className="col">
        <div className="col-title">Destinations</div>
        <N id="d-github" title="GitHub" sub="38 repos" logo="github_light" />
        <N id="d-db" title="PostgreSQL" sub="payments-prod" logo="postgresql" />
        <N id="d-aws" title="AWS" sub="production" logo="aws" />
        <N id="d-extai" title="External AI" sub="approved · unapproved" logo="anthropic" />
        <N id="d-unknown" title="Unknown endpoint" sub="UNKNOWN_EXTERNAL" cls="dashed" />
        <N id="d-evidence" title="Evidence + store" sub="hash chain → 20 screens" />
      </div>
      {current && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: -6, display: "flex", justifyContent: "center" }}>
          <div className="tile" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", fontSize: 14 }}>
            <img src={logoUrl(AGENT_LOGOS[current.sc.agent] ?? "mcp")} alt="" width={16} height={16} style={{ borderRadius: 4, background: "#fff", padding: 1 }} />
            <span>{current.sc.narrative}</span>
            {stage >= 4 && <Chip tone={decisionTone(current.ev.decision)}>{current.ev.decision}</Chip>}
            {stage >= 4 && <span className="small mono" style={{ fontSize: 11 }}>decided by {current.ev.decidedBy?.layer ?? "default"}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function whoIs(sc: Scenario) {
  return { agent: agentById(sc.agent)?.name ?? sc.agent, user: userById(sc.user)?.name ?? sc.user, device: deviceOfUser(sc.user)?.name };
}
