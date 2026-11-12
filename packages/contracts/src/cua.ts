import type { ActionInputField } from "./automation";
import type { FlowValue } from "./workflow";

export type CuaActionDefinition = {
  id: string;
  name: string;
  description: string;
  inputFields: ActionInputField[];
  defaults: Record<string, FlowValue>;
};
const text = (
  key: string,
  label: string,
  required = true,
): ActionInputField => ({ key, label, type: "text", required });
const number = (
  key: string,
  label: string,
  defaultValue = 0,
): ActionInputField => ({
  key,
  label,
  type: "number",
  required: true,
  defaultValue,
});
const select = (
  key: string,
  label: string,
  values: string[],
  defaultValue: string,
): ActionInputField => ({
  key,
  label,
  type: "select",
  defaultValue,
  options: values.map((value) => ({ label: value, value })),
});
const windowFields = [
  number("pid", "PID de la aplicación"),
  number("windowId", "ID de la ventana"),
];
const windowTarget = { pid: 0, windowId: 0 };
const elementFields = [
  text("label", "Etiqueta exacta", false),
  text("role", "Rol exacto", false),
];
const delivery = select(
  "deliveryMode",
  "Entrega",
  ["background", "foreground"],
  "background",
);
const scope = select("scope", "Destino", ["window", "desktop"], "window");
const xy = [
  number("x", "X (píxeles de la captura)"),
  number("y", "Y (píxeles de la captura)"),
];
const button = select("button", "Botón", ["left", "right", "middle"], "left");
const scopedFields = [scope, ...windowFields];
const scopedDefaults = {
  scope: "window",
  ...windowTarget,
  deliveryMode: "background",
};
const define = (
  id: string,
  name: string,
  description: string,
  inputFields: ActionInputField[],
  defaults: Record<string, FlowValue> = {},
): CuaActionDefinition => ({
  id: `cua.${id}`,
  name,
  description,
  inputFields,
  defaults,
});

// Shared by the robot registry and workflow editor, including offline editing.
export const cuaActionDefinitions: CuaActionDefinition[] = [
  define(
    "apps.list",
    "Listar aplicaciones",
    "Consulta las aplicaciones disponibles y en ejecución.",
    [],
  ),
  define(
    "app.launch",
    "Abrir aplicación",
    "Abre una aplicación por nombre, ruta o Bundle ID en macOS; puede abrir URLs al iniciarla.",
    [
      text("application", "Aplicación"),
      {
        ...text("urls", "URLs separadas por coma", false),
        description: "Abre estos enlaces o archivos después de iniciar la aplicación.",
      },
    ],
    { application: "", urls: "" },
  ),
  define(
    "windows.list",
    "Listar ventanas",
    "Lista ventanas; permite filtrar por aplicación o PID.",
    [
      text("application", "Aplicación", false),
      { ...number("pid", "PID"), required: false },
    ],
    { application: "" },
  ),
  define(
    "windows.waitFor",
    "Esperar una ventana o diálogo",
    "Espera hasta que aparezca una ventana que coincida con la aplicación, PID o título; devuelve su PID e ID exactos.",
    [
      { ...text("application", "Aplicación", false) },
      { ...number("pid", "PID", 0), required: false },
      text("titleContains", "El título contiene", false),
      number("timeoutMs", "Tiempo máximo (ms)", 10000),
      number("stableSamples", "Lecturas coincidentes", 1),
    ],
    { application: "", titleContains: "", timeoutMs: 10000, stableSamples: 1 },
  ),
  define(
    "window.capture",
    "Capturar ventana",
    "Captura la ventana exacta y su árbol de accesibilidad.",
    windowFields,
    windowTarget,
  ),
  define(
    "element.click",
    "Hacer clic en un elemento",
    "Busca una etiqueta o rol únicos en una captura nueva y pulsa el control.",
    [...windowFields, ...elementFields, button, delivery],
    { ...windowTarget, label: "", button: "left", deliveryMode: "background" },
  ),
  define(
    "element.doubleClick",
    "Doble clic en un elemento",
    "Busca un control único y ejecuta un doble clic.",
    [...windowFields, ...elementFields, delivery],
    { ...windowTarget, label: "", deliveryMode: "background" },
  ),
  define(
    "element.setValue",
    "Asignar valor a un control",
    "Asigna un valor accesible; permite elegir opciones sin abrir el menú.",
    [...windowFields, ...elementFields, text("value", "Valor")],
    { ...windowTarget, label: "", value: "" },
  ),
  define(
    "text.type",
    "Escribir texto",
    "En ventana, selecciona un control por etiqueta/rol o usa el foco actual. En desktop, escribe en la aplicación activa.",
    [...scopedFields, ...elementFields, text("text", "Texto"), delivery],
    { ...scopedDefaults, text: "" },
  ),
  define(
    "key.press",
    "Pulsar una tecla",
    "Envía una tecla y modificadores a la ventana exacta o a la aplicación activa en desktop.",
    [
      ...scopedFields,
      text("key", "Tecla"),
      text("modifiers", "Modificadores separados por coma", false),
      delivery,
    ],
    { ...scopedDefaults, key: "", modifiers: "" },
  ),
  define(
    "key.hotkey",
    "Ejecutar atajo de teclado",
    "Envía una combinación como cmd,c o ctrl,shift,s.",
    [...scopedFields, text("keys", "Teclas separadas por coma"), delivery],
    { ...scopedDefaults, keys: "" },
  ),
  define(
    "menu.invoke",
    "Abrir una opción de menú",
    "Invoca una ruta exacta del menú mediante accesibilidad.",
    [...windowFields, text("path", "Ruta separada por >")],
    { ...windowTarget, path: "" },
  ),
  define(
    "window.focus",
    "Traer ventana al frente",
    "Activa la aplicación y verifica la ventana indicada.",
    windowFields,
    windowTarget,
  ),
  define(
    "window.setFrame",
    "Mover o redimensionar ventana",
    "Ajusta la geometría en las unidades de list_windows y verifica el resultado.",
    [
      ...windowFields,
      number("x", "X del escritorio"),
      number("y", "Y del escritorio"),
      number("width", "Ancho", 800),
      number("height", "Alto", 600),
    ],
    { ...windowTarget, x: 0, y: 0, width: 800, height: 600 },
  ),
  define(
    "window.zoom",
    "Ampliar región de ventana",
    "Captura una región de la ventana en píxeles de su captura.",
    [
      ...windowFields,
      number("x1", "X inicial"),
      number("y1", "Y inicial"),
      number("x2", "X final", 200),
      number("y2", "Y final", 200),
    ],
    { ...windowTarget, x1: 0, y1: 0, x2: 200, y2: 200 },
  ),
  define(
    "desktop.capture",
    "Capturar escritorio",
    "Captura la pantalla completa; las coordenadas desktop usan esta imagen.",
    [number("maxDimension", "Máximo de píxeles (0: original)")],
    { maxDimension: 0 },
  ),
  define(
    "desktop.tree",
    "Inspeccionar escritorio",
    "Lista aplicaciones y ventanas visibles con límites y orden de superposición.",
    [],
  ),
  define(
    "screen.size",
    "Consultar tamaño de pantalla",
    "Devuelve el tamaño lógico y la escala de la pantalla principal.",
    [],
  ),
  define(
    "cursor.position",
    "Consultar posición del cursor",
    "Devuelve la posición real en puntos de pantalla; puede diferir de los píxeles de captura.",
    [],
  ),
  define(
    "cursor.move",
    "Mover cursor",
    "En window mueve el cursor visual del agente. En desktop mueve el puntero real con coordenadas de captura del escritorio.",
    [...scopedFields, ...xy, delivery],
    { ...scopedDefaults, x: 0, y: 0 },
  ),
  define(
    "image.click",
    "Buscar y hacer clic por imagen",
    "Busca una imagen de la biblioteca en una captura nueva y hace clic en su centro. Exige una coincidencia única; permite limitar la región de búsqueda.",
    [
      { ...text("assetId", "Imagen de referencia"), type: "image" },
      ...scopedFields,
      number("minSimilarity", "Similitud mínima (0.5 a 1)", 0.9),
      number("timeoutMs", "Tiempo de búsqueda (ms)", 10000),
      text("scales", "Escalas de búsqueda separadas por coma"),
      { key: "region", label: "Región opcional { x, y, width, height }", type: "text", required: false },
      button,
      number("count", "Número de clics", 1),
      delivery,
    ],
    { ...scopedDefaults, assetId: "", minSimilarity: 0.9, timeoutMs: 10000,
      scales: "0.5,0.67,0.75,1,1.25,1.5,2", button: "left", count: 1 },
  ),
  define(
    "mouse.click",
    "Clic por coordenadas",
    "Pulsa una posición de la captura de ventana o escritorio. Permite clic derecho, central y múltiple.",
    [
      ...scopedFields,
      ...xy,
      button,
      number("count", "Número de clics", 1),
      delivery,
    ],
    { ...scopedDefaults, x: 0, y: 0, button: "left", count: 1 },
  ),
  define(
    "mouse.drag",
    "Arrastrar",
    "Arrastra entre dos posiciones de la captura de ventana o escritorio.",
    [
      ...scopedFields,
      number("fromX", "X inicial"),
      number("fromY", "Y inicial"),
      number("toX", "X final"),
      number("toY", "Y final"),
      number("durationMs", "Duración (ms)", 500),
      button,
      delivery,
    ],
    {
      ...scopedDefaults,
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 100,
      durationMs: 500,
      button: "left",
    },
  ),
  define(
    "mouse.scroll",
    "Desplazar contenido",
    "Desplaza en una posición de la captura, por líneas o páginas.",
    [
      ...scopedFields,
      ...xy,
      select("direction", "Dirección", ["up", "down", "left", "right"], "down"),
      number("amount", "Cantidad", 3),
      select("by", "Unidad", ["line", "page"], "line"),
      delivery,
    ],
    { ...scopedDefaults, x: 0, y: 0, direction: "down", amount: 3, by: "line" },
  ),
  define(
    "clipboard.read",
    "Leer portapapeles",
    "Consulta tipos disponibles; incluye texto solo si includeText está habilitado.",
    [
      {
        key: "includeText",
        label: "Incluir texto",
        type: "boolean",
        defaultValue: false,
      },
    ],
    { includeText: false },
  ),
  define(
    "clipboard.write",
    "Escribir portapapeles",
    "Reemplaza el portapapeles con texto, una imagen o una ruta absoluta de archivo.",
    [
      select("format", "Formato", ["text", "image", "file"], "text"),
      text("value", "Texto o ruta absoluta"),
    ],
    { format: "text", value: "" },
  ),
  define(
    "window.assert",
    "Comprobar ventana",
    "Exige un valor o etiqueta accesible exactos y una captura como evidencia.",
    [...windowFields, text("expected", "Valor esperado"), ...elementFields],
    { ...windowTarget, expected: "" },
  ),
  define(
    "window.assertVisualText",
    "Comprobar texto visible",
    "Comprueba una coincidencia OCR exacta con Apple Vision local; requiere macOS y Swift.",
    [
      ...windowFields,
      text("expected", "Texto esperado"),
      number("minimumY", "Inicio vertical (0 a 1 desde abajo)"),
    ],
    { ...windowTarget, expected: "", minimumY: 0 },
  ),
  define(
    "window.verify",
    "Esperar y verificar estado",
    "Verifica con espera limitada la existencia de una ventana o elemento y su valor, estado habilitado o selección.",
    [
      ...windowFields,
      select(
        "predicate",
        "Qué comprobar",
        [
          "windowExists",
          "elementExists",
          "elementValue",
          "elementEnabled",
          "elementSelected",
        ],
        "elementExists",
      ),
      text("labelContains", "La etiqueta contiene", false),
      text("role", "Rol exacto", false),
      text("expectedValue", "Valor esperado", false),
      {
        key: "expectedState",
        label: "Estado esperado",
        type: "boolean",
        defaultValue: true,
        description: "Se usa para comprobar si un elemento está habilitado o seleccionado.",
      },
      number("timeoutMs", "Tiempo máximo (ms, 0: una lectura)", 5000),
      number("stableSamples", "Lecturas coincidentes", 2),
    ],
    {
      ...windowTarget,
      predicate: "elementExists",
      labelContains: "",
      role: "",
      expectedValue: "",
      expectedState: true,
      timeoutMs: 5000,
      stableSamples: 2,
    },
  ),
  define(
    "window.visualRegions",
    "Detectar texto e iconos en ventana",
    "Analiza una captura nueva con la extensión local opcional de percepción; devuelve regiones visuales para interfaces sin accesibilidad útil.",
    [
      ...windowFields,
      number("maxRegions", "Máximo de regiones", 50),
      number("minConfidence", "Confianza mínima (0 a 1)", 0.25),
    ],
    { ...windowTarget, maxRegions: 50, minConfidence: 0.25 },
  ),
];
