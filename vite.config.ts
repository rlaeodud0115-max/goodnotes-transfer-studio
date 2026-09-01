import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: { port: 4173 },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node" },
});
