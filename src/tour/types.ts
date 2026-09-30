// Live walkthroughs ("tours") of the real Wrapbox app. A case is pure data:
// where to go, what to point at, what to do there, and what to tell the viewer.
// The runner (runner.ts) plays it against the actual product UI — the same
// components, store and engine — so every result on screen is the product's own.

/** An element on screen. A CSS selector string, or a description the runner
 *  resolves: elements matching `selector` (default: any clickable/text element)
 *  whose visible text contains `text`, optionally inside `within`; `nth` picks
 *  one when several match (0-based, in document order). */
export type Target =
  | string
  | { selector?: string; text?: string; exact?: boolean; within?: string; nth?: number };

export type TourAction = "none" | "click" | "type" | "select" | "hover" | "key";

export interface TourStep {
  /** Hash route to be on before this step (e.g. "reviews"). Navigates only if different. */
  route?: string;
  /** What to spotlight — and act on, when `action` is set. No target = a centered caption. */
  target?: Target;
  action?: TourAction;
  /** type: the text to type (replaces what is there). key: a combo like "Meta+k" or "Enter". */
  text?: string;
  /** select: the option value to choose. */
  value?: string;
  /** Plain words for everyone: a short headline and one or two sentences. */
  title: string;
  body: string;
  /** What the narrator says on this step (spoken, friendly, plain English). Falls back to title + body. */
  say?: string;
  /** After the action, wait until this appears (e.g. the result card). */
  waitFor?: Target;
  /** Extra time (ms) to stay on the result after the action. */
  hold?: number;
  /** Where the caption sits relative to the spotlight. */
  placement?: "auto" | "top" | "bottom" | "left" | "right";
  /** Spotlight padding in px. */
  pad?: number;
}

export interface TourCase {
  id: string;
  /** Position in the deck. */
  order: number;
  /** Who this is — a real persona from the prototype's org (model/org.ts). */
  persona: { userId: string; name: string; role: string };
  /** Short slide title, plain words. */
  title: string;
  /** Why they open Wrapbox today — one sentence. */
  goal: string;
  /** What they walk away with — one sentence. */
  outcome: string;
  /** Workspace to start in: the seeded 3-months-in company (default) or day one. */
  workspace?: "demo" | "fresh";
  /** Route the app opens on. */
  start: string;
  /** Real store actions that happened before the story begins (see runner SETUP). */
  setup?: string[];
  /** Step index used as the still frame in captures. */
  poster?: number;
  steps: TourStep[];
}
