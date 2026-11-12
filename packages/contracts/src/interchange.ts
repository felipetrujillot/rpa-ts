import {
  FLOW_SCHEMA_VERSION,
  type FlowDocument,
  type FlowValidationResult,
} from "./workflow";
import { validateFlowDocument } from "./validation";
// n8n's workflow shape is an interchange envelope, not an executable n8n SDK.
// Only equivalent built-ins are mapped. Custom RPA types remain explicit.
const incomingTypes: Record<string, string> = {
  "n8n-nodes-base.manualTrigger": "rpa.manualTrigger",
  "n8n-nodes-base.noOp": "rpa.noOp",
};
const outgoingTypes: Record<string, string> = {
  "rpa.manualTrigger": "n8n-nodes-base.manualTrigger",
  "rpa.noOp": "n8n-nodes-base.noOp",
};
export function importN8nWorkflow(input: unknown): FlowValidationResult {
  const bad = (message: string): FlowValidationResult => ({
    ok: false,
    errors: [{ code: "UNSUPPORTED_N8N_WORKFLOW", path: "$", message }],
  });
  if (!input || typeof input !== "object")
    return bad("Se esperaba un workflow n8n.");
  const source = input as Record<string, unknown>;
  if (!Array.isArray(source.nodes) || !source.connections)
    return bad("Faltan nodes o connections.");
  const settings = source.settings as Record<string, unknown> | undefined;
  if (settings && Object.keys(settings).some((key) => key !== "executionOrder"))
    return bad(
      "El workflow utiliza settings de n8n que este motor no implementa.",
    );
  const meta = (source.meta as { rpa?: Record<string, unknown> } | undefined)
    ?.rpa;
  if (meta && meta.schemaVersion !== FLOW_SCHEMA_VERSION)
    return bad("La extensión RPA tiene una versión incompatible.");
  const nodes = [];
  for (const value of source.nodes) {
    if (!value || typeof value !== "object") return bad("Nodo inválido.");
    const node = value as Record<string, unknown>;
    const type = String(node.type);
    if (!type.startsWith("rpa.") && !incomingTypes[type])
      return bad(`Tipo n8n sin implementación en este robot: ${type}`);
    if (node.typeVersion !== 1)
      return bad(
        `Versión de nodo no implementada: ${type} ${node.typeVersion}`,
      );
    nodes.push({ ...node, type: incomingTypes[type] || type });
  }
  return validateFlowDocument({
    kind: "rpa.workflow",
    schemaVersion: FLOW_SCHEMA_VERSION,
    ...(meta?.pluginRequirements ? { pluginRequirements: meta.pluginRequirements } : {}),
    workflow: {
      id: String(source.id || "imported-workflow"),
      name: String(source.name || "Workflow importado"),
      nodes,
      connections: source.connections,
      variables: meta?.variables || {},
      settings: {
        executionOrder: "fifo",
        maxNodeExecutions: meta?.maxNodeExecutions || 1000,
      },
    },
  });
}
export function exportN8nWorkflow(document: FlowDocument) {
  const validated = validateFlowDocument(document);
  if (!validated.ok || !validated.normalized)
    throw new Error(validated.errors.map((error) => error.message).join("; "));
  const { workflow } = validated.normalized;
  return {
    id: workflow.id,
    name: workflow.name,
    active: false,
    nodes: workflow.nodes.map((node) => ({
      ...node,
      type: outgoingTypes[node.type] || node.type,
    })),
    connections: structuredClone(workflow.connections),
    settings: {},
    meta: {
      rpa: {
        schemaVersion: FLOW_SCHEMA_VERSION,
        ...(document.pluginRequirements ? { pluginRequirements: structuredClone(document.pluginRequirements) } : {}),
        variables: structuredClone(workflow.variables),
        maxNodeExecutions: workflow.settings.maxNodeExecutions,
      },
    },
  };
}
