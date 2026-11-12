import { wordInputSchemas, validateWordTemplate, type WordActionId } from "./word";
import { z } from "zod";
import { declaredScriptActions } from "./script-policy";
import { scriptSdkInputSchemas } from "./script-sdk";
import { excelInputSchemas, validateExcelTemplate, type ExcelActionId } from "./excel";
import {
  FLOW_SCHEMA_VERSION,
  flowDocumentSchema,
  nodeOutputCount,
  nodeInputCount,
  type FlowDocument,
  type FlowValidationResult,
  type FlowValidationError,
  type WorkflowNode,
} from "./workflow";
export const isSchemaVersionCompatible = (version: string) =>
  version === FLOW_SCHEMA_VERSION;
export function validateFlowDocument(
  input: unknown,
  options: { knownActionIds?: Set<string> } = {},
): FlowValidationResult {
  const pendingValues: Array<{ value: unknown; depth: number }> = [
    { value: input, depth: 0 },
  ];
  let inspected = 0;
  while (pendingValues.length) {
    const current = pendingValues.pop()!;
    if (current.depth > 100 || ++inspected > 200000)
      return {
        ok: false,
        errors: [
          {
            code: "DOCUMENT_LIMIT",
            path: "$",
            message: "El documento supera los límites de complejidad.",
          },
        ],
      };
    if (current.value && typeof current.value === "object")
      for (const [key, nested] of Object.entries(current.value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          return {
            ok: false,
            errors: [
              { code: "RESERVED_KEY", path: key, message: "Clave reservada." },
            ],
          };
        pendingValues.push({ value: nested, depth: current.depth + 1 });
      }
  }
  const parsed = flowDocumentSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "STRUCTURE_ERROR",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  const document = parsed.data;
  const { nodes, connections } = document.workflow;
  const errors: FlowValidationError[] = [];
  const issue = (code: string, path: string, message: string) =>
    errors.push({ code, path, message });
  const names = new Map<string, WorkflowNode>();
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id))
      issue(
        "DUPLICATE_NODE_ID",
        `workflow.nodes.${node.id}`,
        `ID repetido: ${node.id}`,
      );
    if (names.has(node.name))
      issue(
        "DUPLICATE_NODE_NAME",
        `workflow.nodes.${node.id}.name`,
        `Nombre repetido: ${node.name}`,
      );
    if (node.type === "rpa.action" && node.parameters.actionId.startsWith("excel.") && !node.disabled) {
      if (!Object.hasOwn(excelInputSchemas, node.parameters.actionId)) issue("UNKNOWN_ACTION", `workflow.nodes.${node.id}`, "Acción Excel desconocida.");
      else try { validateExcelTemplate(node.parameters.actionId as ExcelActionId, node.parameters.input); }
      catch (error) { issue("EXCEL_INPUT_INVALID", `workflow.nodes.${node.id}.parameters.input`, error instanceof Error ? error.message : String(error)); }
    }
    if (node.type === "rpa.action" && node.parameters.actionId.startsWith("word.") && !node.disabled) {
      if (!Object.hasOwn(wordInputSchemas, node.parameters.actionId)) issue("UNKNOWN_ACTION", `workflow.nodes.${node.id}`, "Acción Word desconocida.");
      else try { validateWordTemplate(node.parameters.actionId as WordActionId, node.parameters.input); }
      catch (error) { issue("WORD_INPUT_INVALID", `workflow.nodes.${node.id}.parameters.input`, error instanceof Error ? error.message : String(error)); }
    }
    if (node.type === "rpa.action" && node.parameters.actionId === "script.typescript.run" && !node.disabled) {
      try {
        for (const id of declaredScriptActions(node.parameters.input.allowedActions)) {
          if (!Object.hasOwn(scriptSdkInputSchemas, id) || (options.knownActionIds && !options.knownActionIds.has(id)))
            issue("SCRIPT_ACTION_UNKNOWN", `workflow.nodes.${node.id}.parameters.input.allowedActions`, `Acción SDK desconocida o no instalada: ${id}`);
        }
      } catch { issue("SCRIPT_PERMISSIONS_INVALID", `workflow.nodes.${node.id}.parameters.input.allowedActions`, "allowedActions debe ser una lista literal de IDs únicos, sin comodines ni scripts."); }
    }
    ids.add(node.id);
    names.set(node.name, node);
    if (
      node.type === "rpa.action" &&
      options.knownActionIds &&
      !options.knownActionIds.has(node.parameters.actionId)
    )
      issue(
        "UNKNOWN_ACTION",
        `workflow.nodes.${node.id}.parameters.actionId`,
        `Acción desconocida: ${node.parameters.actionId}`,
      );
  }
  const requirementIds = new Set<string>();
  for (const requirement of document.pluginRequirements ?? []) {
    if (requirementIds.has(requirement.pluginId)) issue("DUPLICATE_PLUGIN", "pluginRequirements", "Requisito de plugin duplicado.");
    requirementIds.add(requirement.pluginId);
  }
  const triggers = nodes.filter((node) => node.type === "rpa.manualTrigger");
  if (triggers.length !== 1 || triggers[0]?.disabled)
    issue(
      "INVALID_TRIGGER",
      "workflow.nodes",
      "Se requiere exactamente un inicio manual habilitado.",
    );
  const visitValue = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visitValue(entry, `${path}.${index}`));
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("$ref" in record) {
        const ref = record.$ref;
        if (
          Object.keys(record).length !== 1 ||
          typeof ref !== "string" ||
          !/^(input|vars|nodeOutputs|last|json)(\.[a-zA-Z0-9_\-]+)+$/.test(
            ref,
          ) ||
          ref
            .split(".")
            .some((part) =>
              ["__proto__", "prototype", "constructor"].includes(part),
            )
        )
          issue(
            "INVALID_TEMPLATE_REFERENCE",
            path,
            "Referencia inválida. Usa input, vars, nodeOutputs, last o json.",
          );
        return;
      }
      Object.entries(record).forEach(([key, nested]) =>
        visitValue(nested, `${path}.${key}`),
      );
    }
  };
  nodes.forEach((node) =>
    visitValue(node.parameters, `workflow.nodes.${node.id}.parameters`),
  );
  visitValue(document.workflow.variables, "workflow.variables");
  for (const [source, ports] of Object.entries(connections)) {
    const node = names.get(source);
    if (!node) {
      issue(
        "INVALID_REFERENCE",
        `workflow.connections.${source}`,
        "Origen inexistente.",
      );
      continue;
    }
    ports.main.forEach((targets, output) => {
      if (output >= nodeOutputCount(node) && targets.length)
        issue(
          "INVALID_PORT",
          `workflow.connections.${source}.main.${output}`,
          "Puerto de salida inexistente.",
        );
      const used = new Set<string>();
      for (const target of targets) {
        const destination = names.get(target.node);
        if (!destination)
          issue(
            "INVALID_REFERENCE",
            `workflow.connections.${source}`,
            "Destino inexistente: " + target.node,
          );
        else if (!nodeInputCount(destination))
          issue(
            "INVALID_PORT",
            `workflow.connections.${source}`,
            "No se puede conectar hacia el inicio.",
          );
        if (used.has(target.node))
          issue(
            "DUPLICATE_CONNECTION",
            `workflow.connections.${source}`,
            "Conexión repetida.",
          );
        used.add(target.node);
      }
    });
  }
  const reachable = new Set<string>();
  const pending = triggers.map((node) => node.name);
  while (pending.length) {
    const name = pending.pop()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const port of connections[name]?.main || [])
      for (const target of port) pending.push(target.node);
  }
  for (const node of nodes)
    if (!reachable.has(node.name))
      issue(
        "UNREACHABLE_NODE",
        `workflow.nodes.${node.id}`,
        "Nodo sin conexión desde el inicio.",
      );
  // Remove bounded loop nodes, then every remaining cycle is uncontrolled.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string) => {
    const node = names.get(name);
    if (!node || node.type === "rpa.while" || node.type === "rpa.forEach")
      return;
    if (visiting.has(name)) {
      issue(
        "UNBOUNDED_CYCLE",
        `workflow.connections.${name}`,
        "El ciclo requiere un nodo de bucle con límite.",
      );
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const port of connections[name]?.main || [])
      for (const target of port) visit(target.node);
    visiting.delete(name);
    visited.add(name);
  };
  nodes.forEach((node) => visit(node.name));
  return errors.length
    ? { ok: false, errors }
    : { ok: true, errors: [], normalized: document };
}
export const flowDocumentJsonSchema = z.toJSONSchema(flowDocumentSchema, {
  target: "draft-2020-12",
  unrepresentable: "any",
});
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};
export const serializeFlowDocument = (document: FlowDocument) =>
  stableStringify(document);
export const deserializeFlowDocument = (
  serialized: string,
  knownActionIds?: Set<string>,
): FlowValidationResult => {
  try {
    return validateFlowDocument(JSON.parse(serialized), { knownActionIds });
  } catch {
    return {
      ok: false,
      errors: [{ code: "INVALID_JSON", path: "$", message: "JSON inválido." }],
    };
  }
};
export const computeFlowChecksum = async (document: FlowDocument) => {
  const bytes = new TextEncoder().encode(serializeFlowDocument(document));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};
