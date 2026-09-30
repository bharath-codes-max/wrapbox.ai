import { AnimatePresence, motion } from "motion/react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Decision } from "../data/agents";
import type { Signal } from "../data/scenarios";
import { settlePasskey, useStore } from "../lib/store";
import { Avatar, Button, D_VAR, Logo, cn } from "./ui";

/* ---------- Risk signals: the deterministic context behind a decision ---------- */
const LEVEL_TONE = ["bg-allow", "bg-[#c9a227]", "bg-review", "bg-block"];
const LEVEL_TEXT = ["low", "guarded", "elevated", "severe"];

export function Signals({ signals, dense }: { signals: Signal[]; dense?: boolean }) {
  return (
    <div className={cn("grid gap-1", dense ? "grid-cols-1" : "sm:grid-cols-2")}>
      {signals.map((s) => (
        <div key={s.k} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 min-w-0">
          <span className="flex gap-[2px] shrink-0" title={LEVEL_TEXT[s.level]}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn("h-3 w-[3px] rounded-full", i < s.level ? LEVEL_TONE[s.level] : s.level === 0 && i === 0 ? "bg-allow" : "bg-line-strong")} />
            ))}
          </span>
          <span className="text-[11px] text-fg-3 shrink-0">{s.k}</span>
          <span className="text-[11.5px] text-fg truncate ml-auto text-right">{s.v}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Decision space: impact × trust, where every action lands ---------- */
export interface SpacePoint {
  id: string;
  x: number;
  y: number;
  d: Decision;
  label?: string;
}

export function DecisionSpace({ points, highlight, height = 300, mini, onPick }: { points: SpacePoint[]; highlight?: SpacePoint; height?: number; mini?: boolean; onPick?: (id: string) => void }) {
  const W = 560;
  const H = height;
  const pad = mini ? { l: 14, r: 10, t: 10, b: 14 } : { l: 34, r: 14, t: 14, b: 32 };
  const X = (v: number) => pad.l + v * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const [hover, setHover] = useState<SpacePoint | null>(null);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Decision space: impact versus trust">
        <defs>
          <linearGradient id="zone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--allow)" stopOpacity="0.07" />
            <stop offset="0.55" stopColor="var(--review)" stopOpacity="0.05" />
            <stop offset="1" stopColor="var(--block)" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <rect x={X(0)} y={Y(1)} width={X(1) - X(0)} height={Y(0) - Y(1)} rx="10" fill="url(#zone)" stroke="var(--line)" />
        <line x1={X(0.5)} x2={X(0.5)} y1={Y(1)} y2={Y(0)} stroke="var(--line-strong)" strokeDasharray="3 5" />
        <line x1={X(0)} x2={X(1)} y1={Y(0.5)} y2={Y(0.5)} stroke="var(--line-strong)" strokeDasharray="3 5" />
        {!mini && (
          <g fontSize="10.5" fontFamily="var(--font-sans)" fill="var(--fg-3)">
            <text x={X(0.02)} y={Y(0.96)}>Autonomy zone</text>
            <text x={X(0.98)} y={Y(0.96)} textAnchor="end">Human zone</text>
            <text x={X(0.02)} y={Y(0.04)}>Constrain zone</text>
            <text x={X(0.98)} y={Y(0.04)} textAnchor="end">Deny zone</text>
            <text x={X(0.5)} y={H - 8} textAnchor="middle" fill="var(--fg-2)">Impact → reversibility · blast radius · environment · amount</text>
            <text transform={`translate(12 ${Y(0.5)}) rotate(-90)`} textAnchor="middle" fill="var(--fg-2)">Trust → identity · provenance · delegation</text>
          </g>
        )}
        {points.map((p) => (
          <circle
            key={p.id}
            cx={X(p.x)}
            cy={Y(p.y)}
            r={mini ? 3 : 4}
            fill={D_VAR[p.d]}
            fillOpacity={highlight ? 0.25 : 0.75}
            stroke="var(--surface)"
            strokeWidth="1"
            className={onPick ? "cursor-pointer" : undefined}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(p.id)}
          />
        ))}
        {highlight && (
          <g>
            <motion.circle cx={X(highlight.x)} cy={Y(highlight.y)} r={mini ? 10 : 12} fill="none" stroke={D_VAR[highlight.d]} strokeWidth="2" initial={{ r: 2, opacity: 0 }} animate={{ r: mini ? 10 : 12, opacity: 1 }} />
            <circle cx={X(highlight.x)} cy={Y(highlight.y)} r={mini ? 5 : 6} fill={D_VAR[highlight.d]} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover?.label && !mini && (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[70%] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] shadow-card">
          <span className="font-mono">{hover.label}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Passkey: the approver's device signs the exact action ---------- */
export function PasskeyModal() {
  const ask = useStore((s) => s.passkey);
  const [stage, setStage] = useState<"idle" | "scan" | "done">("idle");
  useEffect(() => {
    if (!ask) return;
    setStage("idle");
    const a = setTimeout(() => setStage("scan"), 350);
    const b = setTimeout(() => setStage("done"), 1350);
    const c = setTimeout(() => settlePasskey(true), 1850);
    return () => [a, b, c].forEach(clearTimeout);
  }, [ask]);
  return (
    <AnimatePresence>
      {ask && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#070b16]/40 backdrop-blur-[3px]" onClick={() => settlePasskey(false)} />
          <motion.div initial={{ y: 14, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 8, opacity: 0 }} className="relative w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6 text-center shadow-float">
            <div className="mx-auto flex items-center justify-center gap-2">
              <Avatar p={ask.person} size={28} />
              <span className="text-[13px] font-medium">{ask.person.name}</span>
            </div>
            <div className="relative mx-auto mt-5 grid size-20 place-items-center">
              <motion.span
                className={cn("absolute inset-0 rounded-full border-2", stage === "done" ? "border-allow" : "border-accent/40")}
                animate={stage === "scan" ? { scale: [1, 1.12, 1], opacity: [0.6, 1, 0.6] } : { scale: 1 }}
                transition={{ repeat: stage === "scan" ? Infinity : 0, duration: 0.9 }}
              />
              {stage === "done" ? <ShieldCheck className="size-9 text-allow" /> : <Fingerprint className={cn("size-10", stage === "scan" ? "text-accent" : "text-fg-3")} />}
            </div>
            <div className="mt-4 text-[15px] font-semibold">{stage === "done" ? "Approval signed" : "Confirm with passkey"}</div>
            <p className="mt-1 text-[12.5px] text-fg-2 leading-relaxed">{ask.title}</p>
            <p className="mt-2 font-mono text-[11px] text-fg-3 break-all">{ask.detail}</p>
            <p className="mt-3 text-[11px] text-fg-3">Signed with a device-bound key. A click alone can't approve — so a piped stdin or a spoofed UI can't either.</p>
            {stage !== "done" && (
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => settlePasskey(false)}>
                Cancel
              </Button>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Slack approval notification preview ---------- */
export function SlackCard({ who, title, lines, onApprove, onReject, done }: { who: string; title: string; lines: [string, string][]; onApprove?: () => void; onReject?: () => void; done?: "approved" | "rejected" }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 h-9 border-b border-line bg-surface-2">
        <Logo name="slack" size={18} rounded="rounded" />
        <span className="text-[12px] font-medium">Slack</span>
        <span className="text-[11.5px] text-fg-3">· direct message to {who}</span>
      </div>
      <div className="flex gap-3 p-3.5">
        <span className="grid size-9 place-items-center rounded-lg bg-nav shrink-0">
          <svg width="20" height="20" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="9" y="9" width="22" height="22" rx="6" stroke="#9db6ff" strokeWidth="2.6" />
            <path d="M20 4 H30 a6 6 0 0 1 6 6 V20" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M15 20.5 l3.5 3.5 L26 16" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px]">
            <b>Wrapbox</b> <span className="rounded bg-surface-3 px-1 text-[10px] text-fg-3">APP</span> <span className="text-[11px] text-fg-3">now</span>
          </div>
          <div className="mt-1 text-[13px] font-semibold">{title}</div>
          <div className="mt-1.5 border-l-4 border-review pl-2.5 space-y-0.5">
            {lines.map(([k, v]) => (
              <div key={k} className="text-[12px]">
                <span className="text-fg-3">{k}: </span>
                <span className="font-mono text-[11.5px]">{v}</span>
              </div>
            ))}
          </div>
          {done ? (
            <div className={cn("mt-2.5 text-[12px] font-medium", done === "approved" ? "text-allow" : "text-block")}>{done === "approved" ? "✓ Approved with passkey" : "✕ Rejected"}</div>
          ) : (
            <div className="mt-2.5 flex gap-2">
              <button onClick={onApprove} className="h-7 rounded-md bg-[#007a5a] px-3 text-[12px] font-semibold text-white hover:brightness-110">
                Approve with passkey
              </button>
              <button onClick={onReject} className="h-7 rounded-md border border-line px-3 text-[12px] font-semibold hover:bg-surface-2">
                Reject
              </button>
              <button className="h-7 rounded-md border border-line px-3 text-[12px] font-semibold text-fg-2 hover:bg-surface-2">Open in Wrapbox</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
