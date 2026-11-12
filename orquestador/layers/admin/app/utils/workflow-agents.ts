import { excelAgentGuide, wordAgentGuide } from "@rpa/contracts";
import guide from "../assets/workflow-agents.md?raw";
import { actionInputDefaults, actionDefinition } from "./workflow-editor";

export function createWorkflowAgentsGuide(actionIds: string[]): string {
  const catalog = [...new Set(actionIds)].map((actionId) => ({
    actionId,
    suggestedInput: actionInputDefaults(actionId),
    ...(actionDefinition(actionId)
      ? {
          description: actionDefinition(actionId)!.description,
          inputFields: actionDefinition(actionId)!.inputFields,
        }
      : {}),
  }));
  return (guide + "\n\n" + excelAgentGuide() + "\n\n" + wordAgentGuide()).replace(
    "{{ACTION_CATALOG}}",
    () => "```json\n" + JSON.stringify(catalog, null, 2) + "\n```",
  );
}
