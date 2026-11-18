/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Ships the font licences next to the bundle (the SIL OFL asks for them to travel with the fonts).
const notices: Plugin = {
  name: "third-party-notices",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "THIRD_PARTY_NOTICES.md",
      source: readFileSync(new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
    });
  },
};

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), notices],
  server: {
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000" },
  },
  // The static preview has no backend: /api/* falls through and the app switches to demo mode.
  preview: { proxy: {} },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
