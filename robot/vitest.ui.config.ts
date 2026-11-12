import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ui/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
