import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Single-file builds for docs/ (GitHub Pages). Every script, style, screenshot and
// logo is inlined so each page opens from disk and publishes as one file.
//   ENTRY=portfolio     → the deck, v1 (default; `npm run build:portfolio`)
//   ENTRY=portfolio-v2  → the deck, v2 (use cases played live in the product)
//   ENTRY=tour          → the real app + walkthrough player the v2 deck embeds
const entry = process.env.ENTRY ?? "portfolio";
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: `docs/${entry}-build`,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: resolve(__dirname, `${entry}.html`) },
  },
});
