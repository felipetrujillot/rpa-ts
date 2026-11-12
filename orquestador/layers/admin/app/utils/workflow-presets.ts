import {
  createWorkflow,
  type FlowDocument,
  type WorkflowNode,
} from "@rpa/contracts";

export type PresetPlatform = "macos" | "windows" | "linux";
export const workflowPresets = [
  {
    id: "calculator",
    name: "Abrir Calculadora",
    icon: "calculator",
    description: "Abre la calculadora del equipo donde se ejecuta el agente.",
    steps: "Inicio → Abrir Calculadora → Fin",
    requirement:
      "Requiere CUA Desktop. En Linux, usa GNOME Calculator o cambia la aplicación en el paso.",
  },
  {
    id: "list-apps",
    name: "Listar aplicaciones",
    icon: "desktop",
    description:
      "Consulta las aplicaciones disponibles en el equipo del agente.",
    steps: "Inicio → Listar aplicaciones → Fin",
    requirement: "Requiere CUA Desktop con sus permisos habilitados.",
  },
  {
    id: "web-screenshot",
    name: "Abrir web y capturar",
    icon: "browser",
    description:
      "Abre una página y guarda una captura completa. Puedes cambiar la URL y la ruta de salida.",
    steps: "Inicio → Abrir página → Capturar → Fin",
    requirement: "Requiere Playwright conectado en el agente.",
  },
] as const;
export type WorkflowPresetId = (typeof workflowPresets)[number]["id"];
const calculatorApplications: Record<PresetPlatform, string> = {
  macos: "com.apple.calculator",
  windows: "calc.exe",
  linux: "gnome-calculator",
};
export function createWorkflowPreset(
  id: WorkflowPresetId,
  platform: PresetPlatform,
): FlowDocument {
  const preset = workflowPresets.find((p) => p.id === id);
  if (!preset) throw new Error("Preset de flujo desconocido.");
  const document = createWorkflow(preset.name, crypto.randomUUID());
  const actions: Array<{
    name: string;
    actionId: string;
    input: Extract<WorkflowNode, { type: "rpa.action" }>["parameters"]["input"];
  }> =
    id === "calculator"
      ? [
          {
            name: "Abrir Calculadora",
            actionId: "cua.app.launch",
            input: { application: calculatorApplications[platform] },
          },
        ]
      : id === "list-apps"
        ? [
            {
              name: "Listar aplicaciones",
              actionId: "cua.apps.list",
              input: {},
            },
          ]
        : [
            {
              name: "Abrir página",
              actionId: "playwright.browser.openTab",
              input: { url: "https://example.com" },
            },
            {
              name: "Capturar página",
              actionId: "playwright.page.screenshot",
              input: { path: "./artifacts/pagina.png", fullPage: true },
            },
          ];
  for (const [index, action] of actions.entries()) {
    document.workflow.nodes.push({
      id: crypto.randomUUID(),
      name: action.name,
      type: "rpa.action",
      typeVersion: 1,
      position: [360 + index * 280, 160],
      parameters: { actionId: action.actionId, input: action.input },
    });
  }
  document.workflow.nodes.push({
    id: crypto.randomUUID(),
    name: "Fin",
    type: "rpa.end",
    typeVersion: 1,
    position: [360 + actions.length * 280, 160],
    parameters: {},
  });
  for (let index = 0; index < document.workflow.nodes.length - 1; index++) {
    const source = document.workflow.nodes[index]!,
      target = document.workflow.nodes[index + 1]!;
    document.workflow.connections[source.name] = {
      main: [[{ node: target.name, type: "main", index: 0 }]],
    };
  }
  return document;
}
