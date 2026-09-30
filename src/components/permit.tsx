import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { short, type Check, type Permit } from "../lib/permit";
import { cn } from "./ui";

export function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function PermitTicket({ permit, className, status }: { permit: Permit; className?: string; status?: "authorized" | "used" | "rejected" }) {
  const left = useCountdown(permit.expires_at);
  const total = Math.round((permit.expires_at - permit.issued_at) / 1000);
  const expired = left === 0;
  const label = status === "used" ? "USED ONCE" : status === "rejected" ? "REJECTED" : expired ? "EXPIRED" : "AUTHORIZED";
  const rows: [string, string][] = [
    ["subject_agent", permit.subject_agent],
    ["on_behalf_of", permit.on_behalf_of],
    ["action", permit.action],
    ["resource", permit.resource],
    ["args_hash", short(permit.args_hash)],
    ["environment", permit.environment],
    ["approved_by", permit.approved_by.length ? permit.approved_by.join(", ") : "policy (auto)"],
    ["nonce", permit.nonce + " · one-time"],
    ["signature", permit.signature.slice(0, 26) + "…"],
  ];
  return (
    <motion.div
      initial={{ scale: 0.96, opacity: 0, y: 6 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.5, bounce: 0.25 }}
      className={cn("relative rounded-2xl border border-line bg-surface shadow-card overflow-hidden", className)}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg brand-grad text-white">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <div className="text-[13px] font-semibold leading-tight">Wrapbox permit</div>
            <div className="font-mono text-[11px] text-fg-3 leading-tight">{permit.id}</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-wider",
              label === "AUTHORIZED" && "bg-allow-soft text-allow",
              label === "USED ONCE" && "bg-accent-soft text-accent",
              (label === "EXPIRED" || label === "REJECTED") && "bg-block-soft text-block",
            )}
          >
            {label}
          </span>
          <Ring left={status === "used" ? 0 : left} total={total} />
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 pb-3.5 font-mono text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-3">{k}</dt>
            <dd className="text-fg truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="perforation" />
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-2 font-mono text-[10.5px] text-fg-3">
        <span>decision {permit.decision_id}</span>
        <span>{permit.kid}</span>
      </div>
    </motion.div>
  );
}

function Ring({ left, total }: { left: number; total: number }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  const frac = total ? left / total : 0;
  return (
    <span className="relative grid place-items-center size-8" title={`${left}s until the permit expires`}>
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle cx="16" cy="16" r={r} fill="none" stroke={left > 10 ? "var(--allow)" : "var(--block)"} strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" style={{ transition: "stroke-dashoffset .25s linear" }} />
      </svg>
      <span className="font-mono text-[10px] font-semibold tnum">{left}s</span>
    </span>
  );
}

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="grid gap-1.5">
      {checks.map((c, i) => (
        <motion.li
          key={c.label}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.12 }}
          className="flex items-center gap-2 text-[12.5px]"
        >
          <span className={cn("grid size-4.5 place-items-center rounded-full text-[10px] font-bold text-white", c.ok ? "bg-allow" : "bg-block")}>{c.ok ? "✓" : "✕"}</span>
          <span className="font-medium">{c.label}</span>
          <span className={cn("ml-auto font-mono text-[11px] truncate", c.ok ? "text-fg-3" : "text-block")}>{c.detail}</span>
        </motion.li>
      ))}
    </ul>
  );
}
