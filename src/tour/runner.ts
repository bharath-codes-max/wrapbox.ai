// Plays a TourCase against the real Wrapbox app mounted in this document.
// Every click and keystroke goes through the product's own event handlers, so
// what the viewer sees (decisions, reviews, coverage, evidence) is computed by
// the product itself — the runner only points, types, clicks and explains.
//
// Modes
//   play   — slow, captioned, with a moving cursor (the deck / a visitor)
//   check  — no pacing, no overlay; reports per-step results as JSON (CI / authoring)
//   shot   — fast-forwards to one step and freezes on its spotlight (captures)
import type { Target, TourCase, TourStep } from "./types";
import { overlay, type Rect } from "./overlay-store";
import { advanceTask, installKernelUpdate, simulateById, startFreshWorkspace, startTask } from "../state/store";
import VOICE from "./voice.json";

// Narration clips (generated at build time by docs/_voice.ts). Dev serves them from
// /docs/voice; the published tour.html sits next to its voice/ folder.
const VOICE_BASE = import.meta.env.DEV ? "/docs/voice/" : "voice/";
const CLIPS = (VOICE as { cases: Record<string, { file: string; ms: number }[]> }).cases;

export type Mode = "play" | "check" | "shot";
export interface RunOptions {
  mode: Mode;
  speed: number;        // 1 = presentation pace; 0.5 = twice as fast
  from: number;         // play: fast-forward to this step first
  shot: number;         // shot: the step to freeze on
  shotAfter: boolean;   // shot: perform the step's action before freezing
  voice: boolean;       // play: narrate each step (AI voice)
}
export interface StepResult { i: number; title: string; found: boolean; waitFor?: boolean; error?: string }

/** Real store actions a case may declare as "already happened" before it starts. */
export const SETUP: Record<string, (arg?: string) => void> = {
  fresh: () => startFreshWorkspace(),
  simulate: (id) => { if (!id || !simulateById(id)) throw new Error(`setup simulate: unknown scenario ${id}`); },
  task: (job) => { const t = startTask(job || undefined); advanceTask(t.taskId); },
  "kernel-install": () => { installKernelUpdate(); },
};
export function runSetup(list: string[] = []) {
  for (const item of list) {
    const [name, arg] = item.split(":");
    const fn = SETUP[name];
    if (!fn) throw new Error(`Unknown setup action "${item}"`);
    fn(arg);
  }
}

/* ------------------------------------------------------------------ helpers */

const OVERLAY_ID = "tour";
const DEFAULT_SEL = "button, a, [role=button], [role=tab], [role=option], input, textarea, select, label, h1, h2, h3, h4, h5, th, td, li, p, span, div, code, pre, svg text";

function visible(el: Element): boolean {
  if (el.closest(`#${OVERLAY_ID}`)) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
function textOf(el: Element): string {
  const h = el as HTMLInputElement;
  const bits = [el.textContent ?? "", h.placeholder ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""];
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) bits.push(el.value);
  return norm(bits.join(" "));
}

export function resolve(t: Target): HTMLElement | null {
  if (typeof t === "string") {
    return ([...document.querySelectorAll<HTMLElement>(t)].find(visible)) ?? null;
  }
  const scope: ParentNode | null = t.within ? ([...document.querySelectorAll(t.within)].find(visible) ?? null) : document;
  if (!scope) return null;
  let els = [...scope.querySelectorAll<HTMLElement>(t.selector ?? DEFAULT_SEL)].filter(visible);
  if (t.text) {
    const want = norm(t.text);
    els = els.filter((el) => (t.exact ? norm(el.textContent ?? "") === want || textOf(el) === want : textOf(el).includes(want)));
    // Without an explicit selector, prefer the innermost match (not every wrapper that contains the text).
    if (!t.selector) els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  }
  return els[t.nth ?? 0] ?? null;
}

const describe = (t: Target) => (typeof t === "string" ? t : JSON.stringify(t));

/** The nearest ancestor that actually scrolls (the page body, a drawer, a list). */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Scroll only when the element isn't already comfortably inside its scroll area
 *  (below the sticky top bars, inside the window) — panels shouldn't jump. */
function ensureVisible(el: HTMLElement, smooth: boolean) {
  const r = el.getBoundingClientRect();
  const box = scroller(el)?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const top = Math.max(box.top, 0) + 12, bottom = Math.min(box.bottom, window.innerHeight) - 12;
  const inView = r.top >= top && r.bottom <= bottom && r.left >= 0 && r.right <= window.innerWidth;
  if (inView) return false;
  el.scrollIntoView({ block: r.height > bottom - top ? "start" : "center", inline: "nearest", behavior: (smooth ? "smooth" : "instant") as ScrollBehavior });
  return true;
}

/* ------------------------------------------------------------------ runner */

export class Runner {
  private paused = false;
  private stopped = false;
  private tracked: HTMLElement | null = null;
  private raf = 0;
  private audio: HTMLAudioElement | null = null;
  results: StepResult[] = [];

  constructor(private tc: TourCase, private opt: RunOptions) {}

  pause() { this.paused = true; this.audio?.pause(); overlay.set({ status: "paused" }); this.post(); }
  play() { this.paused = false; if (this.audio && !this.audio.ended && this.opt.voice) void this.audio.play().catch(() => {}); overlay.set({ status: "playing" }); this.post(); }
  /** Sound on/off from the deck. Turning it on mid-line resumes that line. */
  setVoice(on: boolean) {
    this.opt.voice = on;
    if (!this.audio) return;
    this.audio.muted = !on;
    if (on && !this.paused && !this.audio.ended) this.audio.play().then(() => this.post({ voiceBlocked: false })).catch(() => this.post({ voiceBlocked: true }));
  }
  /** Starts step i's narration; returns its length in ms (0 when there is none). */
  private narrate(i: number): number {
    const clip = CLIPS[this.tc.id]?.[i];
    this.audio?.pause();
    if (!clip || !clip.ms) return 0;
    const a = new Audio(VOICE_BASE + clip.file);
    a.muted = !this.opt.voice;
    this.audio = a;
    // The exact moment this line starts, so a video recorder can lay the clip
    // onto its soundtrack in sync (docs/_record.mjs).
    this.post({ narrated: i, at: Date.now() });
    // Browsers only allow sound after the viewer has interacted with the page;
    // until then the walkthrough keeps its pace silently and the deck offers a sound button.
    a.play().then(() => this.post({ voiceBlocked: false })).catch(() => this.post({ voiceBlocked: true }));
    return clip.ms;
  }
  toggle() { if (this.paused) this.play(); else this.pause(); }
  stop() { this.stopped = true; cancelAnimationFrame(this.raf); }

  /** Posts progress to the deck when embedded. */
  post(extra: Record<string, unknown> = {}) {
    if (window.parent === window) return;
    const s = overlay.get();
    window.parent.postMessage({ type: "wrapbox-tour", id: this.tc.id, step: s.index, total: this.tc.steps.length, status: s.status, error: s.error, route: this.route(), ...extra }, "*");
  }

  /** Sleep that honours pause and speed. */
  private async wait(ms: number) {
    let left = ms * this.opt.speed;
    while (left > 0 && !this.stopped) {
      const slice = Math.min(80, left);
      await new Promise((r) => setTimeout(r, slice));
      if (!this.paused) left -= slice;
    }
  }
  private tick = () => new Promise<void>((r) => setTimeout(r, 30));
  private async settle() { await this.tick(); await this.tick(); await this.tick(); }

  private async find(t: Target, timeout: number): Promise<HTMLElement | null> {
    const t0 = performance.now();
    for (;;) {
      const el = resolve(t);
      if (el) return el;
      if (performance.now() - t0 > timeout || this.stopped) return null;
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  private route(): string { return location.hash.slice(1) || "control"; }
  private async go(route: string, instant: boolean) {
    if (this.route() === route) return;
    location.hash = route;
    await this.settle();
    if (!instant) await this.wait(700);
  }

  /** Spotlight follows the element every frame (layouts move after clicks). */
  private track(el: HTMLElement | null) {
    this.tracked = el;
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (this.tracked && this.tracked.isConnected) {
        const r = this.tracked.getBoundingClientRect();
        const prev = overlay.get().rect;
        const next: Rect = { x: r.left, y: r.top, w: r.width, h: r.height };
        if (!prev || Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y) + Math.abs(prev.w - next.w) + Math.abs(prev.h - next.h) > 0.5) overlay.set({ rect: next });
      }
      this.raf = requestAnimationFrame(loop);
    };
    if (el) loop();
  }

  private point(el: HTMLElement, typing = false) {
    const r = el.getBoundingClientRect();
    const x = typing ? r.left + Math.min(28, r.width / 2) : r.left + r.width / 2;
    const y = typing ? r.top + Math.min(22, r.height / 2) : r.top + r.height / 2;
    return { x, y };
  }

  private railHover(el: HTMLElement | null, on: boolean) {
    const rail = el?.closest(".rail") as HTMLElement | null;
    document.querySelectorAll("[data-tour-hover]").forEach((n) => n.removeAttribute("data-tour-hover"));
    if (rail && on) rail.setAttribute("data-tour-hover", "");
  }

  /* ------------------------------------------------------------ actions */

  private dispatchMouse(el: HTMLElement, type: string) {
    const { x, y } = this.point(el);
    const Ctor = type.startsWith("pointer") ? (window.PointerEvent ?? MouseEvent) : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }));
  }
  private click(el: HTMLElement) {
    // A real click moves focus off whatever field was being typed in.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== el && active !== document.body && typeof active.blur === "function") active.blur();
    for (const t of ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup"]) this.dispatchMouse(el, t);
    if (typeof el.focus === "function" && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) el.focus({ preventScroll: true });
    el.click();
  }
  private setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    if (el instanceof HTMLSelectElement) el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  private field(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
    return el.querySelector("textarea, input");
  }
  private async type(el: HTMLElement, text: string, instant: boolean) {
    const f = this.field(el);
    if (!f) throw new Error("type: target is not a text field");
    f.focus({ preventScroll: true });
    if (instant) { this.setValue(f, text); return; }
    this.setValue(f, "");
    overlay.set({ typing: true });
    for (let i = 1; i <= text.length; i++) {
      if (this.stopped) return;
      this.setValue(f, text.slice(0, i));
      const ch = text[i - 1];
      await this.wait(ch === " " ? 70 : /[.,;:]/.test(ch) ? 160 : 48);
    }
    overlay.set({ typing: false });
  }
  private key(el: HTMLElement | null, combo: string) {
    const parts = combo.split("+");
    const key = parts.pop()!;
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    const init: KeyboardEventInit = { key, bubbles: true, cancelable: true, metaKey: mods.has("meta") || mods.has("cmd"), ctrlKey: mods.has("ctrl"), shiftKey: mods.has("shift"), altKey: mods.has("alt") };
    const tgt: EventTarget = el ?? document.activeElement ?? document.body;
    tgt.dispatchEvent(new KeyboardEvent("keydown", init));
    tgt.dispatchEvent(new KeyboardEvent("keyup", init));
  }
  private select(el: HTMLElement, value: string) {
    const s = el instanceof HTMLSelectElement ? el : el.querySelector("select");
    if (!s) throw new Error("select: target has no <select>");
    if (![...s.options].some((o) => o.value === value)) throw new Error(`select: no option "${value}"`);
    this.setValue(s, value);
  }

  private async act(step: TourStep, el: HTMLElement | null, instant: boolean) {
    const a = step.action ?? "none";
    if (a === "none") return;
    if (a === "key") { this.key(el, step.text ?? "Enter"); return; }
    if (!el) throw new Error(`${a}: target not found`);
    if (a === "click") {
      if (!instant) { overlay.set({ down: true }); await this.wait(160); overlay.set({ down: false, ripple: Date.now() }); }
      this.click(el);
    } else if (a === "type") await this.type(el, step.text ?? "", instant);
    else if (a === "select") this.select(el, step.value ?? "");
    else if (a === "hover") this.dispatchMouse(el, "mouseover");
  }

  /* ------------------------------------------------------------ steps */

  /** Runs one step without pacing or overlay (check mode, fast-forward). */
  private async quick(i: number): Promise<StepResult> {
    const step = this.tc.steps[i];
    const res: StepResult = { i, title: step.title, found: true };
    try {
      if (step.route) await this.go(step.route, true);
      let el: HTMLElement | null = null;
      if (step.target) {
        el = await this.find(step.target, 4000);
        res.found = !!el;
        if (!el) throw new Error(`target not found: ${describe(step.target)}`);
        ensureVisible(el, false);
      }
      await this.act(step, el, true);
      await this.settle();
      if (step.waitFor) {
        const w = await this.find(step.waitFor, 12000);
        res.waitFor = !!w;
        if (!w) throw new Error(`waitFor not found: ${describe(step.waitFor)}`);
        ensureVisible(w, false);
      }
    } catch (e) {
      res.error = (e as Error).message;
    }
    return res;
  }

  /** Runs one step at presentation pace with the cursor and captions. */
  private async slow(i: number) {
    const step = this.tc.steps[i];
    const total = this.tc.steps.length;
    overlay.set({ index: i, error: undefined });
    this.post();
    if (step.route && this.route() !== step.route) {
      overlay.set({ caption: null, rect: null });
      this.track(null);
      await this.go(step.route, false);
    }
    let el: HTMLElement | null = null;
    if (step.target) {
      el = await this.find(step.target, 6000);
      if (!el) { overlay.set({ error: `Couldn't find: ${describe(step.target)}` }); this.post(); }
    }
    if (el) {
      if (ensureVisible(el, true)) await this.wait(600);
      this.railHover(el, true);
      const p = this.point(el, step.action === "type");
      overlay.set({ cursor: { x: p.x, y: p.y, visible: true } });
      await this.wait(760);
    }
    this.track(el);
    overlay.set({ rect: el ? overlay.get().rect : null, pad: step.pad ?? 8, caption: { title: step.title, body: step.body, index: i, total, placement: step.placement ?? "auto", centered: !el } });
    const spoken = this.narrate(i);
    const read = Math.max(spoken + 600, Math.min(9500, Math.max(3400, 1100 + words(step.title + " " + step.body) * 240)));
    const acting = (step.action ?? "none") !== "none";
    await this.wait(acting ? read * 0.5 : read);
    if (acting) {
      try { await this.act(step, el, false); } catch (e) { overlay.set({ error: (e as Error).message }); this.post(); }
      await this.settle();
      if (step.waitFor) {
        const w = await this.find(step.waitFor, 12000);
        if (w) {
          if (ensureVisible(w, true)) await this.wait(500);
          this.railHover(null, false);
          this.track(w);
          const p = this.point(w);
          overlay.set({ cursor: { x: p.x, y: p.y, visible: true } });
        } else { overlay.set({ error: `Didn't appear: ${describe(step.waitFor)}` }); this.post(); }
      }
      await this.wait(read * 0.5 + (step.hold ?? 1400));
    } else if (step.hold) await this.wait(step.hold);
    this.railHover(null, false);
  }

  async run() {
    const { mode } = this.opt;
    const steps = this.tc.steps;
    if (mode === "check") {
      overlay.set({ status: "playing", hidden: true });
      for (let i = 0; i < steps.length; i++) this.results.push(await this.quick(i));
      overlay.set({ status: this.results.some((r) => r.error) ? "error" : "done" });
      return this.results;
    }
    if (mode === "shot") {
      overlay.set({ status: "playing" });
      const n = Math.min(Math.max(0, this.opt.shot), steps.length - 1);
      for (let i = 0; i < n; i++) this.results.push(await this.quick(i));
      const step = steps[n];
      if (step.route) await this.go(step.route, true);
      const el = step.target ? await this.find(step.target, 4000) : null;
      if (el) {
        ensureVisible(el, false);
        this.railHover(el, true);
      }
      let spot = el;
      if (this.opt.shotAfter) {
        try { await this.act(step, el, true); } catch (e) { overlay.set({ error: (e as Error).message }); }
        await this.settle();
        if (step.waitFor) { const w = await this.find(step.waitFor, 12000); if (w) { ensureVisible(w, false); spot = w; } }
        this.railHover(null, false); // the action is done — the rail folds away, as in play
      }
      await this.settle();
      const p = spot ? this.point(spot, step.action === "type" && !this.opt.shotAfter) : null;
      this.track(spot);
      overlay.set({ index: n, pad: step.pad ?? 8, cursor: p ? { ...p, visible: true } : overlay.get().cursor, caption: { title: step.title, body: step.body, index: n, total: steps.length, placement: step.placement ?? "auto", centered: !spot }, error: step.target && !el ? `Couldn't find: ${describe(step.target)}` : overlay.get().error });
      await this.settle();
      overlay.set({ status: "done" });
      this.post(); // the deck labels the frame with the page actually on screen
      return this.results;
    }
    // play
    overlay.set({ status: "playing" });
    const from = Math.min(Math.max(0, this.opt.from), steps.length - 1);
    for (let i = 0; i < from; i++) await this.quick(i);
    this.post();
    await this.wait(900);
    for (let i = from; i < steps.length && !this.stopped; i++) await this.slow(i);
    if (this.audio && !this.audio.ended) await new Promise<void>((r) => { this.audio!.addEventListener("ended", () => r(), { once: true }); setTimeout(r, 15000); });
    overlay.set({ status: "done" });
    this.post();
    return this.results;
  }
}

function words(s: string) { return s.split(/\s+/).filter(Boolean).length; }
