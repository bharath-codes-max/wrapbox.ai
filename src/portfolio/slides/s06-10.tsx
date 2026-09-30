// Research (market, landscape) · Synthesize · Ideate
import { useEffect, useRef, useState } from "react";
import { Reveal, Head, Sources, Brand, Bars, claimById, fmtDate, Chip } from "../ui";
import { research } from "../data/research";
import { photoOf } from "../../ui/logos";

/* ---------- research: market value ---------- */
const DEALS = [
  { id: "market-8", a: "paloalto", b: "protectai", t: "Protect AI", n: "$634.5M · Jul 2025" },
  { id: "market-10", a: "checkpoint", b: "lakera", t: "Lakera", n: "Sep 2025" },
  { id: "market-9", a: "sentinelone", b: "promptsecurity", t: "Prompt Security", n: "Aug 2025" },
  { id: "market-12", a: "f5", b: "", t: "CalypsoAI", n: "$180M · Sep 2025" },
  { id: "market-11", a: "cisco", b: "astrix", t: "Astrix", n: "May 2026" },
];
export function Market() {
  const g = claimById("market-2"), seg = claimById("market-3");
  const src = ["market-2", "market-3", ...DEALS.map((d) => d.id)];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Research · 04" title={<>A <em>$4.8B</em> market, growing 68.7% a year.</>} lead="Gartner's “securing AI” category — the software that lets organizations use AI safely — is the fastest-accelerating segment in its security forecast." />
      <div className="cols" style={{ gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "stretch" }}>
        <Reveal i={2} className="card" style={{ padding: "22px 28px 18px" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}><span className="label">Market for securing AI · worldwide</span><span className="row small" style={{ gap: 8 }}><Brand name="gartner" size={22} />Gartner · {g ? fmtDate(g.published) : ""}<sup className="sup">1</sup></span></div>
          <Bars height={280} items={[{ label: "2026", value: 2.835 }, { label: "2027", value: 4.8, note: "+68.7%" }, { label: "2028", value: 7.7 }]} fmt={(v) => `$${v.toFixed(v < 3 ? 3 : 1)}B`} />
        </Reveal>
        <div className="stack" style={{ gap: 16 }}>
          <Reveal i={3} className="label">The two slices Wrapbox sits in · 2027<sup className="sup">2</sup></Reveal>
          <Reveal i={4} className="card tint" style={{ padding: "20px 24px" }}><div style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: "var(--acc)" }}>$749M</div><div style={{ fontSize: 19, fontWeight: 600, marginTop: 8 }}>AI usage control · <span style={{ color: "var(--acc)" }}>+73%</span></div><div className="small">Deciding what people and agents may do with AI</div></Reveal>
          <Reveal i={5} className="card tint" style={{ padding: "20px 24px" }}><div style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: "var(--acc)" }}>$429M</div><div style={{ fontSize: 19, fontWeight: 600, marginTop: 8 }}>AI gateway · <span style={{ color: "var(--acc)" }}>+70.9%</span></div><div className="small">Brokering and inspecting AI traffic in flight{seg ? "" : ""}</div></Reveal>
        </div>
      </div>
      <Reveal i={6} className="label" style={{ margin: "26px 0 12px" }}>Who is buying — the category is consolidating</Reveal>
      <Reveal i={7} className="row" style={{ gap: 12, alignItems: "stretch" }}>
        {DEALS.map((d, k) => (
          <div key={d.id} className="badge" style={{ flex: 1, gap: 12 }}>
            <Brand name={d.a} size={34} /><span className="muted">→</span>{d.b && <Brand name={d.b} size={34} />}
            <span><b>{d.t}</b><span className="small" style={{ display: "block", fontSize: 14 }}>{d.n}<sup className="sup">{k + 3}</sup></span></span>
          </div>
        ))}
      </Reveal>
      <Sources ids={src} />
    </div>
  );
}

/* ---------- research: landscape map ---------- */
// Positions: x = how far the product governs the *action* (from the matrix cells: decides at the
// moment of action, CONSTRAIN, REVIEW); y = how many surfaces it covers. Hand-spaced to avoid overlap.
const POINTS: { key: string; name: string; brand: string; x: number; y: number; hero?: boolean }[] = [
  { key: "Wrapbox (this prototype)", name: "Wrapbox", brand: "wrapbox-mark", x: 90, y: 14, hero: true },
  { key: "Zenity", name: "Zenity", brand: "zenity", x: 70, y: 40 },
  { key: "Prompt Security (SentinelOne)", name: "Prompt Security", brand: "promptsecurity", x: 55, y: 34 },
  { key: "Netskope One AI Security", name: "Netskope", brand: "netskope", x: 40, y: 30 },
  { key: "Zscaler AI Broker / Endpoint AI Security", name: "Zscaler", brand: "zscaler", x: 30, y: 40 },
  { key: "Palo Alto Prisma AIRS 3.0", name: "Palo Alto", brand: "paloalto", x: 24, y: 52 },
  { key: "Noma Security", name: "Noma", brand: "noma", x: 50, y: 58 },
  { key: "Obsidian Security", name: "Obsidian", brand: "obsidian", x: 60, y: 70 },
  { key: "Oso for Agents", name: "Oso", brand: "oso", x: 42, y: 78 },
  { key: "Kong AI Gateway", name: "Kong", brand: "kong", x: 33, y: 64 },
  { key: "Cloudflare AI Gateway", name: "Cloudflare", brand: "cloudflare", x: 20, y: 74 },
  { key: "Portkey", name: "Portkey", brand: "portkey", x: 14, y: 74 },
  { key: "Lakera (Check Point)", name: "Lakera", brand: "lakera", x: 30, y: 76 },
  { key: "Okta Agent SSO", name: "Okta", brand: "okta", x: 10, y: 58 },
  { key: "Microsoft Entra Agent ID", name: "Entra Agent ID", brand: "microsoft", x: 12, y: 42 },
  { key: "Claude Code permissions", name: "Claude Code", brand: "claudecode", x: 70, y: 68 },
  { key: "OpenAI Codex approvals", name: "Codex", brand: "codex", x: 84, y: 74 },
];
export function Landscape() {
  const rows = research.competitorMatrix.rows;
  const bypass = claimById("regulation-14");
  const src = ["competitors-7", "competitors-1", "competitors-2", "competitors-6", "competitors-12", "competitors-15", "regulation-14"];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Research · 05" title={<>Nobody guards <em>the action.</em></>} lead="Seventeen products, placed from their own launch material and docs. Two questions: what does it govern — the prompt, the traffic, or the action — and on how many surfaces?" />
      <div className="cols" style={{ gridTemplateColumns: "1fr 380px", gap: 40, alignItems: "start" }}>
        <Reveal i={2} className="map" style={{ height: 500 }}>
          <span className="grid-h" /><span className="grid-v" />
          <span className="quad" style={{ left: 18, top: 14 }}>Broad surface · guards traffic</span>
          <span className="quad" style={{ right: 18, top: 14, textAlign: "right" }}>Broad surface · guards the action</span>
          <span className="quad" style={{ left: 18, bottom: 40 }}>One surface · guards the prompt</span>
          <span className="quad" style={{ right: 18, bottom: 40, textAlign: "right" }}>One surface · guards the action</span>
          <span className="axis" style={{ left: "50%", bottom: 12, transform: "translateX(-50%)" }}>governs the prompt / the traffic → governs the action</span>
          <span className="axis" style={{ left: 8, top: "50%", transform: "rotate(-90deg) translate(-50%, -100%)", transformOrigin: "left top" }}>one surface → laptop + network + gateway</span>
          {POINTS.map((p, k) => {
            const row = rows.find((r) => r.name === p.key);
            return (
              <Reveal key={p.key} i={3 + Math.min(k, 8) * 0.4} className={`pt ${p.hero ? "hero" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                <Brand name={p.brand} size={p.hero ? 50 : 38} title={row?.note ?? p.name} />
                <span className="nm">{p.name}</span>
              </Reveal>
            );
          })}
        </Reveal>
        <div className="stack" style={{ gap: 12 }}>
          <Reveal i={3} className="card tint" style={{ padding: "16px 20px" }}><div style={{ fontSize: 18, fontWeight: 700 }}>SSE & DLP platforms</div><div className="body" style={{ fontSize: 15.5 }}>Broker traffic, inspect bytes: allow/deny on the wire. No plain-English intent, no scoped review.</div></Reveal>
          <Reveal i={4} className="card tint" style={{ padding: "16px 20px" }}><div style={{ fontSize: 18, fontWeight: 700 }}>Agent-security startups</div><div className="body" style={{ fontSize: 15.5 }}>Zenity comes closest — on agent platforms. None spans laptop, network and gateway with one policy and a hash-chained record.</div></Reveal>
          <Reveal i={5} className="card tint" style={{ padding: "16px 20px" }}><div style={{ fontSize: 18, fontWeight: 700 }}>Identity & platform-native</div><div className="body" style={{ fontSize: 15.5 }}>Okta and Entra answer who the agent is. Claude Code and Codex approvals are per-developer settings.</div></Reveal>
          {bypass && <Reveal i={6} className="honest" style={{ fontSize: 15 }}><b>Anthropic's own docs:</b> bypassPermissions “offers no protection against prompt injection or unintended actions.”<sup className="sup">7</sup></Reveal>}
        </div>
      </div>
      <Sources ids={src} />
    </div>
  );
}

/* ---------- synthesize ---------- */
const INSIGHTS = [
  { n: "01", h: "The prompt is not the control.", p: "All four incidents had the rule in a prompt. OWASP says authorization checks must not be delegated to the LLM.", ev: [{ id: "regulation-10", t: "OWASP LLM07:2025" }, { id: "incidents-12", t: "PocketOS · rule ignored" }] },
  { n: "02", h: "Governance is binary today. It has to be graded.", p: "Locked down or fully trusted is why 40% of agent programs will be demoted by 2027; real operating models already review only the risky actions.", ev: [{ id: "adoption-6", t: "Gartner · 40%" }, { id: "personas-10", t: "CSA · 53% review high-risk only" }] },
  { n: "03", h: "Approvals must be cheap and targeted.", p: "Developers already lose time to AI while believing they gain it, and 46% distrust its output — a gate that fires on every action would be abandoned.", ev: [{ id: "personas-5", t: "METR · 19% slower" }, { id: "personas-1", t: "Stack Overflow · 46% distrust" }] },
];
const PERSONAS = [
  { role: "Security leader", photo: "u-maya", job: "prove nothing leaves without a decision on record" },
  { role: "AI-platform engineer", photo: "u-daniel", job: "roll it out; never block a developer for no reason" },
  { role: "Developer", photo: "u-priya", job: "ship with agents; see exactly why something was held" },
  { role: "Approver", photo: "u-alex", job: "decide a parked step in seconds, never their own" },
  { role: "Governance", photo: "ananya.r", job: "turn policy into contracts; export a tamper-evident trail" },
];
export function Synthesize() {
  const src = INSIGHTS.flatMap((i) => i.ev.map((e) => e.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Synthesize · 06" title={<>Three things the research <em>kept saying.</em></>} lead="From 111 verified claims and four incident post-mortems to three insights — and five people who each need something different from the same decision." />
      <div className="cols cols-3" style={{ gap: 20 }}>
        {INSIGHTS.map((x, k) => (
          <Reveal key={x.n} i={k + 2} className={`card ${k === 0 ? "acc" : "tint"}`} style={{ padding: "24px 26px", minHeight: 300, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, opacity: 0.8 }}>{x.n}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{x.h}</div>
            <div className="body" style={{ fontSize: 16.5, color: k === 0 ? "inherit" : undefined, opacity: k === 0 ? 0.92 : 1 }}>{x.p}</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: "auto" }}>{x.ev.map((e) => <span key={e.id} className="chip neutral" style={{ fontSize: 12.5, color: k === 0 ? "var(--acc-ink)" : undefined, borderColor: k === 0 ? "color-mix(in oklab, var(--acc-ink) 45%, transparent)" : undefined }}>{e.t}<sup className="sup" style={{ color: k === 0 ? "var(--acc-ink)" : undefined }}>{src.indexOf(e.id) + 1}</sup></span>)}</div>
          </Reveal>
        ))}
      </div>
      <Reveal i={5} className="label" style={{ margin: "26px 0 12px" }}>Who has to trust the same decision</Reveal>
      <Reveal i={6} className="cols" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 14 }}>
        {PERSONAS.map((p) => <div key={p.role} className="persona tile" style={{ padding: "12px 14px" }}><img src={photoOf(p.photo) ?? photoOf("u-priya")} alt="" /><div><div className="role">{p.role}</div><div className="job">{p.job}</div></div></div>)}
      </Reveal>
      <Sources ids={src} />
    </div>
  );
}

/* ---------- ideate: insight → principle → feature ---------- */
const MAP = [
  { i: "The prompt is not the control", p: "Decide outside the model, at the moment of action", f: "Five enforcement planes + one decision engine" },
  { i: "Binary governance fails", p: "Four graded decisions, not a switch", f: "ALLOW · CONSTRAIN · REVIEW · BLOCK, with in-flight transforms" },
  { i: "Approvals must be cheap and targeted", p: "Humans only where judgement adds value", f: "Review Center: blast radius, safer path, expiry — requester ≠ approver" },
  { i: "Security leaders think in sentences", p: "Intent in plain English, one normalized rule", f: "Intent Studio + one matcher for simulator, tasks and runtime (MCP tools too)" },
  { i: "Trust needs proof, not claims", p: "Evidence for every decision; claim only real coverage", f: "One complete record per decision, OCSF/OTLP export · Coverage Map · Safety Kernel" },
  { i: "Agents delegate, read untrusted input, outlive trust", p: "Authority never grows; one control stops it all", f: "Kill switch · delegation chains · supplier contracts · injection-aware · output check" },
];
export function Ideate() {
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const draw = () => {
      // Geometry relative to the (uniformly scaled) mapping container.
      const R = el.getBoundingClientRect(); const s = R.width / el.offsetWidth || 1;
      const rect = (n: HTMLElement) => { const r = n.getBoundingClientRect(); return { x: (r.left - R.left) / s, y: (r.top - R.top) / s, w: r.width / s, h: r.height / s }; };
      const cols = [0, 1, 2].map((c) => [...el.querySelectorAll<HTMLElement>(`[data-col="${c}"]`)]);
      const out: string[] = [];
      for (let r = 0; r < MAP.length; r++) for (let c = 0; c < 2; c++) {
        const a = cols[c][r], b = cols[c + 1][r]; if (!a || !b) continue;
        const A = rect(a), B = rect(b);
        const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2;
        out.push(`M${x1},${y1} C${x1 + 28},${y1} ${x2 - 28},${y2} ${x2},${y2}`);
      }
      setPaths(out);
    };
    draw(); const t = setTimeout(draw, 400); window.addEventListener("resize", draw);
    return () => { clearTimeout(t); window.removeEventListener("resize", draw); };
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Head eyebrow="Ideate · 07" title={<>From insight <em>to design.</em></>} lead="Every feature traces back to a principle, and every principle to something the research showed. Nothing in the product is there because it looked good in a demo." />
      <div className="mapping" ref={root} style={{ flex: 1 }}>
        <svg aria-hidden="true">{paths.map((d, k) => <path key={k} d={d} />)}</svg>
        {["Insight", "Principle", "In the product"].map((h, c) => (
          <div key={h}>
            <div className="colh">{h}</div>
            {MAP.map((m, r) => <Reveal key={r} i={2 + r * 0.6 + c * 0.2} className={`item ${c === 1 ? "acc" : c === 2 ? "tint" : ""}`} style={{ position: "relative" }}><span data-col={c} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />{c === 0 ? m.i : c === 1 ? m.p : <b>{m.f}</b>}</Reveal>)}
          </div>
        ))}
      </div>
      <Reveal i={6} className="row" style={{ gap: 10, marginTop: 14 }}>
        <Chip tone="neutral">Engineering standard</Chip>
        <span style={{ fontSize: 17, fontWeight: 500 }}>“Prototype the infrastructure. Never prototype the correctness.” — written before the first screen.</span>
      </Reveal>
    </div>
  );
}
