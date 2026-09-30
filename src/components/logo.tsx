import { useId } from "react";
import { cn } from "./ui";

/** The Wrapbox mark, drawn exactly as on the pitch site: a box, the wrapping seal, and the verified tick. */
export function WrapboxLogo({ size = 30, tone = "dark", className }: { size?: number; tone?: "dark" | "light"; className?: string }) {
  const id = useId().replace(/:/g, "");
  const ink = tone === "dark" ? "#ffffff" : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", tone === "dark" ? "drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" : "text-fg drop-shadow-[0_2px_6px_rgba(24,72,255,0.18)]", className)}
    >
      <defs>
        <linearGradient id={`wbg-${id}`} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor={tone === "dark" ? "#9db6ff" : "#5a82ff"} />
          <stop offset="1" stopColor={tone === "dark" ? "#4f7bff" : "#1848ff"} />
        </linearGradient>
      </defs>
      <rect className="wb-box" x="9" y="9" width="22" height="22" rx="6" stroke={`url(#wbg-${id})`} strokeWidth="2.4" />
      <path className="wb-seal" d="M20 4 H30 a6 6 0 0 1 6 6 V20" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      <path className="wb-tick" d="M15 20.5 l3.5 3.5 L26 16" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The app-icon lockup from the brand files: the mark on a navy rounded tile, box low-left, seal reaching the top-right. */
export function WrapboxTile({ size = 36, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`wbt-${id}`} x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a9beff" />
          <stop offset="1" stopColor="#4f7bff" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="9.6" fill="#111c35" />
      <g transform="translate(-3.27 -3.27) scale(1.164)">
        <rect className="wb-box" x="9" y="9" width="22" height="22" rx="6" stroke={`url(#wbt-${id})`} strokeWidth="2.4" />
        <path className="wb-seal" d="M20 4 H30 a6 6 0 0 1 6 6 V20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <path className="wb-tick" d="M15 20.5 l3.5 3.5 L26 16" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Tile + "Wrapbox" in ink, exactly like the brand wordmark file. */
export function WrapboxLockup({ size = 22 }: { size?: number }) {
  return (
    <span className="wb-logo inline-flex items-center select-none" style={{ gap: Math.round(size * 0.5) }}>
      <WrapboxTile size={Math.round(size * 1.75)} />
      <span style={{ fontFamily: "var(--font-brand)", fontSize: size * 1.12, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg)", lineHeight: 1 }}>Wrapbox</span>
    </span>
  );
}

export function WrapboxWordmark({ tone = "dark", size = 18 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span className="wb-logo inline-flex items-center gap-[11px] select-none">
      <WrapboxLogo size={Math.round(size * 1.67)} tone={tone} />
      <span style={{ fontFamily: "var(--font-brand)", fontSize: size, fontWeight: 700, letterSpacing: "-0.3px", color: tone === "dark" ? "#fff" : "var(--fg)" }}>Wrapbox</span>
    </span>
  );
}
