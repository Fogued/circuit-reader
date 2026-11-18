/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
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
