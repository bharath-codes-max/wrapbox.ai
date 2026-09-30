// The walkthrough layer drawn over the real app: a dimmed spotlight around the
// area in play, a caption card that explains it in plain words, and a cursor.
import { useLayoutEffect, useRef, useState } from "react";
import { useOverlay, type Rect } from "./overlay-store";

const GAP = 18, EDGE = 14, CARD_W = 420;

function place(r: Rect | null, pad: number, size: { w: number; h: number }, want: string, vw: number, vh: number) {
  if (!r) return { left: (vw - size.w) / 2, top: (vh - size.h) / 2 };
  const R = { l: r.x - pad, t: r.y - pad, r: r.x + r.w + pad, b: r.y + r.h + pad };
  const fits = {
    right: R.r + GAP + size.w <= vw - EDGE,
    left: R.l - GAP - size.w >= EDGE,
    bottom: R.b + GAP + size.h <= vh - EDGE,
    top: R.t - GAP - size.h >= EDGE,
  };
  const order = want !== "auto" && fits[want as keyof typeof fits] ? [want] : ["right", "left", "bottom", "top"];
  const side = order.find((o) => fits[o as keyof typeof fits]);
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), vh - size.h - EDGE);
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), vw - size.w - EDGE);
  const midY = clampY(R.t + (R.b - R.t) / 2 - size.h / 2);
  const midX = clampX(R.l + (R.r - R.l) / 2 - size.w / 2);
  switch (side) {
    case "right": return { left: R.r + GAP, top: midY };
    case "left": return { left: R.l - GAP - size.w, top: midY };
    case "bottom": return { left: midX, top: R.b + GAP };
    case "top": return { left: midX, top: R.t - GAP - size.h };
    // A spotlight that fills the screen: the caption sits over its lower-right corner.
    default: return { left: vw - size.w - EDGE - 6, top: vh - size.h - EDGE - 6 };
  }
}

export function TourOverlay() {
  const s = useOverlay();
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: CARD_W, h: 150 });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useLayoutEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (Math.abs(w - size.w) > 1 || Math.abs(h - size.h) > 1) setSize({ w, h });
  });
  if (s.hidden) return null;
  const c = s.caption;
  const r = s.rect && c && !c.centered ? s.rect : null;
  const pos = c ? place(r, s.pad, size, c.placement, vp.w, vp.h) : null;
  // In "nocap" mode (the video-tour shell draws its own caption underneath), we
  // still want the spotlight and cursor to animate — just no floating card.
  const nocap = new URLSearchParams(location.search).get("nocap") === "1";
  return (
    <div className="tour-layer" aria-live="polite">
      {c && (r
        ? <div className="tour-spot" style={{ left: r.x - s.pad, top: r.y - s.pad, width: r.w + s.pad * 2, height: r.h + s.pad * 2 }} />
        : <div className="tour-dim" />)}
      {c && pos && !nocap && (
        <div ref={card} key={c.index} className={`tour-card ${c.centered ? "centered" : ""}`} style={{ left: pos.left, top: pos.top, width: CARD_W }}>
          <div className="tour-card-step">Step {c.index + 1} of {c.total}</div>
          <div className="tour-card-title">{c.title}</div>
          <div className="tour-card-body">{c.body}</div>
        </div>
      )}
      {s.cursor.visible && (
        <div className={`tour-cursor ${s.down ? "down" : ""}`} style={{ transform: `translate(${s.cursor.x}px, ${s.cursor.y}px)` }}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3l14 8.2-6.1 1.5 3.6 6.6-2.6 1.4-3.6-6.7L5 18.3z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          {s.ripple > 0 && <span key={s.ripple} className="tour-ripple" />}
        </div>
      )}
      {s.error && <div className="tour-error">Walkthrough step failed: {s.error}</div>}
    </div>
  );
}
