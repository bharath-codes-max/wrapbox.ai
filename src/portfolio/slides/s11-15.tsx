// Prototype (architecture, intent, decision) · Test · Close
import { useMemo } from "react";
import type { SlideProps } from "../deck";
import { Display, Eyebrow, Reveal, Head, Pill, Chip, Brand, decisionTone } from "../ui";
import { ArchFlow, DrafterDemo, LiveDecide, decideOnce } from "../live";
import { SCENARIOS } from "../../engine/scenarios";
import { DEMO_CONTRACTS } from "../../model/contracts";

// Counted from the test files at build time — never typed in.
const TEST_SOURCES = import.meta.glob("../../../tests/*.test.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const TEST_COUNT = Object.values(TEST_SOURCES).reduce((n, src) => n + (src.match(/^test\(/gm)?.length ?? 0), 0);
import { CAPABILITIES, DETECTORS } from "../../model/registries";
import { KERNEL_RULES } from "../../engine/kernel";

/* ---------- prototype: architecture ---------- */
export function Architecture({ active }: SlideProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Prototype · 08" title={<>One engine. <em>Five planes.</em></>} lead="Every action is held where it happens, described with its full identity chain, decided once and chained into evidence. The animation is the real engine deciding real scenarios." />
      <Reveal i={3} style={{ flex: 1, minHeight: 0 }}><ArchFlow active={active} /></Reveal>
      <div style={{ height: 36 }} />
    </div>
  );
}

/* ---------- prototype: intent ---------- */
export function IntentLive({ active }: SlideProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Prototype · 09" title={<>Plain English in. <em>Policy out.</em></>} lead="The drafter compiles a sentence into one normalized rule; each clause declares the capability it needs, so coverage is only claimed where the runtime can deliver. Edit the text — the policy follows." />
      <Reveal i={3} style={{ flex: 1, minHeight: 0 }}><DrafterDemo active={active} /></Reveal>
    </div>
  );
}

/* ---------- prototype: decision ---------- */
export function DecisionLive({ active }: SlideProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Prototype · 10" title={<>The decision, <em>live.</em></>} lead="Pick a scenario. The terminal is what the developer sees; the list is the order the engine checks and which layer decided. The kill switch comes first, strictest wins, and break-glass never overrides the Safety Kernel." />
      <Reveal i={3} style={{ flex: 1, minHeight: 0 }}><LiveDecide active={active} /></Reveal>
    </div>
  );
}

/* ---------- test ---------- */
const PLANE_LABEL: Record<string, string> = { ENDPOINT: "Endpoint", NETWORK: "Network", GATEWAY: "Gateway", BROWSER: "Browser", HOSTED: "Hosted" };
export function Tested() {
  // Every scenario in the product, run through the real engine right now.
  const results = useMemo(() => { let h = "genesis"; return SCENARIOS.filter((s) => s.group !== "TASK").map((sc) => { const ev = decideOnce(sc, h); h = ev.evidence.hash; return { sc, ev }; }); }, []);
  const counts = { ALLOW: 0, CONSTRAIN: 0, REVIEW: 0, BLOCK: 0 } as Record<string, number>;
  results.forEach((r) => { counts[r.ev.decision] += 1; });
  const planes = ["ENDPOINT", "NETWORK", "GATEWAY", "BROWSER", "HOSTED"];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Test · 11" title={<>Tested, <em>not claimed.</em></>} lead={<>Every scenario below was just evaluated by the engine inside this deck — {results.length} scenarios across five planes, {counts.BLOCK} blocked, {counts.REVIEW} held for review, {counts.CONSTRAIN} transformed, {counts.ALLOW} allowed.</>} />
      <div className="cols" style={{ gridTemplateColumns: "1fr 380px", gap: 40, flex: 1, minHeight: 0, alignItems: "start" }}>
        <div className="stack" style={{ gap: 10 }}>
          {planes.map((p, k) => (
            <Reveal key={p} i={2 + k} className="row" style={{ gap: 14, alignItems: "flex-start" }}>
              <div className="label" style={{ width: 80, paddingTop: 8 }}>{PLANE_LABEL[p]}</div>
              <div className="smx compact" style={{ flex: 1 }}>
                {results.filter((r) => r.sc.plane === p).map(({ sc, ev }) => (
                  <div key={sc.id} className={`cell ${decisionTone(ev.decision)}`} title={`${sc.narrative} → ${ev.decision} (decided by ${ev.decidedBy?.layer ?? "default"})`}>
                    <span className="t">{sc.title}</span><span className="d">{ev.decision}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <Reveal i={3} className="card tint" style={{ padding: "20px 22px" }}>
            <div className="cols cols-3" style={{ gap: 10 }}>
              {[[String(TEST_COUNT), "tests"], [String(results.length), "scenarios"], [String(DEMO_CONTRACTS.length), "contracts"]].map(([v, l]) => <div key={l}><div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: "var(--acc)" }}>{v}</div><div className="small" style={{ fontSize: 14 }}>{l}</div></div>)}
            </div>
            <div className="small" style={{ marginTop: 12, fontSize: 14 }}>node:test over the engine, store, onboarding, break-glass and the agentic checks · {CAPABILITIES.length} capabilities · {DETECTORS.length} detectors · {KERNEL_RULES.length} kernel rules</div>
          </Reveal>
          <Reveal i={4} className="card" style={{ padding: "18px 22px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>What is real</div>
            <div className="body" style={{ fontSize: 15 }}>Every decision, transform, review, coverage figure and evidence hash — kill switch, MCP rules, supplier and delegation checks, output checks, OCSF/OTLP export.</div>
            <div style={{ fontSize: 17, fontWeight: 700, margin: "12px 0 6px" }}>What is simulated</div>
            <div className="body" style={{ fontSize: 15 }}>Vendor integrations — GitHub, MDM, SSO, SQL/AWS/Stripe gateways, browser extension, AgentCore, suppliers, SIEM streaming — realistic flows, never fake results.</div>
          </Reveal>
          <Reveal i={5} className="honest" style={{ fontSize: 15 }}>“Prototype the infrastructure. Never prototype the correctness.” — the bar every screen is held to.</Reveal>
          <Reveal i={6} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {(["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"] as const).map((d) => <Chip key={d} tone={decisionTone(d)}>{d} · {counts[d]}</Chip>)}
          </Reveal>
        </div>
      </div>
    </div>
  );
}

/* ---------- close ---------- */
const ROADMAP = [
  { h: "Endpoint runtime", p: "macOS Endpoint Security + Windows minifilter behind the same ActionRequest; pushed by Jamf / Intune." },
  { h: "Network Extension", p: "System extension + content filter for HTTPS/WebSocket; detectors move from fixtures to live parsers." },
  { h: "Gateways & hosted", p: "GitHub App, SQL proxy, AWS broker role, SaaS key swap, MCP gateway + stdio shim, AgentCore interceptor, managed browser extension." },
  { h: "Identity & evidence", p: "SSO / SCIM for approvers, signed records streamed to the SIEM (OCSF / OTLP export already works), retention." },
];
export function Close() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Test · 12 · What's next" title={<>From prototype <em>to production.</em></>} lead="The engine, the model and the screens are the product. What remains is the plumbing I deliberately simulated — known engineering, known vendor surfaces." />
      <div className="cols cols-4" style={{ gap: 18 }}>
        {ROADMAP.map((r, k) => <Reveal key={r.h} i={k + 2} className="card tint" style={{ padding: "26px 28px", minHeight: 250 }}><div className="mono" style={{ fontSize: 14, color: "var(--acc)", marginBottom: 10, fontWeight: 700 }}>0{k + 1}</div><div className="h3" style={{ fontSize: 24 }}>{r.h}</div><p className="body" style={{ fontSize: 17, marginTop: 10 }}>{r.p}</p></Reveal>)}
      </div>
      <div className="cols cols-2" style={{ gap: 40, marginTop: "auto", alignItems: "end" }}>
        <Reveal i={6} className="card acc" style={{ padding: "22px 26px" }}>
          <div style={{ font: "700 13px var(--sans)", letterSpacing: ".12em", textTransform: "uppercase", opacity: 0.85, marginBottom: 8 }}>With a design partner · first 90 days</div>
          <p style={{ fontSize: 19, lineHeight: 1.45 }}>One team already using coding agents. Their own intent contracts. Runtime on their laptops, one gateway in front of their most sensitive system — and a Coverage Map that tells the truth about the rest.</p>
        </Reveal>
        <Reveal i={7} style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end", textAlign: "right" }}>
          <Display sm style={{ fontSize: 60 }}>Thank you.</Display>
          <div className="body">Bharath Salla · Wrapbox</div>
          <div className="row" style={{ gap: 8 }}><Pill acc>wrapbox.io</Pill></div>
          <div className="small">Press <span className="kbd">Home</span> to start over</div>
        </Reveal>
      </div>
    </div>
  );
}

export { Eyebrow, Chip, Brand };
