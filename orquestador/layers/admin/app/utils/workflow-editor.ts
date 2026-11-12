import {
  cuaActionDefinitions,
  builtinPluginActions,
  scriptActionDefinition,
  nodeTypes,
  nodeInputCount,
  nodeOutputCount,
  workflowNodeSchema,
  type WorkflowNode,
  type FlowValue,
  type DiagramNode,
  type DiagramEdge,
} from "@rpa/contracts";

export const actionGroups = [
  { name: "Word", prefix: "word.", description: "Plantillas DOCX y PDF con Microsoft Word" },
  { name: "Excel", prefix: "excel.", description: "Libros, hojas y rangos con Microsoft Excel" },
  {
    name: "Lógica",
    prefix: "script.",
    description: "Transforma datos e integra APIs con TypeScript",
  },
  {
    name: "Navegador",
    prefix: "playwright.",
    description: "Automatiza sitios y aplicaciones web",
  },
  {
    name: "Escritorio",
    prefix: "cua.",
    description: "Controla aplicaciones y ventanas",
  },
] as const;

export function actionCategory(id: string) {
  if (id.startsWith("script.")) return "logic";
  if (id.startsWith("excel.")) return "excel";
  if (id.startsWith("word.")) return "word";
  if (id.startsWith("playwright.")) return "browser";
  return "desktop";
}
export const defaultActionIds = [
  scriptActionDefinition.id,
  ...builtinPluginActions.map((action) => action.id),
  ...cuaActionDefinitions.map((action) => action.id),
  "playwright.browser.openTab",
  "playwright.browser.closeTab",
  "playwright.browser.switchTab",
  "playwright.page.click",
  "playwright.page.type",
  "playwright.page.select",
  "playwright.page.upload",
  "playwright.page.download",
  "playwright.page.screenshot",
  "playwright.page.evaluate",
  "playwright.page.iframe",
  "playwright.page.popup",
  "playwright.browser.cookies",
  "playwright.browser.localStorage",
  "playwright.page.waitForElement",
  "playwright.network.request",
];
const actionNames: Record<string, string> = {
  "playwright.browser.openTab": "Abrir una página",
  "playwright.browser.closeTab": "Cerrar pestaña",
  "playwright.browser.switchTab": "Cambiar de pestaña",
  "playwright.page.click": "Hacer clic en la página",
  "playwright.page.type": "Escribir en la página",
  "playwright.page.select": "Seleccionar una opción",
  "playwright.page.screenshot": "Capturar página",
  "playwright.page.waitForElement": "Esperar un elemento",
  "playwright.network.request": "Solicitud HTTP",
  "playwright.page.upload": "Subir un archivo",
  "playwright.page.download": "Descargar un archivo",
  "playwright.page.evaluate": "Evaluar JavaScript",
};
export const actionDefinition = (id: string) =>
  [scriptActionDefinition, ...cuaActionDefinitions, ...builtinPluginActions].find(
    (action) => action.id === id,
  );
export const actionLabel = (id: string) =>
  actionDefinition(id)?.name ?? actionNames[id] ?? id;
export const actionDescription = (id: string) =>
  actionDefinition(id)?.description ?? id;
// Names match the input fields consumed by the robot action registry.
export function actionInputDefaults(id: string): Record<string, FlowValue> {
  const templates: Record<string, Record<string, FlowValue>> = {
    "playwright.browser.openTab": { url: "" },
    "playwright.browser.switchTab": { tabId: "" },
    "playwright.page.click": { selector: "" },
    "playwright.page.type": { selector: "", text: "", clearFirst: true },
    "playwright.page.select": { selector: "", value: "" },
    "playwright.page.upload": { selector: "", filePath: "" },
    "playwright.page.download": { triggerSelector: "" },
    "playwright.page.evaluate": { expression: "" },
    "playwright.page.iframe": {
      frameSelector: "",
      action: "click",
      selector: "",
    },
    "playwright.page.popup": { triggerSelector: "" },
    "playwright.page.waitForElement": { selector: "", state: "visible" },
    "playwright.network.request": { method: "GET", url: "" },
  };
  return structuredClone(actionDefinition(id)?.defaults ?? templates[id] ?? {});
}
export const nodeDescription: Record<WorkflowNode["type"], string> = {
  "rpa.manualTrigger": "Inicia el flujo de forma manual",
  "rpa.action": "Ejecuta una acción en el navegador o el equipo",
  "rpa.if": "Divide el flujo según una condición",
  "rpa.set": "Crea o actualiza variables del flujo",
  "rpa.while": "Repite pasos mientras se cumpla una condición",
  "rpa.forEach": "Procesa los elementos de una lista",
  "rpa.noOp": "Conecta pasos sin modificar los datos",
  "rpa.end": "Finaliza esta rama del flujo",
};
export function uniqueNodeName(
  base: string,
  nodes: DiagramNode[],
  exceptId?: string,
) {
  let name = base;
  let suffix = 2;
  while (nodes.some((n) => n.id !== exceptId && n.data.node.name === name))
    name = `${base} ${suffix++}`;
  return name;
}
export function makeEditorNode(
  type: WorkflowNode["type"],
  nodes: DiagramNode[],
  position: { x: number; y: number },
  actionId?: string,
): DiagramNode {
  const parameters =
    type === "rpa.action"
      ? {
          actionId: actionId || defaultActionIds[0],
          input: actionInputDefaults(actionId || defaultActionIds[0]!),
        }
      : type === "rpa.if"
        ? { condition: { op: "truthy", value: { $ref: "input.condition" } } }
        : type === "rpa.set"
          ? { values: {} }
          : type === "rpa.while"
            ? {
                condition: { op: "truthy", value: { $ref: "vars.continue" } },
                maxIterations: 100,
              }
            : type === "rpa.forEach"
              ? {
                  items: { $ref: "input.items" },
                  itemVar: "item",
                  indexVar: "index",
                  maxIterations: 100,
                }
              : {};
  const name = uniqueNodeName(
    actionId
      ? actionLabel(actionId)
      : nodeTypes.find((n) => n.type === type)!.displayName,
    nodes,
  );
  const node = workflowNodeSchema.parse({
    id: crypto.randomUUID(),
    name,
    type,
    typeVersion: 1,
    position: [position.x, position.y],
    parameters,
  });
  return {
    id: node.id,
    type: "workflow",
    position,
    deletable: type !== "rpa.manualTrigger",
    data: { node },
  };
}
export function editorConnection(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  sourceId: string,
  targetId: string,
  output: number,
): DiagramEdge | null {
  const source = nodes.find((n) => n.id === sourceId),
    target = nodes.find((n) => n.id === targetId);
  if (
    !source ||
    !target ||
    sourceId === targetId ||
    !nodeInputCount(target.data.node) ||
    !Number.isInteger(output) ||
    output < 0 ||
    output >= nodeOutputCount(source.data.node)
  )
    return null;
  const id = `${sourceId}:${output}:${targetId}:0`;
  if (edges.some((e) => e.id === id)) return null;
  return {
    id,
    source: sourceId,
    target: targetId,
    sourceHandle: `main:${output}`,
    targetHandle: "main:0",
  };
}
export function createEditorHistory(initial: string, limit = 100) {
  let entries = [initial],
    index = 0;
  return {
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < entries.length - 1;
    },
    push(value: string) {
      if (entries[index] === value) return;
      entries = [...entries.slice(0, index + 1), value].slice(-limit);
      index = entries.length - 1;
    },
    undo() {
      return index > 0 ? entries[--index] : undefined;
    },
    redo() {
      return index < entries.length - 1 ? entries[++index] : undefined;
    },
  };
}
