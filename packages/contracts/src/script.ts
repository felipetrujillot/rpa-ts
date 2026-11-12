import type { ActionInputField } from "./automation";

export const scriptActionDefinition = {
  id: "script.typescript.run",
  name: "Ejecutar TypeScript",
  description:
    "Ejecuta TypeScript aislado con input, log, http y el SDK rpa. Las acciones del SDK requieren permiso explícito del nodo y del servidor.",
  inputFields: [
    { key: "code", label: "Código TypeScript", type: "text", required: true },
    {
      key: "allowedActions",
      label: "Acciones permitidas para el SDK",
      type: "text",
    },
    {
      key: "data",
      label: "Datos para input (JSON o referencia)",
      type: "text",
    },
    {
      key: "timeoutMs",
      label: "Tiempo máximo (100–30000 ms)",
      type: "number",
      defaultValue: 5000,
    },
  ] as ActionInputField[],
  defaults: {
    code: 'const datos = input as { nombre?: string };\nlog("Procesando datos");\nreturn { saludo: `Hola ${datos.nombre ?? "mundo"}` };',
    data: {} as Record<string, import("./workflow").FlowValue>,
    timeoutMs: 5000,
    allowedActions: [] as string[],
  },
};
