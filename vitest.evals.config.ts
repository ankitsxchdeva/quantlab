import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
});
