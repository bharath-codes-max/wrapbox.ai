// Shared deck primitives (v2): reveals, type, stats, sources, brand marks,
// themed autoplay code, and small animated charts. Presentation only.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, useInView } from "framer-motion";
import { logoUrl } from "../ui/logos";
import { research, type Claim } from "./data/research";
import rplus from "./data/research-plus.json";

/* Tier-1 research corpus (53 verified claims + the hook), indexed by id. */
export interface PlusClaim { id: string; statement: string; figure: string; source_org: string; source_title: string; source_url: string; published: string; quote?: string; relevance?: string; hook_score?: number }
export const RPLUS: Record<string, PlusClaim> = {};
{
  const r = rplus as unknown as { hook?: PlusClaim; runnerUpHooks?: PlusClaim[]; byTopic?: Record<string, PlusClaim[]> };
  for (const arr of Object.values(r.byTopic ?? {})) for (const c of arr) RPLUS[c.id] = c;
  for (const c of r.runnerUpHooks ?? []) RPLUS[c.id] = c;
  if (r.hook) RPLUS[r.hook.id] = r.hook;
}
export const RHOOK = (rplus as unknown as { hook: PlusClaim }).hook;

const EASE = [0.16, 1, 0.3, 1] as const;
export const SHOT = typeof document !== "undefined" && document.documentElement.dataset.shot === "1";

/* ---------- reveals ---------- */
export function Reveal({ children, i = 0, y = 18, className, style, delay = 0 }: { children: React.ReactNode; i?: number; y?: number; className?: string; style?: React.CSSProperties; delay?: number }) {
  return (
    <motion.div className={className} style={style} initial={SHOT ? false : { opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.07 + delay }}>
      {children}
    </motion.div>
  );
}

/* ---------- text ---------- */
export const Eyebrow = ({ children }: { children: React.ReactNode }) => <div className="eyebrow"><i />{children}</div>;
export const Display = ({ children, sm, xs, className = "", style }: { children: React.ReactNode; sm?: boolean; xs?: boolean; className?: string; style?: React.CSSProperties }) => <h1 className={`display ${sm ? "sm" : ""} ${xs ? "xs" : ""} ${className}`} style={style}>{children}</h1>;
export const Lead = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <p className="lead" style={style}>{children}</p>;
export function Head({ eyebrow, title, lead }: { eyebrow: React.ReactNode; title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="head-row">
      <div><Reveal><Eyebrow>{eyebrow}</Eyebrow></Reveal><Reveal i={1}><Display sm>{title}</Display></Reveal></div>
      {lead && <Reveal i={2}><Lead style={{ fontSize: 21 }}>{lead}</Lead></Reveal>}
    </div>
  );
}

/* ---------- numbers ---------- */
export function CountUp({ to, decimals = 0, suffix = "", prefix = "", duration = 1.1, className, style }: { to: number; decimals?: number; suffix?: string; prefix?: string; duration?: number; className?: string; style?: React.CSSProperties }) {
  const reduced = useReducedMotion() || SHOT;
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [v, setV] = useState(reduced ? to : 0);
  useEffect(() => {
    if (!inView || reduced) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / (duration * 1000)); const e = 1 - Math.pow(1 - p, 3); setV(to * e); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduced]);
  return <span ref={ref} className={className} style={style}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

export function Stat({ value, label, sub, n, md, ink, i = 0, brand }: { value: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; n?: number; md?: boolean; ink?: boolean; i?: number; brand?: string }) {
  return (
    <Reveal i={i} className="stat">
      <div className={`v ${md ? "md" : ""} ${ink ? "ink" : ""}`}>{value}{n !== undefined && <sup className="sup">{n}</sup>}</div>
      <div className="l">{label}</div>
      {sub && <div className="s">{brand && <Brand name={brand} size={22} />}{sub}</div>}
    </Reveal>
  );
}

/* ---------- sources ---------- */
export function fmtDate(p: string): string {
  const m = p.match(/\d{4}-\d{2}(-\d{2})?/);
  if (m && !/accessed/i.test(p.slice(0, m.index))) return m[0];
  return /accessed/i.test(p) ? "accessed 2026-09" : p.slice(0, 12);
}
export function claimById(id: string): Claim | undefined {
  for (const t of Object.values(research.topics)) { const c = t.claims.find((x) => x.id === id); if (c) return c; }
  return undefined;
}
export function claimsOf(topic: string): Claim[] { return research.topics[topic]?.claims ?? []; }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** v2/v3: one clean row of numbered source chips — organisation and month, full title on hover. */
function SourceChips({ ids }: { ids: string[] }) {
  const items = ids.map((id, k) => {
    const c = claimById(id);
    if (!c) return null;
    const org = c.source_org.replace(/\s*\(.*$/, "").replace(/ Software Technologies$/, "").trim();
    const m = fmtDate(c.published).match(/^(\d{4})-(\d{2})/);
    const when = m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
    return { n: k + 1, org, when, title: `${c.source_org} — ${c.source_title}`, url: c.source_url };
  }).filter(Boolean) as { n: number; org: string; when: string; title: string; url: string }[];
  if (!items.length) return null;
  return (
    <div className="srcrow" aria-label="Sources">
      <span className="srcrow-label">Sources</span>
      {items.map((s) => (
        <a key={s.n} className="srcchip" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
          <b>{s.n}</b>{s.org}{s.when && <span>{s.when}</span>}
        </a>
      ))}
    </div>
  );
}
export function Sources({ ids }: { ids: string[] }) {
  if (typeof document !== "undefined" && document.documentElement.dataset.deck) return <SourceChips ids={ids} />;
  const org = (s: string) => (s.length > 30 ? s.slice(0, 28) + "…" : s);
  const items = ids.map((id, k) => { const c = claimById(id); return c ? { n: k + 1, label: `${org(c.source_org)} — ${c.source_title.length > 46 ? c.source_title.slice(0, 44) + "…" : c.source_title} (${fmtDate(c.published)})`, url: c.source_url } : null; }).filter(Boolean) as { n: number; label: string; url: string }[];
  if (!items.length) return null;
  return <div className="sources" aria-label="Sources">{items.map((s) => <span key={s.n}><b>{s.n}</b> <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</div>;
}

/* ---------- brand marks ---------- */
const brandFiles = import.meta.glob("./brands/*.{svg,png}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const brandByName: Record<string, string> = {};
for (const [p, u] of Object.entries(brandFiles)) brandByName[p.split("/").pop()!.replace(/\.(svg|png)$/, "")] = u;
export function brandUrl(name: string): string { return brandByName[name] ?? logoUrl(name); }
export function Brand({ name, size = 36, bare, title, style }: { name: string; size?: number; bare?: boolean; title?: string; style?: React.CSSProperties }) {
  return <span className={`brand ${bare ? "bare" : ""}`} style={{ width: size, height: size, borderRadius: Math.round(size / 4), ...style }} title={title ?? name}><img src={brandUrl(name)} alt={title ?? name} /></span>;
}

/* ---------- autoplay code (themed by CSS) ---------- */
type Tok = { c: string; t?: string };
const KW = /\b(const|let|function|return|if|else|for|of|export|import|from|interface|type|switch|case|break|default|new|true|false|null|undefined|async|await|throw|in|as)\b/;
function tokenize(src: string, lang: string): Tok[] {
  const out: Tok[] = [];
  const re = lang === "yaml" || lang === "bash"
    ? /(#.*$)|("[^"]*"|'[^']*')|(^\s*[\w.-]+(?=:))|(\b\d+(?:\.\d+)?\b)|(\b(?:ALLOW|CONSTRAIN|REVIEW|BLOCK|true|false)\b)|([^\s#"']+|\s+)/gm
    : /(\/\/.*$|\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Z][A-Za-z0-9_]*\b)|([A-Za-z_$][\w$]*)(?=\()|([A-Za-z_$][\w$]*)|([{}()[\],;:.<>=+\-*/!?&|]+)|(\s+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const s = m[0];
    if (lang === "yaml" || lang === "bash") {
      if (m[1]) out.push({ c: s, t: "c" }); else if (m[2]) out.push({ c: s, t: "s" }); else if (m[3]) out.push({ c: s, t: "t" }); else if (m[4]) out.push({ c: s, t: "n" }); else if (m[5]) out.push({ c: s, t: "k" }); else out.push({ c: s });
    } else {
      if (m[1]) out.push({ c: s, t: "c" }); else if (m[2]) out.push({ c: s, t: "s" }); else if (m[3]) out.push({ c: s, t: "n" }); else if (m[4]) out.push({ c: s, t: "t" }); else if (m[5]) out.push({ c: s, t: "f" }); else if (m[6]) out.push({ c: s, t: KW.test(s) ? "k" : undefined }); else if (m[7]) out.push({ c: s, t: "p" }); else out.push({ c: s });
    }
  }
  return out;
}
export function TypeCode({ code, lang = "ts", title, active = true, cps = 55, delay = 0.4, style, autoScroll = true }: { code: string; lang?: "ts" | "yaml" | "bash"; title?: string; active?: boolean; cps?: number; delay?: number; style?: React.CSSProperties; autoScroll?: boolean }) {
  const reduced = useReducedMotion() || SHOT;
  const [n, setN] = useState(reduced ? code.length : 0);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!active) return;
    if (reduced) { setN(code.length); return; }
    setN(0);
    let i = 0; let iv = 0;
    const t0 = window.setTimeout(() => {
      iv = window.setInterval(() => {
        i += 1 + (Math.random() < 0.35 ? 1 : 0);
        if (i >= code.length) { i = code.length; window.clearInterval(iv); }
        setN(i);
      }, 1000 / cps);
    }, delay * 1000);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); };
  }, [code, active, cps, delay, reduced]);
  useEffect(() => { if (autoScroll && pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [n, autoScroll]);
  const toks = useMemo(() => tokenize(code.slice(0, n), lang), [code, n, lang]);
  return (
    <div className="code" style={style}>
      <div className="cbar"><span className="lights"><i /><i /><i /></span><span>{title ?? (lang === "yaml" ? "policy.yaml" : lang === "bash" ? "terminal" : "engine.ts")}</span></div>
      <pre ref={pre}>{toks.map((t, k) => t.t ? <span key={k} className={t.t}>{t.c}</span> : t.c)}{n < code.length && <span className="cursor" />}</pre>
    </div>
  );
}

/* ---------- charts ---------- */
export function Donut({ pct, size = 260, stroke = 26, label, sub }: { pct: number; size?: number; stroke?: number; label: React.ReactNode; sub?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--acc)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} initial={SHOT ? { strokeDashoffset: c * (1 - pct / 100) } : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }} transition={{ duration: 1.3, ease: EASE, delay: 0.3 }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div><div style={{ fontSize: size * 0.24, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1 }}>{label}</div>{sub && <div className="small" style={{ marginTop: 6 }}>{sub}</div>}</div>
      </div>
    </div>
  );
}
export function Bars({ items, height = 300, fmt = (v: number) => String(v) }: { items: { label: string; value: number; note?: string }[]; height?: number; fmt?: (v: number) => string }) {
  const max = Math.max(...items.map((i) => i.value));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 28, alignItems: "end", height }}>
      {items.map((it, k) => {
        const h = Math.max(6, (it.value / max) * (height - 84));
        return (
          <div key={it.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
            <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1 }}>{fmt(it.value)}</div>
            {it.note && <div className="small" style={{ fontSize: 14, color: "var(--acc)", fontWeight: 700 }}>{it.note}</div>}
            <motion.div initial={SHOT ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.3 + k * 0.15 }} style={{ width: "100%", height: h, borderRadius: 14, background: k === items.length - 1 ? "var(--acc)" : "color-mix(in oklab, var(--acc) 45%, var(--surface-2))", transformOrigin: "bottom" }} />
            <div className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>{it.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- research clippings (source logo + title + real quote) ---------- */
const SRC_LOGO: [RegExp, string][] = [
  [/ibm/i, "ibm"], [/gartner/i, "gartner"], [/microsoft|m365|copilot|entra/i, "microsoft"], [/owasp/i, "owasp"], [/nist/i, "nist"],
  [/\bwiz\b/i, "wiz"], [/register/i, "theregister"], [/euronews/i, "euronews"], [/anthropic|claude/i, "anthropic"],
  [/cloud security alliance|\bcsa\b/i, "csa"], [/stack ?overflow/i, "stackoverflow"], [/\bmetr\b/i, "metr"],
  [/google|\bdora\b/i, "googlecloud"], [/general analysis/i, "generalanalysis"], [/netskope/i, "netskope"],
  [/palo alto/i, "paloalto"], [/sentinelone/i, "sentinelone"], [/check ?point/i, "checkpoint"], [/cisco/i, "cisco"], [/\bf5\b/i, "f5"],
  [/replit/i, "replit"], [/cursor/i, "cursor"], [/amazon|aws/i, "aws"], [/kong/i, "kong"], [/cloudflare/i, "cloudflare"],
];
export function srcLogo(org: string): string | null { for (const [re, k] of SRC_LOGO) if (re.test(org)) return k; return null; }
function initials(org: string): string { return org.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }

export function Clip({ brand, org, title, headline, quote, date, url, i = 0, tone, tint }: { brand?: string; org: string; title?: string; headline?: React.ReactNode; quote?: string; date?: string; url?: string; i?: number; tone?: "block" | "review"; tint?: number }) {
  const logo = brand ?? srcLogo(org);
  const meta = [title, date].filter(Boolean).join(" · ");
  const cls = `clip ${tone ? `clip-${tone}` : ""} ${tint ? `clip-t${((tint - 1) % 6) + 1}` : ""}`;
  const inner = (
    <>
      <div className="clip-bar">
        {logo ? <Brand name={logo} size={34} /> : <span className="clip-mono">{initials(org)}</span>}
        <div className="clip-src"><b>{org}</b>{meta && <small>{meta}</small>}</div>
        {url && <span className="clip-ext">↗</span>}
      </div>
      {headline && <div className="clip-head">{headline}</div>}
      {quote && <div className="clip-quote">“{quote}”</div>}
    </>
  );
  return (
    <Reveal i={i}>
      {url
        ? <a className={cls} href={url} target="_blank" rel="noreferrer">{inner}</a>
        : <div className={cls}>{inner}</div>}
    </Reveal>
  );
}

/* ---------- misc ---------- */
export const Chip = ({ tone, children }: { tone: "allow" | "constrain" | "review" | "block" | "neutral"; children: React.ReactNode }) => <span className={`chip ${tone}`}>{children}</span>;
export const Pill = ({ children, acc, logo, brand, className = "" }: { children: React.ReactNode; acc?: boolean; logo?: string; brand?: string; className?: string }) => <span className={`pill ${acc ? "acc" : ""} ${className}`}>{logo && <img src={logoUrl(logo)} alt="" />}{brand && <img src={brandUrl(brand)} alt="" />}{children}</span>;
export const decisionTone = (d: string) => (d === "ALLOW" ? "allow" : d === "CONSTRAIN" ? "constrain" : d === "REVIEW" ? "review" : "block") as "allow" | "constrain" | "review" | "block";
