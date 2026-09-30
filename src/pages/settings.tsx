// Settings — demo data reset + what is real vs simulated.
import { useState } from "react";
import { resetDemoData, useAppState, metrics } from "../state/store";
import { PageHead, SectionHead, MetricBar, SimNote, Chip, PageTabs } from "../ui/kit";
import { RotateCcw, CheckCircle2, FlaskConical, Server } from "lucide-react";
import { ORG } from "../model/org";

// Honest map of the prototype — the exact same claims as before, presented as refined rows.
const REAL: string[] = [
  "The decision engine, in its real order: your rules, Safety Kernel, blast radius, context, task slips, standing permissions, break-glass",
  "State transitions: approvals and routing to the right approver, park/resume, break-glass scope and expiry, revoke and grant-again",
  "Safety Kernel observe → enforce: a new rule really only records until switched on",
  "Policy Simulator: your recorded history is really replayed through a draft",
  "Transformations: payloads genuinely change; tokens genuinely link to the vault",
  "Every counter and chart derives from the event store",
  "Policy changes genuinely change simulation outcomes",
  "Evidence chains built per-event with linked hashes",
];
const SIMULATED: string[] = [
  "All integrations: GitHub, SQL, AWS, Stripe, support desk, MCP, Okta SSO, Endpoint Security, Network Extension",
  "Intent drafting uses a built-in sentence parser, not a hosted AI model",
  "Safety Kernel releases ship inside the app — there is no real update server",
  "Notifications (break-glass, approvers) are recorded on the page, never sent",
  "Detector/OCR/semantic analysis results (registry-shaped fixtures)",
  `${ORG.name} org, users, devices and traffic history`,
  "Evidence signing: events are chained with a simple FNV hash for illustration — not a cryptographic signature",
];

function HonestList({ items, tone }: { items: string[]; tone: string }) {
  return (
    <div>
      {items.map((t, i) => (
        <div
          key={i}
          className="row honest-item"
          style={{ gap: 11, alignItems: "flex-start", padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--${tone})`, marginTop: 7, flexShrink: 0 }} />
          <span className="small dim" style={{ lineHeight: 1.55 }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

export function SettingsPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const m = metrics(s);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="page">
      <PageHead
        eyebrow="System"
        title="Settings"
        sub="Wrapbox Real Prototype — demo environment controls."
        right={<SimNote />}
      />

      {/* Environment overview — context up top, with the env figures woven into one refined strip */}
      <div className="card overview-card">
        <div className="spread" style={{ alignItems: "flex-start", gap: 20 }}>
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <span className="stat-icon" style={{ color: "var(--accent)", background: "var(--accent-soft)", flexShrink: 0 }}><Server size={17} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="section-title">Demo environment</div>
              <div className="section-sub">State persists in your browser across refreshes. Every figure derives from the live event store.</div>
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="eyebrow">Workspace</div>
            <div className="small" style={{ marginTop: 5, color: "var(--fg-2)", fontWeight: 600 }}>{ORG.name}</div>
          </div>
        </div>
        <div className="overview-sep" />
        <MetricBar band items={[
          { label: "Events", value: m.total, note: "decisions recorded" },
          { label: "Contracts", value: s.contracts.length, tone: "info", note: "policies in force" },
          { label: "Vault tokens", value: s.tokens.length, tone: "good", note: "linked to the vault" },
          { label: "Tasks", value: s.tasks.length, note: "agent workflows" },
        ]} />
      </div>

      <PageTabs
        storageKey="settings"
        tabs={[
          {
            id: "real-vs-simulated",
            label: "Real vs simulated",
            content: (
              /* The trust centerpiece — an honest, side-by-side map of what is real vs simulated */
              <div>
                <SectionHead title="What is real vs simulated" sub="An honest map of this prototype — real logic where you can test it, representative fixtures for expensive integrations." />
                <div className="grid g2">
                  <div className="card">
                    <div className="spread" style={{ marginBottom: 14, alignItems: "center", gap: 12 }}>
                      <div className="row" style={{ gap: 11, minWidth: 0 }}>
                        <span className="stat-icon" style={{ color: "var(--good)", background: "var(--good-soft)", flexShrink: 0 }}><CheckCircle2 size={16} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="card-title" style={{ margin: 0 }}>Real — live behavior</div>
                          <div className="small faint">Genuine logic you can exercise in the product</div>
                        </div>
                      </div>
                      <Chip tone="allow">LIVE</Chip>
                    </div>
                    <HonestList items={REAL} tone="good" />
                  </div>
                  <div className="card">
                    <div className="spread" style={{ marginBottom: 14, alignItems: "center", gap: 12 }}>
                      <div className="row" style={{ gap: 11, minWidth: 0 }}>
                        <span className="stat-icon" style={{ color: "var(--warn)", background: "var(--warn-soft)", flexShrink: 0 }}><FlaskConical size={16} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="card-title" style={{ margin: 0 }}>Simulated — representative</div>
                          <div className="small faint">Realistic fixtures standing in for expensive integrations</div>
                        </div>
                      </div>
                      <Chip tone="review">SIMULATED</Chip>
                    </div>
                    <HonestList items={SIMULATED} tone="warn" />
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: "reset",
            label: "Reset demo data",
            content: (
              /* Utility action — destructive and clearly guarded; confirm state lives at page level */
              <div>
                <SectionHead title="Reset demo data" sub={`Go back to ${ORG.short}'s starting point: the seed history and contracts, Safety Kernel v2026.09.1 (so the 2026.09.2 update box appears again), the seed standing permissions and Autopilot suggestions. Everything you added is discarded.`} />
                <div className="card">
                  <div className="spread" style={{ gap: 16, alignItems: "center" }}>
                    <div className="row" style={{ gap: 12, minWidth: 0 }}>
                      <span className="stat-icon" style={{ color: "var(--bad)", background: "var(--bad-soft)", flexShrink: 0 }}><RotateCcw size={16} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="small" style={{ fontWeight: 600 }}>Restore {ORG.short}'s starting point</div>
                        <div className="small faint">Everything you added this session is discarded and cannot be recovered.</div>
                      </div>
                    </div>
                    {!confirming && (
                      <button className="btn btn-danger" onClick={() => setConfirming(true)}>
                        <RotateCcw size={13} /> Reset demo data
                      </button>
                    )}
                  </div>
                  {confirming && (
                    <div className="row" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                      <span className="small">Discard your events, reviews, tasks, drafts, break-glass history, vault restores and kernel changes, and restore the seed? This can't be undone.</span>
                      <button className="btn btn-danger btn-sm" onClick={() => { resetDemoData(); setConfirming(false); nav("control"); }}>Yes, reset</button>
                      <button className="btn btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
