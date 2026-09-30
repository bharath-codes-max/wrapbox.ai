// Strips the document wrapper Vite emits so the page drops cleanly into the Artifact skeleton.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("dist/index.html", "utf8");
const out = src
  .replace(/<!doctype html>/i, "")
  .replace(/<\/?html[^>]*>/gi, "")
  .replace(/<\/?head>/gi, "")
  .replace(/<\/?body[^>]*>/gi, "")
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  .trim();
writeFileSync("dist/wrapbox.html", out);
console.log("artifact page:", (out.length / 1024).toFixed(0), "KB");
