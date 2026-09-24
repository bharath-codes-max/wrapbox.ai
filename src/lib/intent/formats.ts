/**
 * Carrier formats a network clause may have to read — shared by the
 * capability check ("can the runtime parse what this clause protects?") and
 * the coverage notes. Uploads may be anything; a content PROTECTION therefore
 * requires the common office formats so a renamed spreadsheet cannot slip
 * past, while a plain permission requires only what it names.
 */

import type { IntentClause } from "./schema";

export function formatsFor(clause: IntentClause): string[] {
  const globs = clause.resource.path?.include ?? [];
  const exts = globs.map((g) => (g.split(".").pop() ?? "").toLowerCase().replace(/\*+$/, "")).filter(Boolean);
  const wanted = new Set<string>(["text", "json", "multipart"]);
  for (const e of exts) {
    if (["doc", "docx"].includes(e)) wanted.add("docx");
    else if (["xls", "xlsx"].includes(e)) wanted.add("xlsx");
    else if (["ppt", "pptx"].includes(e)) wanted.add("pptx");
    else if (e === "pdf") wanted.add("pdf");
    else if (e === "csv") wanted.add("csv");
    else if (e === "tsv") wanted.add("tsv");
    else if (["html", "htm"].includes(e)) wanted.add("html");
    else if (["yaml", "yml"].includes(e)) wanted.add("yaml");
    else if (e === "xml") wanted.add("xml");
    else if (["zip", "tar", "gz", "7z", "rar"].includes(e)) wanted.add("zip");
    else if (["png", "jpg", "jpeg", "gif", "tiff", "bmp", "heic"].includes(e)) wanted.add("image");
    else if (["eml", "msg"].includes(e)) wanted.add("eml");
  }
  if (clause.data?.classes?.length && clause.decision !== "ALLOW") { wanted.add("csv"); wanted.add("docx"); wanted.add("xlsx"); }
  return [...wanted];
}
