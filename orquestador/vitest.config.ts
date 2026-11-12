import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "~~": resolve(__dirname),
      "hub:db:schema": resolve(__dirname, "server/db/schema/schema.ts"),
      "hub:db": resolve(__dirname, "tests/database.ts"),
    },
  },
  test: {
    include: ["orquestador/tests/**/*.test.ts"],
    setupFiles: ["orquestador/tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
