// Deck v2: the same story as v1, with the use cases played live inside the real
// product (src/tour) instead of described beside code.
import type { SlideDef, SlideProps } from "../deck";
import type { Phase } from ".";
import { CORE_AFTER, CORE_BEFORE } from ".";
import { CASES } from "../../tour/cases";
import { LiveCaseSlide, LiveIntro } from "../tour-slides";

const LIVE: SlideDef[] = CASES.length
  ? [
      { id: "live-intro", phase: "usecases", title: "Use cases, live", Component: LiveIntro },
      ...CASES.map((tc, k) => ({ id: `live-${tc.id}`, phase: "usecases" as Phase, title: tc.title, Component: (p: SlideProps) => <LiveCaseSlide tc={tc} n={k + 1} {...p} /> })),
    ]
  : [];

export const SLIDES_V2: SlideDef[] = [...CORE_BEFORE, ...LIVE, ...CORE_AFTER];
