import { describe, expect, it } from "vitest";
import { AutomationRegistry } from "../core/registry";
import type { AutomationAction, AutomationContext } from "../core/types";

const createContext = (): AutomationContext => ({
  appContexts: {},
});

describe("AutomationRegistry", () => {
  it("registers apps and lists action descriptors", async () => {
    const registry = new AutomationRegistry();
    const action: AutomationAction = {
      id: "sample.action",
      appId: "sample",
      name: "Sample",
      description: "Sample action",
      run: async () => ({ ok: true, message: "ok" }),
    };

    registry.registerApp({
      id: "sample",
      name: "Sample App",
      description: "Test app",
      actions: [action],
    });

    const descriptors = await registry.listActions(createContext());

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      id: "sample.action",
      appId: "sample",
      name: "Sample",
      available: true,
    });
  });

  it("returns ACTION_NOT_FOUND when action does not exist", async () => {
    const registry = new AutomationRegistry();

    const result = await registry.execute(
      "missing",
      undefined,
      createContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("ACTION_NOT_FOUND");
  });

  it("blocks execution when action is unavailable", async () => {
    const registry = new AutomationRegistry();

    registry.registerAction({
      id: "blocked.action",
      appId: "sample",
      name: "Blocked",
      description: "Blocked action",
      availability: {
        available: false,
        unavailableReason: "Not connected",
      },
      run: async () => ({ ok: true, message: "should not run" }),
    });

    const result = await registry.execute(
      "blocked.action",
      undefined,
      createContext(),
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("ACTION_UNAVAILABLE");
    expect(result.message).toBe("Not connected");
  });
});
