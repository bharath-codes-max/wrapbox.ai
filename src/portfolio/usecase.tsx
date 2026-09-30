// Use-case slides — one user, one journey per slide. Every spec in usecases.json
// was extracted from the product source and verified (function names, verbatim
// snippet, scenario id, persona). The demo on the left is real: scenario cases
// run the engine through AgentTerminal; the rest autoplay the actual code.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { SlideProps } from "./deck";
import { Reveal, Eyebrow, Display, Lead, TypeCode, Pill, SHOT } from "./ui";
import { decideOnce, scenario } from "./live";
import { pipelineFor } from "../engine/simulate";
import { AgentTerminal } from "../ui/agent-terminal";
import { photoOf } from "../ui/logos";
import type { SimulationEvent } from "../model/types";
import raw from "./data/usecases.json";

export interface UseCase {
  id: string; title: string;
  persona: { role: string; name: string; userId: string };
  why: string; pages: string[];
  steps: { ui: string; system: string }[];
  codePath: string[];
  snippet: { file: string; code: string };
  outcome: string; evidence: string; scenarioId: string; realVsSimulated: string;
}
export const USECASES: UseCase[] = ((raw as unknown as { cases?: UseCase[] }).cases ?? []).filter((c) => c && c.title);

/* ---------- a fixed scenario, run once through the real engine ---------- */
function ScenarioTerm({ id, active, onComplete }: { id: string; active: boolean; onComplete: () => void }) {
  const sc = useMemo(() => scenario(id), [id]);
  const [event, setEvent] = useState<SimulationEvent | null>(null);
  const [visible, setVisible] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const stages = useMemo(() => (event ? pipelineFor(sc, event) : []), [sc, event]);
  useEffect(() => {
    if (!active || !sc) return;
    const t = setTimeout(() => { setEvent(decideOnce(sc, "genesis")); setVisible(SHOT ? 99 : 0); }, 600);
    return () => clearTimeout(t);
  }, [active, sc]);
  useEffect(() => {
    if (!event || SHOT) return;
    if (visible < stages.length) { const t = setTimeout(() => setVisible((v) => v + 1), 520); return () => clearTimeout(t); }
    const t = setTimeout(onComplete, 3400); // hold the decision on screen, then hand over
    return () => clearTimeout(t);
  }, [event, visible, stages.length, onComplete]);
  // Keep the newest line (and finally the decision) in view, like a real terminal.
  useEffect(() => { const body = wrap.current?.querySelector<HTMLElement>(".aterm-body"); if (body) body.scrollTop = body.scrollHeight; }, [visible, event]);
  if (!sc) return null;
  return <div ref={wrap} className="ucterm"><AgentTerminal scenario={sc} event={event} stages={stages} visible={Math.min(visible, stages.length)} /></div>;
}

/* ---------- scenario cases alternate: the engine deciding, then the code that decided ---------- */
const CODE_HOLD_MS = 7000;
function ScenarioDemo({ uc, active }: { uc: UseCase; active: boolean }) {
  const [mode, setMode] = useState<"term" | "code">("term");
  const [run, setRun] = useState(0);
  useEffect(() => { if (active) { setMode("term"); setRun((r) => r + 1); } }, [active]);
  useEffect(() => {
    if (mode !== "code" || SHOT) return;
    const t = setTimeout(() => { setMode("term"); setRun((r) => r + 1); }, CODE_HOLD_MS);
    return () => clearTimeout(t);
  }, [mode]);
  const toCode = useCallback(() => setMode("code"), []);
  return (
    <div className="ucterm">
      {mode === "term"
        ? <motion.div key={`t${run}`} className="ucterm" initial={SHOT ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}><ScenarioTerm id={uc.scenarioId} active={active} onComplete={toCode} /></motion.div>
        : <motion.div key="c" className="uc-code" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}><TypeCode code={uc.snippet.code} lang="ts" title={uc.snippet.file} active cps={150} delay={0.1} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} /></motion.div>}
    </div>
  );
}

/* ---------- the user's steps, lit in sequence (what they click → what runs) ---------- */
function StepFlow({ steps, active }: { steps: UseCase["steps"]; active: boolean }) {
  const [cur, setCur] = useState(SHOT ? 1 : -1);
  useEffect(() => {
    if (!active || SHOT) return;
    setCur(-1);
    const iv = window.setInterval(() => setCur((c) => (c + 1) % (steps.length + 1)), 1600);
    return () => window.clearInterval(iv);
  }, [active, steps.length]);
  return (
    <ol className="ucsteps">
      {steps.map((s, k) => (
        <li key={k} className={`ucstep ${k < cur ? "done" : ""} ${k === cur ? "cur" : ""}`}>
          <span className="ucstep-n">{k + 1}</span>
          <span className="ucstep-body"><span className="ucstep-ui">{s.ui}</span><span className="ucstep-sys">{s.system}</span></span>
        </li>
      ))}
    </ol>
  );
}

function Face({ userId, name, size = 34 }: { userId: string; name: string; size?: number }) {
  const src = photoOf(userId);
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const st = { width: size, height: size };
  return src ? <img className="ucface" style={st} src={src} alt="" /> : <span className="ucface ucface-mono" style={st}>{initials}</span>;
}

/* ---------- the intro slide ---------- */
export function UseCasesIntro() {
  // Derived from the cases themselves — never typed in.
  const personas = new Set(USECASES.map((c) => c.persona.userId)).size;
  const screens = new Set(USECASES.flatMap((c) => c.pages.map((p) => p.replace(/\s*\(.*\)$/, "")))).size;
  const live = USECASES.filter((c) => c.scenarioId && scenario(c.scenarioId)).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 26 }}>
      <div>
        <Reveal><Eyebrow>Use cases · one user at a time</Eyebrow></Reveal>
        <Reveal i={1}><Display sm>{USECASES.length} journeys through the product.</Display></Reveal>
        <Reveal i={2}><Lead style={{ fontSize: 21, marginTop: 14 }}>The next {USECASES.length} slides each follow one person onto one screen: why they come, what they do, and exactly what Wrapbox does underneath — with the real engine running and the real code on the slide. It is the long way round; bear with us.</Lead></Reveal>
      </div>
      <div className="ucgrid">
        {USECASES.map((uc, k) => (
          <Reveal key={uc.id} i={3 + k * 0.4} className="uccell">
            <Face userId={uc.persona.userId} name={uc.persona.name} />
            <span className="uccell-n">{String(k + 1).padStart(2, "0")}</span>
            <span className="uccell-t">{uc.title}</span>
            <span className="uccell-p">{uc.persona.role} · {uc.pages[0]}</span>
          </Reveal>
        ))}
        <Reveal i={3 + USECASES.length * 0.4} className="uccell uccell-sum">
          <span className="uccell-t">{personas} people · {screens} screens · one engine</span>
          <span className="uccell-p">{live} journeys run the engine live on the slide; {USECASES.length - live} autoplay the code that runs. Every function named is in the repo.</span>
        </Reveal>
      </div>
    </div>
  );
}

/** The extracted call chains carry arguments and nested arrows; on a slide we show
 *  short, unique `name()` chips in order (first 8). */
function chips(path: string[]): string[] {
  const out: string[] = [];
  for (const entry of path) {
    for (const raw of entry.split(/\s*(?:->|→)\s*/)) {
      let t = raw.trim();
      if (!t) continue;
      const m = t.match(/^([A-Za-z_$][\w$.]*)\s*\(/);
      if (m) t = `${m[1]}()`;
      t = t.replace(/\s*[—–-]\s.*$/, "").replace(/\s*\(.*$/, "").trim();
      if (t.length > 34) t = t.slice(0, 32) + "…";
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 8);
}

/* ---------- one use case ---------- */
export function UseCaseSlide({ uc, n, active }: { uc: UseCase; n: number } & SlideProps) {
  const hasScenario = !!uc.scenarioId && !!scenario(uc.scenarioId);
  const path = chips(uc.codePath);
  const pages = uc.pages.map((p) => p.replace(/\s*\(.*\)$/, "")).slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="uchead">
        <Reveal><Eyebrow>Use case {String(n).padStart(2, "0")} · {uc.persona.role}</Eyebrow></Reveal>
        <Reveal i={1}><Display className="uc">{uc.title}</Display></Reveal>
      </div>
      <div className="cols" style={{ gridTemplateColumns: "minmax(0, 0.94fr) minmax(0, 1.06fr)", gap: 30, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {/* left: the real demo, then what it leaves behind */}
        <Reveal i={2} className="ucdemo">
          {hasScenario
            ? <ScenarioDemo uc={uc} active={active} />
            : <div className="uc-code" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}><TypeCode code={uc.snippet.code} lang="ts" title={uc.snippet.file} active={active} cps={110} delay={0.3} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} /></div>}
          <div className="ucfoot">
            <div className="ucrow"><span className="uclabel">Recorded</span><span className="uctext sm">{uc.evidence}</span></div>
            <div className="ucrow"><span className="uclabel">Screens</span><span className="row" style={{ gap: 6, flexWrap: "wrap" }}>{pages.map((p) => <Pill key={p} className="sm">{p}</Pill>)}</span></div>
            <div className="ucreal">{uc.realVsSimulated}</div>
          </div>
        </Reveal>
        {/* right: who, why, what they do, what Wrapbox does, result */}
        <Reveal i={3} className="ucpanel">
          <div className="ucrow">
            <span className="uclabel">Who</span>
            <span className="row" style={{ gap: 12 }}><Face userId={uc.persona.userId} name={uc.persona.name} size={38} /><span><b style={{ fontSize: 17 }}>{uc.persona.name}</b><span className="small" style={{ display: "block", fontSize: 14 }}>{uc.persona.role}</span></span></span>
          </div>
          <div className="ucrow"><span className="uclabel">Why they come</span><span className="uctext">{uc.why}</span></div>
          <div className="ucrow"><span className="uclabel">What they do</span><StepFlow steps={uc.steps} active={active} /></div>
          <div className="ucrow"><span className="uclabel">Wrapbox does</span>
            <span className="ucpath">{path.map((p, k) => <span key={k}><code>{p}</code>{k < path.length - 1 && <i>→</i>}</span>)}</span>
          </div>
          <div className="ucrow"><span className="uclabel">Result</span><span className="uctext strong">{uc.outcome}</span></div>
        </Reveal>
      </div>
    </div>
  );
}
