import clsx, { type ClassValue } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ASSURANCE, type Assurance, type Decision } from "../data/agents";
import { photoOf, type Person } from "../data/people";
import { logoUrl } from "../lib/logos";

export const cn = (...c: ClassValue[]) => clsx(c);

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "allow";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none select-none",
        size === "sm" && "h-7 px-3 text-[12.5px]",
        size === "md" && "h-8.5 px-3.5 text-[13px]",
        size === "lg" && "h-10 px-5 text-sm",
        variant === "primary" && "bg-ink text-ink-fg hover:opacity-90",
        variant === "accent" && "bg-accent text-white hover:brightness-110",
        variant === "secondary" && "bg-surface text-fg border border-line hover:border-line-strong hover:bg-surface-2",
        variant === "ghost" && "text-fg-2 hover:text-fg hover:bg-surface-2",
        variant === "danger" && "bg-block text-white hover:brightness-110",
        variant === "allow" && "bg-allow text-white hover:brightness-110",
        className,
      )}
    >
      {children}
    </button>
  );
}

const D_STYLE: Record<Decision, string> = {
  ALLOW: "bg-allow-soft text-allow",
  CONSTRAIN: "bg-constrain-soft text-constrain",
  REVIEW: "bg-review-soft text-review",
  BLOCK: "bg-block-soft text-block",
};
export const D_DOT: Record<Decision, string> = { ALLOW: "bg-allow", CONSTRAIN: "bg-constrain", REVIEW: "bg-review", BLOCK: "bg-block" };
export const D_VAR: Record<Decision, string> = { ALLOW: "var(--allow)", CONSTRAIN: "var(--constrain)", REVIEW: "var(--review)", BLOCK: "var(--block)" };
export function DecisionPill({ d, className, size = "md" }: { d: Decision; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-mono font-semibold tracking-wide shrink-0",
        size === "sm" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]",
        D_STYLE[d],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", D_DOT[d])} />
      {d}
    </span>
  );
}

export function AssuranceBadge({ a, className }: { a: Assurance; className?: string }) {
  const info = ASSURANCE[a];
  return (
    <span title={info.desc} className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-fg-2", className)}>
      <span className="flex gap-[2px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn("h-2.5 w-[3px] rounded-full", i <= info.rank ? "bg-accent" : "bg-line-strong")} />
        ))}
      </span>
      {info.label}
    </span>
  );
}

export function Logo({ name, size = 28, bleed, className, rounded = "rounded-[8px]" }: { name: string; size?: number; bleed?: boolean; className?: string; rounded?: string }) {
  return (
    <span
      className={cn("inline-grid place-items-center overflow-hidden bg-white ring-1 ring-black/[0.07] shrink-0", rounded, className)}
      style={{ width: size, height: size }}
    >
      <img src={logoUrl(name)} alt="" draggable={false} style={{ width: bleed ? "100%" : "64%", height: bleed ? "100%" : "64%", objectFit: "contain" }} />
    </span>
  );
}

/** A tenant's mark. Real customers upload a logo; until then the monogram carries the brand gradient. */
export function CompanyMark({ name, size = 30, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn("prism-swatch inline-grid place-items-center rounded-lg font-semibold text-white shrink-0", className)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function WrapboxMark({ size = 28 }: { size?: number }) {
  return <img src={logoUrl("wrapbox-icon")} alt="Wrapbox" style={{ width: size, height: size }} className="rounded-[22%] shrink-0" />;
}

/** A person figure (head and shoulders) on the person's colour — used where we show who you are acting as. */
export function PersonFigure({ p, size = 28, badge, className }: { p: Person; size?: number; badge?: ReactNode; className?: string }) {
  const photo = photoOf(p);
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }} title={`${p.name} · ${p.role}`}>
      {photo ? (
        <img src={photo} alt="" width={size} height={size} className="size-full rounded-full object-cover" draggable={false} />
      ) : (
      <svg viewBox="0 0 32 32" width={size} height={size} className="rounded-full" aria-hidden="true">
        <defs>
          <linearGradient id={`pf-${p.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(${p.hue} 72% 66%)`} />
            <stop offset="1" stopColor={`hsl(${p.hue + 28} 62% 44%)`} />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill={`url(#pf-${p.id})`} />
        <circle cx="16" cy="12.6" r="5.4" fill="#fff" fillOpacity="0.95" />
        <path d="M5.5 29.2c1.6-5.6 5.8-8.6 10.5-8.6s8.9 3 10.5 8.6A15.9 15.9 0 0 1 16 32a15.9 15.9 0 0 1-10.5-2.8Z" fill="#fff" fillOpacity="0.95" />
      </svg>
      )}
      {badge && <span className="absolute -right-1 -bottom-1 grid size-[15px] place-items-center rounded-full bg-[#111113] text-white ring-2 ring-white">{badge}</span>}
    </span>
  );
}

export function Avatar({ p, size = 26, className }: { p: Person; size?: number; className?: string }) {
  const photo = photoOf(p);
  if (photo)
    return (
      <img
        src={photo}
        alt={p.name}
        title={`${p.name} · ${p.role}`}
        width={size}
        height={size}
        draggable={false}
        className={cn("inline-block shrink-0 rounded-full object-cover ring-2 ring-surface", className)}
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      title={`${p.name} · ${p.role}`}
      className={cn("inline-grid place-items-center rounded-full font-semibold text-white shrink-0 ring-2 ring-surface", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${p.hue} 70% 62%), hsl(${p.hue + 30} 65% 45%))`,
      }}
    >
      {p.initials}
    </span>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("wb-card rounded-2xl border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-6 pt-5 pb-4", className)}>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-fg">{title}</div>
        {sub && <div className="text-[12.5px] text-fg-3 mt-1 leading-relaxed">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-full bg-surface-2 p-0.5 border border-line", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative rounded-full font-medium transition-colors inline-flex items-center gap-1.5",
            size === "sm" ? "px-2.5 h-6 text-[12px]" : "px-3.5 h-7.5 text-[12.5px]",
            value === o.value ? "text-fg" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join("")}`} className="absolute inset-0 rounded-full bg-surface shadow-card border border-line" transition={{ type: "spring", duration: 0.35, bounce: 0.15 }} />
          )}
          <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, tone = "accent", label }: { on: boolean; onChange: (v: boolean) => void; tone?: "accent" | "block"; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-5.5 w-10 rounded-full transition-colors shrink-0", on ? (tone === "block" ? "bg-block" : "bg-accent") : "bg-line-strong")}
    >
      <motion.span layout transition={{ type: "spring", duration: 0.3, bounce: 0.2 }} className={cn("absolute top-0.5 size-4.5 rounded-full bg-white shadow", on ? "right-0.5" : "left-0.5")} />
    </button>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard blocked in sandbox — still show feedback */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 h-6 text-[11.5px] font-medium transition-colors",
        done ? "text-allow" : "text-fg-3 hover:text-fg",
        className,
      )}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid place-items-center min-w-5 h-5 px-1 rounded border border-line bg-surface-2 font-mono text-[10.5px] text-fg-3">{children}</kbd>;
}

export function Drawer({ open, onClose, children, width = 560, title }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; title?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // Portalled to <body> so the sheet always pins to the viewport edge, whatever transforms the page has.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-[#070b16]/30 backdrop-blur-[2px]" />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col rounded-none border-l border-line bg-surface shadow-float overflow-hidden"
            style={{ width: `min(${width}px, 100vw)` }}
          >
            <div className="flex items-center justify-between gap-3 px-5 h-13 border-b border-line shrink-0">
              <div className="font-semibold text-[14px] truncate">{title}</div>
              <button onClick={onClose} className="grid place-items-center size-7 rounded-full hover:bg-surface-2 text-fg-3" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Modal({ open, onClose, children, width = 520 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-[#070b16]/35 backdrop-blur-[2px]" />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.12 }}
            className="relative w-full rounded-2xl border border-line bg-surface shadow-float overflow-hidden"
            style={{ maxWidth: width }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="parallax-head flex flex-wrap items-end justify-between gap-5 mb-8">
      <div className="min-w-0 max-w-[720px]">
        {eyebrow && <div className="eyebrow mb-2.5">{eyebrow}</div>}
        <h1 className="text-[27px] leading-[1.15] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-fg-2 text-[14px] mt-2.5 leading-relaxed max-w-[64ch]">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** The evidence chain: the vertical dotted list every decision record reads as —
 *  label column, hairline connector, accent dots. Shared by the Evidence drawer and
 *  the playground so the idiom cannot drift between them. */
export function EvidenceChain({ rows, labelWidth = 80, className }: { rows: { label: string; value: ReactNode }[]; labelWidth?: number; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {rows.map((c, i) => (
        <li key={c.label} className="relative grid gap-3 pb-3.5 last:pb-0" style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}>
          {i < rows.length - 1 && <span className="absolute top-4 bottom-0 w-px bg-line" style={{ left: labelWidth + 3 }} />}
          <span className="text-[12px] text-fg-3 pt-0.5">{c.label}</span>
          <span className="relative pl-4 text-[13px] min-w-0">
            <span className="absolute left-[-1px] top-[7px] size-[7px] rounded-full bg-accent" />
            {c.value}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Dot({ tone }: { tone: "allow" | "review" | "block" | "muted" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        tone === "allow" && "bg-allow",
        tone === "review" && "bg-review",
        tone === "block" && "bg-block",
        tone === "muted" && "bg-line-strong",
        tone === "accent" && "bg-accent",
      )}
    />
  );
}

export function Chip({ children, className, tone = "muted" }: { children: ReactNode; className?: string; tone?: "muted" | "accent" | "allow" | "review" | "block" | "constrain" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium leading-none",
        tone === "muted" && "bg-surface-2 text-fg-2 border border-line",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "allow" && "bg-allow-soft text-allow",
        tone === "review" && "bg-review-soft text-review",
        tone === "block" && "bg-block-soft text-block",
        tone === "constrain" && "bg-constrain-soft text-constrain",
        className,
      )}
    >
      {children}
    </span>
  );
}
