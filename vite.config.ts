import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const alias = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@wrapbox/sdk": alias("./src/sdk/wrapbox.ts"),
      "@wrapbox/verify": alias("./src/sdk/verify.ts"),
      "@wrapbox/openai": alias("./src/sdk/openai.ts"),
      "@wrapbox/langgraph": alias("./src/sdk/langgraph.ts"),
    },
  },
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
});
