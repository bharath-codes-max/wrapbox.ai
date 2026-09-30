// Every walkthrough in this folder, one file per case, ordered for the deck.
// Case files are pure data (no app imports), so the deck can list them without
// loading the product.
import type { TourCase } from "../types";

const mods = import.meta.glob<{ default: TourCase }>("./*.ts", { eager: true });

const ALL: TourCase[] = Object.entries(mods)
  .filter(([p]) => !p.endsWith("/index.ts"))
  .map(([, m]) => m.default)
  .filter((c): c is TourCase => !!c && typeof c.id === "string" && Array.isArray(c.steps) && c.steps.length > 0)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

/** The deck's use-case slides. Order 900+ (the grand tour) is its own page
 *  (docs/demo.html) and stays out of the v2/v3 lists. */
export const CASES: TourCase[] = ALL.filter((c) => c.order < 900);

export function caseById(id: string): TourCase | undefined {
  return ALL.find((c) => c.id === id);
}
