import { AnimatePresence, motion } from "motion/react";
import { agentById } from "../data/agents";
import { personById } from "../data/people";
import { clock } from "../lib/router";
import type { Evt } from "../lib/store";
import { Avatar, DecisionPill, Logo, cn } from "./ui";

export function DecisionRow({ e, onClick, compact }: { e: Evt; onClick?: () => void; compact?: boolean }) {
  const a = agentById(e.agentId);
  const p = personById(e.human);
  return (
    <motion.button
      layout="position"
      initial={{ opacity: 0, y: -8, backgroundColor: "color-mix(in oklab, var(--accent) 8%, transparent)" }}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.5 }}
      onClick={onClick}
      className={cn(
        "group grid w-full items-center gap-3.5 border-b border-line last:border-0 px-5 text-left hover:!bg-surface-2 transition-colors",
        compact ? "grid-cols-[62px_1fr_auto] py-3" : "grid-cols-[62px_88px_minmax(0,1fr)_auto] py-3.5",
      )}
    >
      <span className="font-mono text-[11px] text-fg-3 tnum">{clock(e.ts)}</span>
      {!compact && (
        <span className="flex flex-col items-start gap-0.5">
          <DecisionPill d={e.decision} size="sm" />
          {e.observed && <span className="font-mono text-[9.5px] text-review">would {e.observed}</span>}
        </span>
      )}
      <span className="flex items-center gap-2.5 min-w-0">
        <Logo name={a.logo} bleed={a.bleed} size={22} rounded="rounded-md" />
        <span className="min-w-0">
          <span className="block text-[12.5px] text-fg-2 truncate">
            <span className="font-medium text-fg">{a.name}</span>
            {p && <span className="text-fg-3"> · {p.name.split(" ")[0]}</span>}
          </span>
          <span className="block font-mono text-[11.5px] text-fg truncate">{e.action}</span>
        </span>
      </span>
      <span className="flex items-center gap-2.5">
        {compact && <DecisionPill d={e.decision} size="sm" />}
        {!compact && <span className="hidden xl:inline font-mono text-[11px] text-fg-3 truncate max-w-[140px]">{e.rule}</span>}
        {/* A receipt carries no timing, so latency arrives as 0 for live
            decisions. Rendering "0 ms" would invent a measurement. */}
        <span className="font-mono text-[11px] text-fg-3 tnum w-9 text-right">{e.latency > 0 ? `${e.latency} ms` : "—"}</span>
        {!compact && p && <Avatar p={p} size={20} className="hidden md:inline-grid" />}
      </span>
    </motion.button>
  );
}

export function DecisionStream({ events, limit = 12, compact, onPick }: { events: Evt[]; limit?: number; compact?: boolean; onPick?: (e: Evt) => void }) {
  return (
    <div className="relative">
      <AnimatePresence initial={false}>
        {events.slice(0, limit).map((e) => (
          <DecisionRow key={e.id} e={e} compact={compact} onClick={onPick ? () => onPick(e) : undefined} />
        ))}
      </AnimatePresence>
    </div>
  );
}
