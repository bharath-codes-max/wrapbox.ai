// Interface sound effects, synthesised with Web Audio (no audio assets). Shaped
// after warp.dev's own UI sounds, measured from their files: a hover tick
// (~8 ms attack, fast decay, low body), a click (~6 ms bright noise tick) and a
// confirmation chime (~2.5 kHz, ~370 ms decay). Tuned to stay audible on laptop
// speakers, which barely reproduce anything under ~300 Hz: every sound carries a
// 1–5 kHz transient, and a limiter keeps stacked hovers from clipping.
//
// On by default like Warp's; the mute choice persists. Browsers only start audio
// after a click or key press (hover doesn't count), so the context is created on
// the first pointerdown/keydown and `isUnlocked()` lets the UI say so plainly.

const KEY = "wrapbox-sfx-muted";
let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let lastHover = 0;
let muted = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function unlock() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume().then(notify);
    return;
  }
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.002; limiter.release.value = 0.08;
    limiter.connect(ctx.destination);
    out = limiter;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (ctx.state === "suspended") void ctx.resume().then(notify);
    notify();
  } catch { ctx = null; }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

function ready(): AudioContext | null {
  if (muted || !ctx || !out || ctx.state !== "running") return null;
  return ctx;
}

function env(c: AudioContext, peak: number, attack: number, decay: number) {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out!);
  return g;
}

function tone(c: AudioContext, type: OscillatorType, from: number, to: number, peak: number, attack: number, decay: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, c.currentTime);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, c.currentTime + attack + decay);
  o.connect(env(c, peak, attack, decay));
  o.start(); o.stop(c.currentTime + attack + decay + 0.02);
}

function noiseBurst(c: AudioContext, type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) {
  if (!noise) return;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  src.connect(f); f.connect(env(c, peak, attack, decay));
  src.start(); src.stop(c.currentTime + attack + decay + 0.02);
}

export const sfx = {
  /** Short woody tick — a band-passed noise transient over a falling triangle body.
   *  Throttled so sweeping across a grid reads as a texture, not a drumroll. */
  hover() {
    const c = ready(); if (!c) return;
    const now = performance.now();
    if (now - lastHover < 38) return;
    lastHover = now;
    noiseBurst(c, "bandpass", 2000, 1.1, 0.34, 0.002, 0.03);
    tone(c, "triangle", 620, 260, 0.2, 0.003, 0.055);
  },
  /** Crisp bright tick with a hint of pitch, like a mechanical key. */
  click() {
    const c = ready(); if (!c) return;
    noiseBurst(c, "highpass", 4200, 0.8, 0.42, 0.001, 0.016);
    tone(c, "sine", 1850, 1400, 0.1, 0.001, 0.03);
  },
  /** Two-partial confirmation chime. */
  chime() {
    const c = ready(); if (!c) return;
    tone(c, "sine", 2490, 2490, 0.09, 0.02, 0.4);
    tone(c, "sine", 3735, 3735, 0.035, 0.02, 0.3);
  },
  isMuted: () => muted,
  /** True once the browser has let audio start (after the first click or key press). */
  isUnlocked: () => !!ctx && ctx.state === "running",
  setMuted(v: boolean) {
    muted = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
    notify();
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
