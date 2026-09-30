// Tiny external store for the walkthrough overlay (spotlight, caption, cursor).
import { useSyncExternalStore } from "react";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Caption { title: string; body: string; index: number; total: number; placement: "auto" | "top" | "bottom" | "left" | "right"; centered: boolean }
export interface OverlayState {
  status: "loading" | "playing" | "paused" | "done" | "error";
  hidden: boolean;
  index: number;
  rect: Rect | null;
  pad: number;
  caption: Caption | null;
  cursor: { x: number; y: number; visible: boolean };
  down: boolean;
  ripple: number;
  typing: boolean;
  error?: string;
}

let s: OverlayState = {
  status: "loading", hidden: false, index: 0, rect: null, pad: 8, caption: null,
  cursor: { x: 640, y: 420, visible: false }, down: false, ripple: 0, typing: false,
};
const subs = new Set<() => void>();

export const overlay = {
  get: () => s,
  set(patch: Partial<OverlayState>) { s = { ...s, ...patch }; subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export function useOverlay(): OverlayState {
  return useSyncExternalStore(overlay.subscribe, overlay.get);
}
