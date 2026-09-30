// Cover · Understand · Research (numbers, the gap)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlideProps } from "../deck";
import { Display, Lead, Reveal, Head, Stat, Sources, Brand, Clip, RPLUS, claimById, fmtDate } from "../ui";
import { research } from "../data/research";
import { decideOnce, scenario } from "../live";
import { pipelineFor } from "../../engine/simulate";
import { AgentTerminal } from "../../ui/agent-terminal";
import { WrapboxWordmark } from "../../ui/logo";
import type { SimulationEvent } from "../../model/types";

/* ---------- cover ---------- */
const COVER_IDS = ["ep-read-env", "net-pii-approved", "gw-force-main", "ep-run-tests"];
function AutoTerm({ active, onDecision }: { active: boolean; onDecision: (d: string | null) => void }) {
  const [i, setI] = useState(0);
  const [event, setEvent] = useState<SimulationEvent | null>(null);
  const [visible, setVisible] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const sc = scenario(COVER_IDS[i % COVER_IDS.length]);
  const stages = useMemo(() => (event ? pipelineFor(sc, event) : []), [sc, event]);
  useEffect(() => { if (!active) return; const t = setTimeout(() => { setEvent(decideOnce(sc, "genesis")); setVisible(0); }, 900); return () => clearTimeout(t); }, [active, sc]);
  useEffect(() => {
    if (!event) { onDecision(null); return; }
    if (visible < stages.length) { const t = setTimeout(() => setVisible((v) => v + 1), 480); return () => clearTimeout(t); }
    onDecision(event.decision); // the engine's own answer, lit once the trace reaches it
    const t = setTimeout(() => { setEvent(null); setI((k) => k + 1); }, 2600); return () => clearTimeout(t);
  }, [event, visible, stages.length, onDecision]);
  // Fixed-size window: new lines scroll inside it instead of growing the terminal.
  useEffect(() => { const b = box.current?.querySelector<HTMLElement>(".aterm-body"); if (b) b.scrollTo({ top: b.scrollHeight, behavior: "smooth" }); }, [visible, event]);
  return <div ref={box} className="cover-term"><AgentTerminal scenario={sc} event={event} stages={stages} visible={visible} /></div>;
}

const DECISIONS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];
export function Cover({ active }: SlideProps) {
  const [dec, setDec] = useState<string | null>(null);
  const onDecision = useCallback((d: string | null) => setDec(d), []);
  return (
    <div className="cols cols-53" style={{ height: "100%", alignItems: "center", gap: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 30 }}>
        <Reveal><WrapboxWordmark height={28} /></Reveal>
        <Reveal i={1}><Display>Runtime authorization for <em>AI agents.</em></Display></Reveal>
        <Reveal i={2}><Lead>Wrapbox decides whether each agent action is safe from its action, environment, data, destination and blast radius.</Lead></Reveal>
        <Reveal i={3} className="dec cover-dec" aria-label="The four decisions">
          {DECISIONS.map((d) => <span key={d} className={`${d.toLowerCase()} ${dec === d ? "lit" : ""}`}>{d}</span>)}
        </Reveal>
        <Reveal i={4} className="row" style={{ gap: 14, marginTop: 6 }}>
          <span className="small">Governs</span>
          <div className="brand-row">{["claudecode", "codex", "cursor", "githubcopilot", "openai", "microsoft", "mcp"].map((l) => <Brand key={l} name={l} size={38} />)}</div>
          <span className="small">plus your own, browser, hosted and supplier agents</span>
        </Reveal>
      </div>
      <Reveal i={2}><AutoTerm active={active} onDecision={onDecision} /></Reveal>
    </div>
  );
}

/* ---------- understand: incident timeline ---------- */
// Real documented incidents — each a press clipping: the subject's own logo, the
// outlet, the article title/date, and a verbatim quote from the reporting.
const INCIDENT_CLIPS: { rid: string; brand: string; head: string }[] = [
  { rid: "plus-incidents-3", brand: "cursor", head: "9 seconds: the database and every backup." },
  { rid: "plus-incidents-1", brand: "replit", head: "Deleted production during a code freeze." },
  { rid: "plus-incidents-2", brand: "aws", head: "A wiper prompt shipped to ~1M installs." },
  { rid: "plus-incidents-6", brand: "microsoft", head: "Zero-click Copilot exfiltration · CVSS 9.3." },
];
export function Understand() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Understand · 01" title={<>Agents don't ask. <em>They act.</em></>} lead="Not hypotheticals — reported by the press of record and the labs themselves. One shape every time: a capable agent, a real task, one action nobody authorized." />
      <div className="cols cols-4" style={{ gap: 18, flex: 1, alignItems: "stretch" }}>
        {INCIDENT_CLIPS.map((x, k) => {
          const c = RPLUS[x.rid];
          return c ? <Clip key={x.rid} i={k + 2} tone="block" tint={k + 1} brand={x.brand} org={c.source_org} title={c.source_title} date={fmtDate(c.published)} quote={c.quote} url={c.source_url} headline={x.head} /> : null;
        })}
      </div>
      <Reveal i={6} className="card acc" style={{ marginTop: 20, padding: "18px 26px" }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>In every case the “don't” lived in a prompt. Nothing outside the model stood between the agent and the action.</span>
      </Reveal>
    </div>
  );
}

/* ---------- research: the hook + the numbers, as clippings ---------- */
const STAT_CLIPS = ["plus-hook-2", "plus-scale-5", "plus-hook-3", "plus-scale-10"];
export function Numbers() {
  const hook = RPLUS["plus-hook-1"];
  const hookNum = hook?.figure.match(/\d+%|\d[\d,.]*/)?.[0] ?? "97%";
  const corpus = 53 + Object.values(research.topics).reduce((a, t) => a + t.claims.length, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Research · 02" title={<>Everyone is deploying. <em>Almost no one is authorizing.</em></>} lead="Every figure is a real clipping — the source's own words, logo and date. Click any card to open it." />
      <div className="cols" style={{ gridTemplateColumns: "1fr 1fr", gap: 44, flex: 1, alignItems: "stretch" }}>
        {hook && (
          <Reveal i={2}>
            <a className="card hook" href={hook.source_url} target="_blank" rel="noreferrer" style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, textDecoration: "none", padding: "34px 38px" }}>
              <div className="row" style={{ gap: 12 }}><Brand name="ibm" size={40} /><span style={{ fontWeight: 700, fontSize: 16 }}>IBM · Cost of a Data Breach 2025</span></div>
              <div style={{ fontSize: 168, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 0.9 }}>{hookNum}</div>
              <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, maxWidth: "20ch" }}>of AI-breached organizations had no AI access controls in place.</div>
              {hook.quote && <div className="body" style={{ fontSize: 15, fontStyle: "italic", opacity: 0.82 }}>“{hook.quote}”</div>}
            </a>
          </Reveal>
        )}
        <div className="clip-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16, minHeight: 0 }}>
          {STAT_CLIPS.map((rid, k) => {
            const c = RPLUS[rid];
            return c ? <Clip key={rid} i={k + 3} tint={k + 3} org={c.source_org} title={c.source_title} date={fmtDate(c.published)} headline={c.figure} quote={c.quote} url={c.source_url} /> : null;
          })}
        </div>
      </div>
      <Reveal i={7} className="row" style={{ gap: 14, marginTop: 16 }}>
        <span className="label">Research corpus</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{corpus} claims from tier-1 sources — every one re-fetched and verified before it went on a slide.</span>
      </Reveal>
    </div>
  );
}

/* ---------- research: the gap (action path) ---------- */
const PATH = [
  { t: "Identity · SSO", a: "who may log in", brands: ["okta"] },
  { t: "Network · DLP", a: "what bytes leave", brands: ["netskope", "zscaler"] },
  { t: "AI gateway", a: "what the model is told", brands: ["kong", "cloudflare"] },
];
const STANDARDS = [
  { ids: ["regulation-10", "regulation-9"], brand: "owasp", t: "OWASP LLM Top 10 · 2025", s: "Authorization checks “must not be delegated to the LLM”; high-impact actions need human approval." },
  { ids: ["regulation-4", "regulation-5"], brand: "flag-eu", t: "EU AI Act · Art. 14 & 12", s: "A person must be able to stop the system; events must be logged automatically for traceability." },
  { ids: ["regulation-7"], brand: "nist", t: "NIST SP 800-53 overlays · 2025", s: "Two of the five proposed overlays are for AI agents — coding assistants and MCP included." },
];
export function Gap() {
  const src = STANDARDS.flatMap((s) => s.ids);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Research · 03" title={<>The gap is <em>the moment of execution.</em></>} lead="Every existing control answers a different question. None of them stands where the agent acts." />
      <Reveal i={2} style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr 1fr 1.4fr 170px", gap: 14, alignItems: "stretch", minHeight: 250 }}>
        <div className="tile" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}><div className="label">Person</div><div style={{ fontSize: 19, fontWeight: 600 }}>asks an agent to do a task</div></div>
        {PATH.map((p) => (
          <div key={p.t} className="tile" style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "center" }}>
            <div className="brand-row">{p.brands.map((b) => <Brand key={b} name={b} size={36} />)}</div>
            <div style={{ fontSize: 21, fontWeight: 700 }}>{p.t}</div>
            <div className="small" style={{ fontSize: 16 }}>answers: <b style={{ color: "var(--ink-2)" }}>{p.a}</b></div>
          </div>
        ))}
        <div className="tile" style={{ background: "var(--acc)", color: "var(--acc-ink)", borderColor: "transparent", display: "flex", flexDirection: "column", gap: 10, justifyContent: "center" }}>
          <div style={{ font: "700 12.5px var(--sans)", letterSpacing: ".12em", textTransform: "uppercase", opacity: 0.85 }}>The action — nobody decides here</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>read · upload · push · query · deploy</div>
          <div style={{ fontSize: 16, opacity: 0.92 }}>Where Wrapbox sits: ALLOW · CONSTRAIN · REVIEW · BLOCK, before it happens.</div>
        </div>
        <div className="tile" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}><div className="label">Resource</div><div className="brand-row">{["github_light", "postgresql", "aws"].map((b) => <Brand key={b} name={b} size={36} />)}</div></div>
      </Reveal>
      <Reveal i={3} className="label" style={{ margin: "34px 0 14px" }}>Why it is becoming a requirement</Reveal>
      <div className="cols cols-3" style={{ gap: 18 }}>
        {STANDARDS.map((s, k) => {
          const n = src.indexOf(s.ids[0]) + 1;
          return (
            <Reveal key={s.t} i={k + 4} className="card" style={{ display: "flex", gap: 20, alignItems: "flex-start", padding: "24px 26px" }}>
              <Brand name={s.brand} size={54} />
              <div><div style={{ fontSize: 21, fontWeight: 700 }}>{s.t}<sup className="sup">{n}{s.ids.length > 1 ? `,${n + 1}` : ""}</sup></div><div className="body" style={{ fontSize: 17, marginTop: 8 }}>{s.s}</div></div>
            </Reveal>
          );
        })}
      </div>
      <Sources ids={src} />
    </div>
  );
}

export { Stat };
