import { z } from "zod";
import type { FlowDocument } from "./workflow";
export const SCRIPT_MAX_ACTIONS = 100;
export const scriptAllowedActionsSchema = z
  .array(
    z
      .string()
      .regex(/^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/)
      .max(160),
  )
  .max(SCRIPT_MAX_ACTIONS)
  .refine(
    (ids) =>
      new Set(ids).size === ids.length &&
      ids.every((id) => !id.startsWith("script.")),
    "No se permiten duplicados ni llamadas recursivas a scripts.",
  );
export function declaredScriptActions(value: unknown): string[] {
  return scriptAllowedActionsSchema.parse(value ?? []);
}
export function workflowActionIds(document: FlowDocument): string[] {
  return document.workflow.nodes.flatMap((node) =>
    node.type !== "rpa.action" || node.disabled
      ? []
      : node.parameters.actionId === "script.typescript.run"
        ? [
            node.parameters.actionId,
            ...declaredScriptActions(node.parameters.input.allowedActions),
          ]
        : [node.parameters.actionId],
  );
}
