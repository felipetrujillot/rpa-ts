import { afterEach, describe, expect, it, vi } from "vitest";
import { excelActionDefinitions, excelPluginRequirement, createWorkflow } from "@rpa/contracts";
import { getPluginInventory, setPluginInventory, assertPluginCompatibility } from "../server/rpa/plugin-inventory";
import { actionInputDefaults, actionDefinition, defaultActionIds } from "../layers/admin/app/utils/workflow-editor";
import { createWorkflowAgentsGuide } from "../layers/admin/app/utils/workflow-agents";
afterEach(() => vi.useRealTimers());
describe("Excel catalog and robot inventory", () => {
  it("uses the same twelve definitions and independent defaults in Canvas and the agent guide", () => {
    expect(excelActionDefinitions).toHaveLength(12);
    const guide = createWorkflowAgentsGuide(excelActionDefinitions.map((a) => a.id));
    for (const action of excelActionDefinitions) {
      expect(defaultActionIds).toContain(action.id);
      expect(actionDefinition(action.id)).toBe(action);
      expect(actionInputDefaults(action.id)).toEqual(action.defaults);
      const defaults = actionInputDefaults(action.id); defaults.changed = true;
      expect(actionInputDefaults(action.id)).not.toHaveProperty("changed");
      expect(guide).toContain(action.id); expect(guide).toContain(action.outputDescription);
    }
  });
  it("isolates inventory by company and robot and expires stale entries", () => {
    vi.useFakeTimers();
    const requirement = excelPluginRequirement(["excel.range.read"]);
    const inventory = { sampledAt: new Date(0).toISOString(), plugins: [{ ...requirement, available: true, platform: "darwin", capabilities: [], permissions: [], verified: false }] };
    setPluginInventory("a", "robot", inventory);
    expect(getPluginInventory("a", "robot")?.plugins[0]?.pluginId).toBe("excel");
    expect(getPluginInventory("b", "robot")).toBeNull(); expect(getPluginInventory("a", "other")).toBeNull();
    const doc = { ...createWorkflow(), pluginRequirements: [requirement] };
    expect(() => assertPluginCompatibility("a", "robot", doc)).not.toThrow();
    vi.advanceTimersByTime(30001);
    expect(getPluginInventory("a", "robot")).toBeNull();
    expect(() => assertPluginCompatibility("a", "robot", doc)).toThrow(/desconocido/);
  });
});
