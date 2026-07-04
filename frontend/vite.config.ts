import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The production bundle is emitted straight into the Python package so that
// `pip install` / `uv run` users never need Node. Remember to commit it.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/fourierlens/webui",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8321",
    },
  },
});
