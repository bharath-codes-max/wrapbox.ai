import { createRoot } from "react-dom/client";
import { Deck } from "./deck";
import type { SlideDef, SlideProps } from "./deck";
import { VideoTour } from "./video-tour";
import grandTour from "../tour/cases/grand-tour";

// The complete product demo — ONE slide on the same 1600×900 stage as decks
// v2/v3, playing the grand tour live in the real prototype with one AI voice.
// Built as a single HTML file (docs/demo.html) so it drops into any deck.
const SLIDES: SlideDef[] = [
  { id: "demo", phase: "usecases", title: grandTour.title, Component: (p: SlideProps) => <VideoTour tc={grandTour} {...p} /> },
];

createRoot(document.getElementById("deck")!).render(<Deck slides={SLIDES} showNumber={false} chrome={false} />);
