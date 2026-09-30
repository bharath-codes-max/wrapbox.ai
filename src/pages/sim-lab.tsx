// Simulation Lab — the primary demo experience. LEFT: what the person/agent
// sees. RIGHT: what Wrapbox sees and does. Scenarios run through the real
// engine, record real events, and propagate to every other screen.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState, simulate, shadowEvaluate, shadowEvent, standingSeed, stopOf, taintOf } from "../state/store";
import { DEMO_CONTRACTS } from "../model/contracts";
import { BASELINE_KERNEL } from "../engine/kernel";
import { PageHead, Chip, DecisionChip, SimNote, Payload, names, Avatar, AgentMark, DestMark, SectionHead } from "../ui/kit";
import { EventDetail } from "../ui/event-detail";
import { AgentTerminal } from "../ui/agent-terminal";
import { SCENARIOS, type Scenario } from "../engine/scenarios";
import { pipelineFor, buildInspection, type PipelineStage } from "../engine/simulate";
import type { Decision, SimulationEvent } from "../model/types";
import { agentById, userById } from "../model/org";
import { destById, planeLabel } from "../model/registries";
import { Network, Server, ShieldCheck, Layers, Cpu, Play, Pause, StepForward, RotateCcw, ArrowRight, Plug, Globe, Workflow, OctagonX, Eye } from "lucide-react";

const GROUPS = [
  { key: "NETWORK", label: "Network" },
  { key: "ENDPOINT", label: "Endpoint" },
  { key: "GATEWAY", label: "Gateway" },
  { key: "MCP", label: "MCP tools" },
  { key: "BROWSER_HOSTED", label: "Browser & hosted" },
  { key: "AGENTIC", label: "Agentic risks" },
  { key: "CONTEXT", label: "Context" },
  { key: "SAFETY", label: "Safety Kernel" },
] as const;

const GROUP_ICON: Record<string, JSX.Element> = {
  NETWORK: <Network size={13} />,
  ENDPOINT: <Server size={13} />,
  GATEWAY: <ShieldCheck size={13} />,
  MCP: <Plug size={13} />,
  BROWSER_HOSTED: <Globe size={13} />,
  AGENTIC: <Workflow size={13} />,
  CONTEXT: <Layers size={13} />,
  SAFETY: <Cpu size={13} />,
  BROWSER: <Globe size={13} />,
  HOSTED: <Globe size={13} />,
};

/** Plain notes for groups whose scenarios depend on what ran before. */
const GROUP_NOTE: Record<string, string> = {
  MCP: "Rules name the MCP tool and its arguments — the same push_files tool is fine on a feature branch and held on main.",
  BROWSER_HOSTED: "The same rules reach agents in a managed browser and agents hosted on AWS AgentCore (Wrapbox as the gateway's request interceptor).",
  AGENTIC: "Order matters here: run “reads an issue from an outside contributor” before “deploys to staging”, and the $18 refund before the replies. Stop an agent in Agent Inventory and every scenario for it turns BLOCK.",
};

export function SimulationLab({ nav, route }: { nav: (r: string) => void; route: string }) {
  const s = useAppState();
  const sub = route.split("/")[1]?.toUpperCase();
  const [group, setGroup] = useState<string>(GROUPS.some((g) => g.key === sub) ? sub! : "NETWORK");
  const [scenarioId, setScenarioId] = useState<string>(() => SCENARIOS.find((x) => x.group === (GROUPS.some((g) => g.key === sub) ? sub : "NETWORK"))!.id);
  const sc = SCENARIOS.find((x) => x.id === scenarioId)!;

  const [event, setEvent] = useState<SimulationEvent | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [visible, setVisible] = useState(0); // stages revealed
  const [mode, setMode] = useState<"idle" | "auto" | "step" | "done">("idle");
  const [openDetail, setOpenDetail] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pick = (g: string) => {
    setGroup(g);
    const first = SCENARIOS.find((x) => x.group === g)!;
    setScenarioId(first.id);
    reset();
  };
  const reset = () => {
    if (timer.current) clearInterval(timer.current);
    setEvent(null); setStages([]); setVisible(0); setMode("idle");
  };

  const start = (auto: boolean) => {
    if (timer.current) clearInterval(timer.current);
    const ev = simulate(sc); // real event, recorded in the store
    const st = pipelineFor(sc, ev);
    setEvent(ev); setStages(st); setVisible(1);
    setMode(auto ? "auto" : "step");
    if (auto) {
      let i = 1;
      timer.current = setInterval(() => {
        i += 1;
        setVisible(i);
        if (i >= st.length) {
          if (timer.current) clearInterval(timer.current);
          setMode("done");
        }
      }, 650);
    }
  };
  const stepOnce = () => {
    if (!event) { start(false); return; }
    setVisible((v) => {
      const nv = Math.min(stages.length, v + 1);
      if (nv >= stages.length) setMode("done");
      return nv;
    });
  };
  const pause = () => {
    if (timer.current) clearInterval(timer.current);
    setMode("step");
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const finished = mode === "done" || (event !== null && visible >= stages.length);
  const liveEvent = event ? s.events.find((e) => e.id === event.id) ?? event : null;
  const inspectionPreview = useMemo(() => buildInspection(sc), [sc]);

  const groupScenarios = SCENARIOS.filter((x) => x.group === group);
  const groupLabel = GROUPS.find((g) => g.key === group)?.label ?? "";
  // What each scenario resolves to under the rules active right now, vs the
  // original demo policy — a pure what-if through the same Core Brain.
  const outlook = useMemo(() => {
    const out: Record<string, { current: Decision; baseline: Decision; why: string }> = {};
    for (const x of SCENARIOS.filter((y) => y.group === group)) {
      const now = shadowEvent(x, s.contracts, s.kernel, s.standing, { withLiveOverride: true });
      const layer = now.decidedBy?.layer;
      // Name what changed it: the agent's live state, or the policy itself.
      const why = layer === "killswitch" ? "agent stopped"
        : layer === "injection" ? "agent just read untrusted content"
        : layer === "output" ? "output check against sealed results"
        : layer === "breakglass" ? "break-glass override active"
        : "current policy";
      out[x.id] = { current: now.decision, baseline: shadowEvaluate(x, DEMO_CONTRACTS, BASELINE_KERNEL, standingSeed()), why };
    }
    return out;
  }, [group, s.contracts, s.kernel, s.standing, s.breakGlass, s.stops, s.taints, s.events.length]);

  const planeName = planeLabel(sc.plane);
  const stopped = stopOf(sc.agent, s);
  const watched = taintOf(sc.agent, Date.now(), s);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Simulation"
        title="Simulation Lab"
        sub="What the person or agent is doing — versus what Wrapbox sees and does. Every run records a real event that propagates to the Control Room, Live Actions, Review Center and Evidence."
        right={<SimNote>Environments simulated · decisions & state real</SimNote>}
      />

      {/* Enforcement plane — one plane at a time, tab-style */}
      <div className="tabs" role="tablist" aria-label="Enforcement plane">
        {GROUPS.map((g) => {
          const count = SCENARIOS.filter((x) => x.group === g.key).length;
          return (
            <button
              key={g.key}
              role="tab"
              aria-selected={group === g.key}
              className={`tab ${group === g.key ? "active" : ""}`}
              onClick={() => pick(g.key)}
            >
              {GROUP_ICON[g.key]} {g.label}
              <span className="tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>
        {/* Scenario picker */}
        <div className="card">
          <SectionHead title="Scenarios" sub={["NETWORK", "ENDPOINT", "GATEWAY"].includes(group) ? `${groupScenarios.length} in the ${groupLabel} plane` : `${groupScenarios.length} in ${groupLabel}`} />
          {GROUP_NOTE[group] && <div className="small dim" style={{ margin: "-4px 0 10px", lineHeight: 1.5 }}>{GROUP_NOTE[group]}</div>}
          <div style={{ margin: "0 -20px" }}>
            {groupScenarios.map((x) => {
              const selected = x.id === scenarioId;
              return (
                <div
                  key={x.id}
                  className="stream-item rowlink"
                  onClick={() => { setScenarioId(x.id); reset(); }}
                  style={{
                    cursor: "pointer",
                    padding: "12px 20px",
                    ...(selected ? { background: "var(--accent-soft)", boxShadow: "inset 2.5px 0 0 var(--accent)" } : {}),
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="stream-sentence" style={{ fontSize: 13, color: selected ? "var(--accent-active)" : undefined }}>{x.title}</div>
                    {(() => {
                      const now = outlook[x.id];
                      if (!now) return null;
                      const changed = now.current !== now.baseline;
                      const note = x.expected.includes(" — ") ? x.expected.split(" — ")[1] : "";
                      return (
                        <div className="row small" style={{ marginTop: 6, gap: 6 }}>
                          <span className="faint">Right now</span>
                          <DecisionChip d={now.current} small />
                          {changed
                            ? <span style={{ color: "var(--review)" }}>changed by {now.why} (was {now.baseline})</span>
                            : note && <span className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</span>}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          {group === "GATEWAY" && (
            <div className="small faint" style={{ paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--line)" }}>
              The 10-step park/resume task lives in <a onClick={() => nav("tasks")}>Tasks</a>.
            </div>
          )}
        </div>

        {/* Stage */}
        <div>
          {/* Scenario header + run controls */}
          <div className="card">
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 9 }}>
                  <Chip tone="neutral"><span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>{GROUP_ICON[sc.plane]} {planeName}</span></Chip>
                  <b style={{ fontSize: 15.5, letterSpacing: "-0.01em" }}>{sc.title}</b>
                </div>
                <div className="small dim" style={{ marginTop: 7, maxWidth: 640, lineHeight: 1.55 }}>{sc.narrative}</div>
                <div className="row" style={{ gap: 16, marginTop: 12 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <Avatar userId={sc.user} size={20} />
                    <span className="small dim">{userById(sc.user)?.name}</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <AgentMark agentId={sc.agent} size={16} />
                    <span className="small dim">{agentById(sc.agent)?.name}</span>
                  </span>
                  {sc.application && <span className="small faint">{sc.application}</span>}
                  {sc.destination && (
                    <span className="row" style={{ gap: 6 }}>
                      <DestMark destId={sc.destination} size={16} />
                      <span className="small dim">{destById(sc.destination)?.label}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="row" style={{ flexShrink: 0 }}>
                {mode === "idle" && <>
                  <button className="btn btn-accent btn-sm" onClick={() => start(true)}><Play size={13} /> Run</button>
                  <button className="btn btn-sm" onClick={() => start(false)}><StepForward size={13} /> Step through</button>
                </>}
                {mode === "auto" && <button className="btn btn-sm" onClick={pause}><Pause size={13} /> Pause</button>}
                {mode === "step" && !finished && <button className="btn btn-accent btn-sm" onClick={stepOnce}><StepForward size={13} /> Next step</button>}
                {(finished || mode !== "idle") && <button className="btn btn-ghost btn-sm" onClick={reset}><RotateCcw size={13} /> Reset</button>}
              </div>
            </div>
            {(stopped || watched) && (
              <div className="row small" style={{ marginTop: 12, gap: 8 }}>
                {stopped && <Chip tone="block"><OctagonX size={12} /> {agentById(sc.agent)?.name} is stopped everywhere — by {userById(stopped.by)?.name}</Chip>}
                {watched && <Chip tone="review"><Eye size={12} /> Under closer watch: read {watched.label} {Math.max(0, Math.round((Date.now() - watched.at) / 60000))} min ago</Chip>}
              </div>
            )}
            <div className="small faint" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              Expected under the brief · {sc.expected}
            </div>
          </div>

          {/* Reality — the person's screen beside the machine's view */}
          <div className="card">
            <div className="reality">
              {/* LEFT — what the human/agent sees */}
              <div>
                <div className="payload-title dim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {sc.plane === "NETWORK" ? <Network size={12} /> : <Server size={12} />}
                  WHAT {sc.plane === "NETWORK" ? "THE EMPLOYEE" : "THE AGENT"} SEES
                </div>
                {sc.plane === "NETWORK" ? (
                  <div className="browser-frame">
                    <div className="browser-bar">
                      <div className="term-chrome"><i /><i /><i /></div>
                      <div className="browser-url" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {sc.destination && <DestMark destId={sc.destination} size={13} />}
                        https://{sc.destination ? destById(sc.destination)?.host : "app.example"}/
                      </div>
                    </div>
                    <div className="browser-body">
                      <div className="chat-bubble">
                        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <Avatar userId={sc.user} size={18} />
                          <b className="small">{userById(sc.user)?.name}</b>
                        </span>
                        <div className="small dim" style={{ marginTop: 2 }}>
                          {sc.id === "net-pii-approved" && "Here's our customer list — draft a personalised renewal email for each."}
                          {sc.id === "net-cred-approved" && "Why is this service failing? Config attached."}
                          {sc.id === "net-code-approved" && "Refactor this checkout module for readability."}
                          {sc.id === "net-code-unapproved" && "Optimize this code for me."}
                          {sc.id === "net-encrypted" && "Summarise the records in this archive."}
                          {sc.id === "net-unknown-dest" && "(background process posting data…)"}
                          {sc.id === "sk-privkey-exfil" && "(unknown process posting ~/.ssh/id_rsa…)"}
                        </div>
                        {sc.fileName && (
                          <div style={{ marginTop: 6 }}>
                            <span className="attach-chip">📎 {sc.fileName}</span>
                          </div>
                        )}
                      </div>
                      {!event && <div className="small faint">Press Send (Run) to transmit…</div>}
                      {event && !finished && <div className="small dim">Transmitting…</div>}
                      {finished && liveEvent && (
                        <>
                          {liveEvent.decision === "ALLOW" && (
                            <div className="chat-bubble" style={{ borderColor: "var(--good)" }}>
                              <b className="small" style={{ color: "var(--good)" }}>✓ Delivered</b>
                              <div className="small dim">The destination received the content. Normal work was not interrupted.</div>
                            </div>
                          )}
                          {liveEvent.decision === "CONSTRAIN" && liveEvent.payloadAfter && (
                            <div className="chat-bubble" style={{ borderColor: "var(--info)" }}>
                              <b className="small" style={{ color: "var(--info)" }}>✓ Delivered — protected</b>
                              <div className="small dim" style={{ marginBottom: 6 }}>What the destination actually received:</div>
                              <Payload title="" text={liveEvent.payloadAfter} highlight="tokens" />
                            </div>
                          )}
                          {liveEvent.decision === "BLOCK" && (
                            <div className="chat-bubble" style={{ borderColor: "var(--bad)" }}>
                              <b className="small" style={{ color: "var(--bad)" }}>⛔ Blocked by Wrapbox before transmission</b>
                              <div className="small dim">
                                {liveEvent.decidedBy ? `Decided by ${liveEvent.decidedBy.label}` : liveEvent.decisionReasons[0]}
                                {liveEvent.safeAlternative && <div style={{ marginTop: 4 }}><b>Safe next step:</b> {liveEvent.safeAlternative}</div>}
                              </div>
                            </div>
                          )}
                          {liveEvent.decision === "REVIEW" && (
                            <div className="chat-bubble" style={{ borderColor: "var(--warn)" }}>
                              <b className="small" style={{ color: "var(--warn)" }}>⏸ Held for approval</b>
                              <div className="small dim">This transfer needs a scoped approval. You can keep working — it resumes if approved in <a onClick={() => nav("reviews")}>Review Center</a>.</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <AgentTerminal scenario={sc} event={liveEvent} stages={stages} visible={visible} onOpenEvidence={() => setOpenDetail(true)} />
                )}

                {/* Before payload preview for content scenarios */}
                {sc.payload && (
                  <div style={{ marginTop: 12 }}>
                    <Payload title={`ORIGINAL — ${sc.fileName ?? "content"}`} text={sc.payload} highlight="sensitive" />
                    {inspectionPreview && !inspectionPreview.inspectable && (
                      <div className="small faint" style={{ marginTop: 4 }}>Encrypted content — Wrapbox cannot read it, and says so.</div>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT — what Wrapbox sees */}
              <div>
                <div className="payload-title dim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ShieldCheck size={12} /> WHAT WRAPBOX SEES AND DOES
                </div>
                <div className="card" style={{ minHeight: 220 }}>
                  {stages.length === 0 && (
                    <div className="empty">
                      Run the scenario to watch the {planeName} intercept, inspect, decide and enforce.
                    </div>
                  )}
                  <div className="pipe">
                    {stages.slice(0, visible).map((st, i) => (
                      <div className="pipe-stage" key={st.key + i}>
                        <div className="pipe-rail">
                          <div className={`pipe-dot t-${st.tone}`} />
                          {i < visible - 1 && <div className="pipe-line" />}
                        </div>
                        <div className="pipe-body">
                          <div className="pipe-label">{st.label}</div>
                          <div className="pipe-detail">{st.detail}</div>
                          {st.items && (
                            <div className="rule-list">
                              {st.items.map((it, k) => (
                                <div key={k} className={`rule-item ${it.decided ? "decided" : ""}`}>
                                  <DecisionChip d={it.effect} small />
                                  <div style={{ minWidth: 0 }}>
                                    <div className="rule-text">“{it.text}”</div>
                                    <div className="rule-source">
                                      {it.source}
                                      {it.decided && <span className="rule-decided"> · this rule decided</span>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {finished && liveEvent && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <div className="spread">
                      <div className="row">
                        <DecisionChip d={liveEvent.decision} />
                        <span className="row" style={{ gap: 6 }}>
                          <AgentMark agentId={liveEvent.agent} size={14} />
                          <span className="small dim">{names(liveEvent).agent} · {planeLabel(liveEvent.plane)}</span>
                        </span>
                      </div>
                      <div className="row">
                        <button className="btn btn-sm" onClick={() => setOpenDetail(true)}>Evidence <ArrowRight size={13} /></button>
                        {liveEvent.reviewState?.status === "pending" && (
                          <button className="btn btn-warn btn-sm" onClick={() => nav("reviews")}>Open review</button>
                        )}
                      </div>
                    </div>
                    <div className="small faint" style={{ marginTop: 8 }}>
                      This event is now visible in Control Room, Live Actions, Agent Inventory{liveEvent.transformation?.length ? ", Token Vault" : ""} and Evidence.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {openDetail && liveEvent && (
        <EventDetail e={liveEvent} onClose={() => setOpenDetail(false)} onNavigate={(r) => { setOpenDetail(false); nav(r); }} />
      )}
    </div>
  );
}
