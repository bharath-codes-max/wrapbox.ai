import type { SlideDef, SlideProps } from "../deck";
import { Cover, Understand, Numbers, Gap } from "./s01-05";
import { Market, Landscape, Synthesize, Ideate } from "./s06-10";
import { Architecture, IntentLive, DecisionLive, Tested, Close } from "./s11-15";
import { USECASES, UseCasesIntro, UseCaseSlide } from "../usecase";

export type Phase = "portfolio" | "understand" | "research" | "synthesize" | "ideate" | "prototype" | "usecases" | "test";
export const PHASES: { key: Phase; label: string }[] = [
  { key: "understand", label: "Understand" },
  { key: "research", label: "Research" },
  { key: "synthesize", label: "Synthesize" },
  { key: "ideate", label: "Ideate" },
  { key: "prototype", label: "Prototype" },
  { key: "usecases", label: "Use cases" },
  { key: "test", label: "Test" },
];

// One slide per verified use case (data/usecases.json), after the prototype slides.
const USECASE_SLIDES: SlideDef[] = USECASES.length
  ? [
      { id: "usecases-intro", phase: "usecases", title: "Use cases", Component: UseCasesIntro },
      ...USECASES.map((uc, k) => ({ id: uc.id, phase: "usecases" as Phase, title: uc.title, Component: (p: SlideProps) => <UseCaseSlide uc={uc} n={k + 1} {...p} /> })),
    ]
  : [];

// The design-process spine. Product-slide numbers are computed from the codebase;
// every external figure cites a source-verified claim (data/research.json).
// v1 and v2 share everything except the use-case section.
export const CORE_BEFORE: SlideDef[] = [
  { id: "cover", phase: "understand", title: "Wrapbox", Component: Cover },
  { id: "understand", phase: "understand", title: "Agents act", Component: Understand },
  { id: "numbers", phase: "research", title: "By the numbers", Component: Numbers },
  { id: "gap", phase: "research", title: "The gap", Component: Gap },
  { id: "market", phase: "research", title: "Market value", Component: Market },
  { id: "landscape", phase: "research", title: "Landscape", Component: Landscape },
  { id: "synthesize", phase: "synthesize", title: "Insights", Component: Synthesize },
  { id: "ideate", phase: "ideate", title: "Insight → design", Component: Ideate },
  { id: "architecture", phase: "prototype", title: "Architecture", Component: Architecture },
  { id: "intent", phase: "prototype", title: "Intent Studio, live", Component: IntentLive },
  { id: "decision", phase: "prototype", title: "The decision, live", Component: DecisionLive },
];
export const CORE_AFTER: SlideDef[] = [
  { id: "tested", phase: "test", title: "Tested, not claimed", Component: Tested },
  { id: "close", phase: "test", title: "To production", Component: Close },
];
export const SLIDES: SlideDef[] = [...CORE_BEFORE, ...USECASE_SLIDES, ...CORE_AFTER];
