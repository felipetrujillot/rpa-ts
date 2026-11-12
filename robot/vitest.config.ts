import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/automation/**/*.test.ts", "tests/realtime/**/*.test.ts"],
    clearMocks: true,
  },
});
