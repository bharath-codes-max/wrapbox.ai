import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Wrapbox Real Prototype — isolated dev server. Port 5980 is intentionally
// distinct from the main wrapbox-prototype app so both can run side by side.
// Two entries: the product (index.html) and the portfolio deck (portfolio.html),
// which imports the same engine so its live slides run the real decision code.
export default defineConfig({
  plugins: [react()],
  server: { port: 5980, strictPort: true },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), portfolio: resolve(__dirname, "portfolio.html") },
    },
  },
});
