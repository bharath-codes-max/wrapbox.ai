import { createRoot } from "react-dom/client";
import "./deck.css";
import { RecordTour } from "./record-tour";
import grandTour from "../tour/cases/grand-tour";

// The 1920×1080 frame docs/_record.mjs captures into the YouTube MP4.
createRoot(document.getElementById("deck")!).render(<RecordTour tc={grandTour} />);
