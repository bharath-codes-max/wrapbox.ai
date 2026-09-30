// Demo Mode — guided investor/customer walkthrough that operates through the
// actual product screens (not a slideshow). Steps navigate, and where marked,
// run real simulations whose events propagate everywhere.
import { useAppState, setDemoStep, simulateById, startTask, advanceTask, getState } from "../state/store";
import { ORG } from "../model/org";

interface DemoStep {
  title: string;
  text: string;
  route: string;
  action?: () => void;
}

const STEPS: DemoStep[] = [
  {
    title: "Welcome to Wrapbox",
    text: `One brain, five enforcement planes. Every number on this Control Room derives from live event state — nothing is a static mock. This is ${ORG.name}, three days into a pilot.`,
    route: "control",
  },
  {
    title: "Agents already discovered",
    text: "Wrapbox inventories every agent it observes — including a shadow MCP agent nobody registered. Observation never grants authority; the unknown agent's transfers are treated as fail-safe UNKNOWN_EXTERNAL.",
    route: "agents",
  },
  {
    title: "The company's rule, in plain language",
    text: "Intent Studio holds the enterprise intent: customer emails and phones must be reversibly tokenized before external AI. Each clause compiles to data classes, destinations, actions and a required-capability list — coverage is claimed truthfully.",
    route: "intent",
  },
  {
    title: "An employee uploads customer data to AI…",
    text: "In the Simulation Lab, Priya attaches customers.csv to the approved AI. Watch the right panel: interception → parsing → PII detection → contract clause → CONSTRAIN.",
    route: "simlab/network",
  },
  {
    title: "…and Wrapbox tokenizes it in-flight",
    text: "The 'Customer PII → approved AI' scenario has just run. The AI receives EMAIL_TOKEN_001 — never the real address. Originals are sealed in the Token Vault; work continues without a single approval prompt.",
    route: "simlab/network",
    action: () => simulateById("net-pii-approved"),
  },
  {
    title: "Credential exfiltration attempt",
    text: "Now an unknown program tries to send a private key to an unknown site. A company credential rule blocks it — and the Safety Kernel fires as a second lock. Its ‘zero rules’ preview shows it would still block this even if the company had written no rules at all.",
    route: "safety",
    action: () => simulateById("sk-privkey-exfil"),
  },
  {
    title: "Endpoint: local actions are governed",
    text: "Claude Code reads source code freely — but its attempt to read .env is classified SECRET_ACCESS and blocked at the endpoint. Same brain, different plane.",
    route: "simlab/endpoint",
    action: () => { simulateById("ep-read-src"); simulateById("ep-read-env"); },
  },
  {
    title: "Gateway: context and blast radius",
    text: "The same DELETE verb: a 12-row disposable test DB is allowed; the 8.4M-row production payment DB is blocked. Context changed the decision — not the verb.",
    route: "simlab/context",
    action: () => { simulateById("ctx-del-testdb"); simulateById("ctx-del-proddb"); },
  },
  {
    title: "A 10-step task with one risky step",
    text: "Claude Code runs 'Fix checkout and deploy'. Step 6 — the production deploy — parks for approval. Independent steps 7–9 continue. Nothing freezes unnecessarily.",
    route: "tasks",
    action: () => {
      const st = getState();
      if (!st.tasks.some((t) => t.status === "parked" || t.status === "active")) {
        const t = startTask();
        advanceTask(t.taskId);
      }
    },
  },
  {
    title: "Approve the exception — scoped",
    text: "Review Center holds only exceptions, bundled per task, with blast radius, expiry and a safer alternative. Approve the parked deploy ('Approve scoped') and watch the task resume automatically.",
    route: "reviews",
  },
  {
    title: "Prove exactly what happened",
    text: "Evidence links the whole causal chain: user → agent → tool → action → findings → policy → decision → enforcement → outcome, hash-chained event to event. Switch to 'Causal graph' view.",
    route: "evidence",
  },
  {
    title: "Coverage — honestly",
    text: "The Coverage Map shows where enforcement is strong, degraded, or missing. Clipboard control is PENDING; encrypted archives are UNINSPECTABLE and fail closed. A believable product shows its gaps.",
    route: "coverage",
  },
  {
    title: "Back to the Control Room",
    text: "Every event this demo generated is now reflected here — blocked secrets, transformed transfers, the pending or resumed deploy. One brain. Five planes. Every decision proven.",
    route: "control",
  },
];

export const DEMO_SCRIPT = {
  steps: STEPS,
  start(nav: (r: string) => void) {
    setDemoStep(0);
    nav(STEPS[0].route);
  },
};

export function DemoBar({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const i = s.demoStep;
  if (i < 0) return null;
  const step = STEPS[i];
  const go = (n: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, n));
    setDemoStep(clamped);
    const st = STEPS[clamped];
    st.action?.();
    nav(st.route);
  };
  return (
    <div className="demo-bar">
      <div style={{ minWidth: 0, flex: 3 }}>
        <div className="demo-step-label">
          <span className="faint mono small">{i + 1}/{STEPS.length}</span> {step.title}
        </div>
        <div className="small dim" style={{ marginTop: 2 }}>{step.text}</div>
      </div>
      <div className="demo-progress" style={{ maxWidth: 120 }}>
        <div className="demo-progress-fill" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
      </div>
      <div className="row" style={{ flexShrink: 0 }}>
        <button className="btn btn-sm" disabled={i === 0} onClick={() => go(i - 1)}>← Previous</button>
        {i < STEPS.length - 1
          ? <button className="btn btn-primary btn-sm" onClick={() => go(i + 1)}>Next →</button>
          : <button className="btn btn-good btn-sm" onClick={() => { setDemoStep(-1); }}>Finish</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => go(0)}>↺ Restart</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDemoStep(-1)}>Exit</button>
      </div>
    </div>
  );
}
