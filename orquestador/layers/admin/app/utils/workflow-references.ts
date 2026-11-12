import type { DiagramEdge, FlowValue, WorkflowNode } from "@rpa/contracts";

const reserved = new Set(["__proto__", "prototype", "constructor"]);
export const isReferencePath = (path: string) =>
  path.length > 0 &&
  path.split(".").every((part) => part.length > 0 && !reserved.has(part));

export function referencePath(
  value: FlowValue | undefined,
): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$ref" in value
  )
    return String(value.$ref);
  if (typeof value === "string")
    return /^\{\{\s*([\w.\-]+)\s*\}\}$/.exec(value)?.[1];
  return undefined;
}

export function dataReferences(value: FlowValue | undefined): string[] {
  const path = referencePath(value);
  if (path !== undefined) return [path];
  if (typeof value === "string")
    return Array.from(
      value.matchAll(/\{\{\s*([\w.\-]+)\s*\}\}/g),
      (match) => match[1]!,
    );
  if (value && typeof value === "object")
    return [...new Set(Object.values(value).flatMap(dataReferences))];
  return [];
}

export function upstreamNodeIds(
  nodeId: string,
  edges: Pick<DiagramEdge, "source" | "target">[],
): string[] {
  const visited = new Set([nodeId]);
  const queue = [nodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of edges) {
      if (edge.target === queue[i] && !visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return queue.slice(1);
}

export type ReferenceDescription = {
  label: string;
  nodeId?: string;
  warning?: string;
};
export function describeReference(
  path: string,
  nodes: WorkflowNode[],
  currentId?: string,
  availableIds?: string[],
): ReferenceDescription {
  const [root, key, ...rest] = path.split(".");
  if (!isReferencePath(path))
    return {
      label: "Referencia inválida",
      warning:
        "La ruta debe usar campos separados por puntos, sin claves reservadas.",
    };
  if (root === "nodeOutputs") {
    if (!key) return { label: "Salidas de todos los pasos" };
    const node = nodes.find((node) => node.id === key);
    if (!node)
      return {
        label: "Referencia sin origen",
        warning: "El paso de origen ya no existe. Selecciona otro paso.",
      };
    const field = rest.join(".");
    return {
      label: `${node.name}${field ? ` · ${field === "result" ? "resultado" : field}` : " · salida completa"}`,
      nodeId: node.id,
      warning:
        node.id === currentId
          ? "Un paso no puede leer su propio resultado antes de ejecutarse."
          : availableIds && !availableIds.includes(node.id)
            ? "El origen no está conectado antes de este paso. Puede no tener datos al ejecutarse."
            : node.disabled
              ? "El paso de origen está deshabilitado y no producirá su resultado habitual."
              : undefined,
    };
  }
  const roots: Record<string, string> = {
    input: "Entrada del flujo",
    vars: "Variables del flujo",
    last: "Último paso ejecutado",
    json: "Datos del recorrido actual",
  };
  if (!root || !Object.hasOwn(roots, root))
    return {
      label: "Referencia avanzada",
      warning:
        "Usa una ruta que comience con input, vars, nodeOutputs, last o json.",
    };
  const field = [key, ...rest].filter(Boolean).join(".");
  return { label: `${roots[root]}${field ? ` · ${field}` : ""}` };
}

export function scriptInputDescription(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  availableIds?: string[],
): ReferenceDescription | undefined {
  if (
    node.type !== "rpa.action" ||
    node.parameters.actionId !== "script.typescript.run"
  )
    return undefined;
  const data = node.parameters.input.data;
  const paths = dataReferences(data);
  if (!paths.length) return { label: "JSON manual" };
  const descriptions = paths.map((path) =>
    describeReference(path, nodes, node.id, availableIds),
  );
  if (referencePath(data) !== undefined) return descriptions[0];
  return {
    label: `JSON con ${paths.length} referencia${paths.length === 1 ? "" : "s"}`,
    warning: descriptions.find((source) => source.warning)?.warning,
  };
}

export type ReferenceExample = {
  runId: string;
  date: string;
  versionId: string | null;
  context: { input: unknown; vars: unknown; nodeOutputs: unknown };
};

export function referenceExampleValue(
  data: FlowValue | undefined,
  example: ReferenceExample,
  nodes: WorkflowNode[],
): { value?: unknown; unavailable?: string } {
  let unavailable: string | undefined;
  const read = (path: string): unknown => {
    const [root, nodeId] = path.split(".");
    if (!isReferencePath(path)) {
      unavailable = "La referencia es inválida.";
      return;
    }
    if (root === "last" || root === "json") {
      unavailable =
        "Esta referencia depende del recorrido durante la ejecución. Elige un paso concreto para ver un ejemplo.";
      return;
    }
    if (
      root === "nodeOutputs" &&
      nodes.find((node) => node.id === nodeId)?.sensitiveOutput
    ) {
      unavailable = "La salida de este paso está protegida.";
      return;
    }
    if (
      root === "nodeOutputs" &&
      !nodeId &&
      nodes.some((node) => node.sensitiveOutput)
    ) {
      unavailable =
        "La colección contiene salidas protegidas. Selecciona un paso concreto.";
      return;
    }
    let value: unknown = example.context;
    for (const part of path.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) {
        unavailable = "La ejecución no contiene datos para esta referencia.";
        return;
      }
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  };
  const resolve = (value: FlowValue | undefined): unknown => {
    const path = referencePath(value);
    if (path !== undefined) return read(path);
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, resolve(item)]),
      );
    if (typeof value === "string")
      return value.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, path: string) => {
        const result = read(path);
        return typeof result === "object"
          ? JSON.stringify(result)
          : String(result ?? "");
      });
    return value;
  };
  // String data is parsed as JSON by the script action after template resolution.
  try {
    const value = resolve(data ?? {});
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return unavailable ? { unavailable } : { value: parsed };
  } catch {
    return {
      unavailable:
        unavailable ?? "Los datos de texto deben contener JSON válido.",
    };
  }
}
