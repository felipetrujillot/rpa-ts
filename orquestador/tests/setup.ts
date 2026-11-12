import { vi } from "vitest";
import { defineEventHandler } from "h3";
vi.stubGlobal("useRuntimeConfig", () => ({
  jwtSecret: "rpa-integration-tests-only-secret-32-characters",
}));
vi.stubGlobal("defineEventHandler", defineEventHandler);
vi.stubGlobal("defineWebSocketHandler", (handler: unknown) => handler);
