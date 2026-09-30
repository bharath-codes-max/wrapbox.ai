// AgentTerminal — the agent's own terminal, the way a coding-agent session
// looks (window chrome, agent tabs, a bordered session box, the prompt, then a
// tool trace with └ sub-lines). Every line is derived from the REAL recorded
// event and its pipeline stages; nothing here is typed in. Revealed one stage
// at a time via `visible`, so it animates in step with the pipeline panel.
import { useState } from "react";
import type { SimulationEvent } from "../model/types";
import type { Scenario } from "../engine/scenarios";
import type { PipelineStage } from "../engine/simulate";
import { agentById, deviceById, deviceForAction, userById } from "../model/org";
import { destById, planeLabel } from "../model/registries";
import { logoUrl } from "./logos";
import { Copy, Check } from "lucide-react";

/** Coding-agent tabs shown in the window; the scenario's own agent is always the active one. */
const TABS: { id: string; name: string; logo: string; color: string }[] = [
  { id: "a-claude-code", name: "claude", logo: "claudecode", color: "#ff8a4c" },
  { id: "cursor", name: "cursor", logo: "cursor", color: "#8b8bff" },
  { id: "a-codex", name: "codex", logo: "codex", color: "#10a37f" },
];
const AGENT_COLOR: Record<string, string> = { "a-claude-code": "#ff8a4c", "a-claude": "#ff8a4c", "a-codex": "#10a37f", "a-chatgpt": "#10a37f", "a-copilot": "#4f8ef7", "a-finance": "#2fd1c0", "a-support": "#2fd1c0", "a-unknown-mcp": "#ff4d4f", "a-claude-chrome": "#ff8a4c", "a-billing-hosted": "#f5a524", "a-meridian-recon": "#8b8bff", "a-northwind-desk": "#8b8bff" };

/** The tool call the agent issued, in the `Tool(args)` idiom of agent traces. */
function toolCall(sc: Scenario): { tool: string; args: string } {
  const args = sc.actionRaw ?? sc.action.toLowerCase();
  if (sc.mcp) return { tool: `mcp__${sc.mcp.server.replace(/^mcp-/, "")}__${sc.mcp.tool}`, args: Object.entries(sc.mcp.args).map(([k, v]) => `${k}: "${v}"`).join(", ") };
  if (sc.plane === "BROWSER") return { tool: "Browser", args };
  if (sc.plane === "ENDPOINT") return { tool: "Bash", args };
  if (sc.plane === "NETWORK") return { tool: "Upload", args: `${sc.fileName ?? sc.resource} → ${sc.destination ? destById(sc.destination)?.host ?? sc.destination : "network"}` };
  return { tool: (sc.application ?? "Tool").replace(/\s+/g, ""), args };
}

interface Line { tone: "good" | "warn" | "bad" | "info" | "neutral"; head: React.ReactNode; subs: { text: React.ReactNode; cls?: string }[] }

function linesFor(sc: Scenario, ev: SimulationEvent, stages: PipelineStage[], visible: number): Line[] {
  const out: Line[] = [];
  const shown = stages.slice(0, visible);
  for (const st of shown) {
    switch (st.key) {
      case "origin": {
        const { tool, args } = toolCall(sc);
        const dev = deviceById(deviceForAction(sc.agent, sc.user))?.name;
        out.push({ tone: "neutral", head: <><b>{tool}</b>({args})</>, subs: [{ text: `${userById(sc.user)?.name ?? sc.user}${dev ? " · " + dev : ""} · ${agentById(sc.agent)?.name ?? sc.agent}` }] });
        break;
      }
      case "intercept":
        out.push({ tone: "info", head: <><b>Wrapbox</b>(intercept)</>, subs: [{ text: st.label.replace(/^Wrapbox /, "") }, { text: `${planeLabel(sc.plane)} · held before execution` }] });
        break;
      case "delegation":
      case "mcp":
      case "supplier":
      case "taint":
      case "untrusted":
      case "output":
        out.push({ tone: st.tone === "warn" ? "warn" : st.tone === "good" ? "good" : "info", head: <><b>Wrapbox</b>({st.key === "taint" || st.key === "untrusted" ? "untrusted-input" : st.key === "output" ? "output-check" : st.key})</>, subs: [{ text: st.label }, { text: st.detail, cls: st.tone === "warn" ? "warn" : st.tone === "good" ? "good" : undefined }] });
        break;
      case "normalize":
        out.push({ tone: "info", head: <><b>Wrapbox</b>(normalize)</>, subs: [{ text: st.detail }] });
        break;
      case "dest":
        out.push({ tone: st.tone === "warn" ? "warn" : "info", head: <><b>Wrapbox</b>(classify-destination)</>, subs: [{ text: st.detail, cls: st.tone === "warn" ? "warn" : undefined }] });
        break;
      case "inspect":
        out.push({ tone: st.tone === "warn" ? "warn" : "good", head: <><b>Wrapbox</b>(inspect)</>, subs: [{ text: st.detail, cls: st.tone === "warn" ? "warn" : "good" }] });
        break;
      case "blast":
        out.push({ tone: st.tone === "warn" ? "warn" : "info", head: <><b>Wrapbox</b>(blast-radius)</>, subs: [{ text: st.detail, cls: st.tone === "warn" ? "warn" : undefined }] });
        break;
      case "brain":
        out.push({
          tone: "info",
          head: <><b>Wrapbox</b>(decide) <span style={{ color: "#8a8a8a" }}>· {st.detail}</span></>,
          subs: st.items && st.items.length
            ? st.items.map((it) => ({ text: <>“{it.text}” — {it.source} → {it.effect}{it.decided ? "  ← decided" : ""}</>, cls: it.decided ? `decided ${it.effect === "BLOCK" ? "bad" : it.effect === "REVIEW" ? "warn" : it.effect === "CONSTRAIN" ? "info" : "good"}` : undefined }))
            : [{ text: "no contract or safety rule matched" }],
        });
        break;
      case "decision": {
        const t = ev.decision === "ALLOW" ? "good" : ev.decision === "CONSTRAIN" ? "info" : ev.decision === "REVIEW" ? "warn" : "bad";
        out.push({ tone: t, head: <><b>Decision</b> <span className={`aterm-d ${t}`}>{ev.decision}</span></>, subs: [{ text: st.detail, cls: t }, ...(ev.safeAlternative ? [{ text: `safer path: ${ev.safeAlternative.replace(/^Safer alternative:\s*/i, "")}` }] : [])] });
        break;
      }
      case "transform":
        out.push({ tone: "info", head: <><b>Wrapbox</b>(transform) <span style={{ color: "#8a8a8a" }}>· {st.label.replace("Transform applied: ", "")}</span></>, subs: [{ text: st.detail, cls: "info" }] });
        break;
      case "outcome": {
        const t = st.tone === "good" ? "good" : st.tone === "warn" ? "warn" : "bad";
        const approver = ev.reviewState?.approver ? userById(ev.reviewState.approver)?.name : undefined;
        out.push({ tone: t, head: <><b>{st.label}</b></>, subs: [{ text: st.detail, cls: t }, ...(ev.decision === "REVIEW" && approver ? [{ text: `waiting on ${approver} in Review Center`, cls: "warn" }] : [])] });
        break;
      }
      case "evidence":
        out.push({ tone: "neutral", head: <><b>Evidence</b> sealed</>, subs: [{ text: st.detail }] });
        break;
    }
  }
  return out;
}

export function AgentTerminal({
  scenario: sc, event, stages, visible, onOpenEvidence,
}: { scenario: Scenario; event: SimulationEvent | null; stages: PipelineStage[]; visible: number; onOpenEvidence?: () => void }) {
  const [copied, setCopied] = useState(false);
  const agent = agentById(sc.agent);
  const color = AGENT_COLOR[sc.agent] ?? "#ff8a4c";
  const isCodingTab = TABS.some((t) => t.id === sc.agent);
  const tabs = isCodingTab ? TABS : [{ id: sc.agent, name: (agent?.name ?? sc.agent).toLowerCase(), logo: "", color }, ...TABS.slice(0, 2)];
  const lines = event ? linesFor(sc, event, stages, visible) : [];
  const done = event !== null && visible >= stages.length;
  const dev = deviceById(deviceForAction(sc.agent, sc.user));

  const copyTrace = async () => {
    // Plain-text trace from the same stages the rendered lines come from.
    const plain = stages.slice(0, visible).map((st) => `● ${st.label}\n  └ ${st.detail}${st.items ? "\n" + st.items.map((i) => `  └ "${i.text}" — ${i.source} → ${i.effect}${i.decided ? " ← decided" : ""}`).join("\n") : ""}`).join("\n");
    try { await navigator.clipboard.writeText(plain); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable — nothing to do */ }
  };

  return (
    <div className="aterm" style={{ "--agent-color": color } as React.CSSProperties}>
      <div className="aterm-bar">
        <span className="lights"><i /><i /><i /></span>
        <span className="title">wrapbox-agent</span>
      </div>
      <div className="aterm-tabs">
        <div className="seg">
          {tabs.map((t) => (
            <span key={t.id} className={`aterm-tab ${t.id === sc.agent ? "active" : ""}`} title={t.id === sc.agent ? "This scenario's agent" : "Another governed agent"}>
              {t.logo ? <img src={logoUrl(t.logo)} alt="" /> : <span style={{ width: 8, height: 8, borderRadius: 4, background: t.color, display: "inline-block" }} />}
              {t.name}
            </span>
          ))}
        </div>
        <span className="plus" aria-hidden="true">+</span>
      </div>
      <div className="aterm-body">
        <div className="aterm-box">
          <span className="lbl">Wrapbox runtime v1.4.2</span>
          {agent?.name ?? sc.agent} · {planeLabel(sc.plane)} · {dev?.name ?? userById(sc.user)?.name}
        </div>
        <div className="aterm-prompt">{sc.narrative}{!event && <span className="caret" />}</div>
        {lines.map((l, i) => (
          <div key={i} className={`aterm-line ${l.tone}`}>
            <span className="dot" />
            <div>
              <div className="head">{l.head}</div>
              {l.subs.map((s, k) => <div key={k} className={`sub ${s.cls ?? ""}`}>{s.text}</div>)}
            </div>
          </div>
        ))}
        {!event && <div className="aterm-pending">… press Run to execute</div>}
        {event && !done && <div className="aterm-pending">…</div>}
      </div>
      <div className="aterm-foot">
        <button type="button" className="copy" onClick={copyTrace} disabled={!event}>
          {copied ? "Copied" : "Copy trace"} {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        {onOpenEvidence && <button type="button" className="go" onClick={onOpenEvidence} disabled={!done}>Open evidence</button>}
      </div>
    </div>
  );
}
