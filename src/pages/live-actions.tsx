// Live Action Stream — human-readable real-time chain with full filtering.
import { useAppState, metrics } from "../state/store";
import { PageHead, SimNote } from "../ui/kit";
import { EventStream } from "../ui/event-stream";

const DECISIONS = [
  { key: "ALLOW", tone: "allow", label: "Allowed" },
  { key: "CONSTRAIN", tone: "constrain", label: "Constrained" },
  { key: "REVIEW", tone: "review", label: "Reviewed" },
  { key: "BLOCK", tone: "block", label: "Blocked" },
] as const;

export function LiveActions({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const m = metrics(s);
  const notes: Record<(typeof DECISIONS)[number]["key"], string> = {
    ALLOW: "flowed automatically",
    CONSTRAIN: `${m.transfersTransformed} sensitive transfer(s) transformed`,
    REVIEW: "escalated to a human",
    BLOCK: "stopped before execution",
  };
  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Activity"
        title="Live Actions"
        sub="Every consequential action across Endpoint, Network and Gateway — user → agent → tool → action → resource → decision. Click any row for full evidence."
        right={<SimNote />}
      />

      {/* Hero — the live decision stream, led by a slim decision-mix band */}
      <div className="card overview-card">
        <div className="spread" style={{ alignItems: "baseline", gap: 20 }}>
          <div style={{ minWidth: 0 }}>
            <div className="section-title">Live decision stream</div>
            <div className="section-sub">
              {m.total} consequential action{m.total === 1 ? "" : "s"} recorded, newest first — filter by agent, user, plane, decision or risk.
            </div>
          </div>
          <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>Decision mix</span>
        </div>

        <div className="decision-track" style={{ marginTop: 16 }}>
          {DECISIONS.map((d) => {
            const c = m.counts[d.key];
            if (c === 0) return null;
            return (
              <div
                key={d.key}
                className="decision-seg"
                style={{ flex: c, background: `var(--${d.tone})`, cursor: "default" }}
                title={`${d.label}: ${c}`}
              >
                {m.total > 0 && c / m.total > 0.06 && <span>{c}</span>}
              </div>
            );
          })}
          {m.total === 0 && <div className="decision-seg" style={{ flex: 1, cursor: "default" }} />}
        </div>

        <div className="decision-legend">
          {DECISIONS.map((d) => (
            <div key={d.key} className="decision-leg" style={{ cursor: "default" }}>
              <span className="dot" style={{ background: `var(--${d.tone})` }} />
              <span className="n" style={{ color: `var(--${d.tone})` }}>{m.counts[d.key]}</span>
              <span className="lbl">{d.label} · {notes[d.key]}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <EventStream events={s.events} nav={nav} />
      </div>
    </div>
  );
}
