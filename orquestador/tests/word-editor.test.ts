import { expect, it } from "vitest";
import { wordActionDefinitions } from "@rpa/contracts";
import { actionDefinition, actionInputDefaults, defaultActionIds } from "../layers/admin/app/utils/workflow-editor";
import { createWorkflowAgentsGuide } from "../layers/admin/app/utils/workflow-agents";
it("offers Word offline with declarative forms, cloneable defaults and the same output guide", () => {
  const guide = createWorkflowAgentsGuide(defaultActionIds);
  for (const action of wordActionDefinitions) {
    expect(defaultActionIds).toContain(action.id); expect(actionDefinition(action.id)).toBe(action);
    const defaults = actionInputDefaults(action.id); defaults.changed = true;
    expect(actionInputDefaults(action.id)).toEqual(action.defaults);
    expect(guide).toContain(action.outputDescription);
  }
});
