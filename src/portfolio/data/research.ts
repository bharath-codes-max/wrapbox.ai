// Verified research corpus for the deck. research.json is produced by the
// research workflow (every claim re-fetched from its source before inclusion);
// slides cite claims by id and the Sources footer resolves them.
import raw from "./research.json";

export interface Claim {
  id: string;
  topic?: string;
  statement: string;
  figure: string;
  source_title: string;
  source_org: string;
  source_url: string;
  published: string;
  quote?: string;
  relevance: string;
  confidence: "high" | "medium";
}
export interface Research {
  generatedAt: string;
  topics: Record<string, { summary: string; claims: Claim[] }>;
  competitorMatrix: { axes: string[]; rows: { name: string; category: string; cells: ("yes" | "partial" | "no" | "n/a")[]; note: string }[] };
  dropped: { id: string; statement: string; reason: string }[];
}

export const research = raw as unknown as Research;
