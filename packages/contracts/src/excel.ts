import { z } from "zod";
import { PLUGIN_SDK_VERSION, type AutomationPluginManifest, type PluginActionDefinition } from "./plugins";
import type { ActionInputField, AutomationValue } from "./automation";
import { workflowActionIds } from "./script-policy";
export const EXCEL_MAX_CELLS = 10000;
export const EXCEL_MAX_BYTES = 1_000_000;
export const excelCellSchema = z.union([z.string().max(32767), z.number().finite(), z.boolean(), z.null()]);
export type ExcelCell = z.infer<typeof excelCellSchema>;
export type ExcelCellType = "empty" | "string" | "number" | "boolean" | "error";
export type ExcelRangeResult = {
  values: ExcelCell[][];
  types: ExcelCellType[][];
  formulas: (string | null)[][];
  errors: (string | null)[][];
  dateSystem: "1900" | "1904";
  calculationPending: boolean;
};
export function parseExcelAddress(address: string) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(address);
  if (!match) throw new Error("Usa un rango A1 rectangular acotado, sin nombre de hoja.");
  const column = (s: string) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const firstColumn = column(match[1]!), firstRow = Number(match[2]);
  const lastColumn = column(match[3] ?? match[1]!), lastRow = Number(match[4] ?? match[2]);
  const rows = lastRow - firstRow + 1, columns = lastColumn - firstColumn + 1;
  if (rows < 1 || columns < 1 || lastColumn > 16384 || lastRow > 1048576 || rows * columns > EXCEL_MAX_CELLS)
    throw new Error(`Rango fuera de límites (máximo ${EXCEL_MAX_CELLS} celdas).`);
  return { firstColumn, firstRow, rows, columns };
}
const address = z.string().superRefine((value, ctx) => {
  try { parseExcelAddress(value); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); }
});
const matrix = z.array(z.array(excelCellSchema).min(1).max(EXCEL_MAX_CELLS)).min(1).max(EXCEL_MAX_CELLS);
const id = z.string().min(1).max(200);
const path = z.string().min(1).max(4096).refine((s) => !/[\x00-\x1f]/.test(s), "Ruta inválida");
const book = { workbookId: id };
const sheet = { ...book, worksheetId: id };
const range = { ...sheet, address };
const timeoutMs = z.number().int().min(100).max(120000).default(30000);
const schema = (shape: z.ZodRawShape) => z.strictObject({ ...shape, timeoutMs });
export const excelInputSchemas = {
  "excel.workbook.open": schema({ path, copy: z.boolean().default(true) }),
  "excel.worksheet.list": schema(book),
  "excel.worksheet.add": schema({ ...book, name: z.string().min(1).max(31).regex(/^[^\\/?*\[\]:]+$/).refine((s) => !s.startsWith("'") && !s.endsWith("'"), "Nombre inválido") }),
  "excel.range.read": schema(range),
  "excel.range.writeValues": schema({ ...range, values: matrix }),
  "excel.range.writeFormulas": schema({ ...range, formulas: z.array(z.array(z.string().min(2).max(8192).startsWith("=")).min(1).max(EXCEL_MAX_CELLS)).min(1).max(EXCEL_MAX_CELLS), syntax: z.literal("A1-invariant").default("A1-invariant") }),
  "excel.range.clear": schema(range),
  "excel.range.format": schema({ ...range, format: z.strictObject({ numberFormat: z.string().min(1).max(255).optional(), bold: z.boolean().optional(), fill: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), columnWidth: z.number().min(1).max(255).optional() }).refine((f) => Object.keys(f).length > 0, "Formato vacío") }),
  "excel.workbook.calculate": schema(book),
  "excel.workbook.saveAs": schema({ ...book, path, overwrite: z.boolean() }),
  "excel.worksheet.exportPdf": schema({ ...sheet, path, overwrite: z.boolean(), address, page: z.strictObject({ orientation: z.enum(["portrait", "landscape"]), fitToPagesWide: z.number().int().min(1).max(100), fitToPagesTall: z.number().int().min(1).max(100) }) }),
  "excel.workbook.close": schema({ ...book, saveChanges: z.boolean() }),
} as const;
export type ExcelActionId = keyof typeof excelInputSchemas;
export function assertSupportedExcelFormula(formula: string) {
  if (/[\[\]{}#@|;]/.test(formula) || /\b(WEBSERVICE|HYPERLINK|RTD|CALL|REGISTER|EXEC|RUN|EVALUATE|FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|RANDARRAY|STOCKHISTORY|IMAGE|INDIRECT|TAKE|DROP|VSTACK|HSTACK|TOCOL|TOROW|WRAPROWS|WRAPCOLS|CHOOSECOLS|CHOOSEROWS|EXPAND|TEXTSPLIT|MAP|REDUCE|SCAN|BYROW|BYCOL|MAKEARRAY|LAMBDA|GROUPBY|PIVOTBY|TRIMRANGE)\s*\(/i.test(formula))
    throw new Error("Fórmula externa, regional o dinámica no soportada.");
}
export function validateExcelInput(actionId: ExcelActionId, input: unknown): Record<string, unknown> {
  const result = excelInputSchemas[actionId].parse(input);
  if (new TextEncoder().encode(JSON.stringify(result)).length > EXCEL_MAX_BYTES) throw new Error("La entrada supera 1 MB.");
  if ("address" in result && ("values" in result || "formulas" in result)) {
    const dimensions = parseExcelAddress(result.address as string);
    const data = ("values" in result ? result.values : result.formulas) as unknown[][];
    if (data.length !== dimensions.rows || data.some((row) => row.length !== dimensions.columns))
      throw new Error("La matriz debe coincidir exactamente con las dimensiones del rango.");
  }
  if ("formulas" in result) {
    // External references, DDE, dynamic arrays and functions with external effects are outside the MVP.
    for (const row of result.formulas as string[][]) for (const formula of row) {
      assertSupportedExcelFormula(formula);
    }
  }
  return result;
}
const nullableText = z.string().nullable();
export const excelRangeResultSchema = z.strictObject({
  values: z.array(z.array(excelCellSchema)),
  types: z.array(z.array(z.enum(["empty", "string", "number", "boolean", "error"]))),
  formulas: z.array(z.array(nullableText)), errors: z.array(z.array(nullableText)),
  dateSystem: z.enum(["1900", "1904"]), calculationPending: z.boolean(),
});

export const excelOutputSchemas = {
  "excel.workbook.open": z.strictObject({ workbookId: z.string(), path: z.string(), sourcePath: z.string(), dateSystem: z.enum(["1900", "1904"]), excelVersion: z.string().optional() }),
  "excel.worksheet.list": z.strictObject({ worksheets: z.array(z.strictObject({ worksheetId: z.string(), name: z.string(), visibility: z.enum(["visible", "hidden", "very-hidden"]) })) }),
  "excel.worksheet.add": z.strictObject({ worksheetId: z.string(), name: z.string(), visibility: z.enum(["visible", "hidden", "very-hidden"]).optional() }),
  "excel.range.read": excelRangeResultSchema,
  "excel.range.writeValues": z.strictObject({ writtenCells: z.number().int().nonnegative() }),
  "excel.range.writeFormulas": z.strictObject({ writtenCells: z.number().int().nonnegative() }),
  "excel.range.clear": z.strictObject({ cleared: z.literal(true) }),
  "excel.range.format": z.strictObject({ formatted: z.literal(true) }),
  "excel.workbook.calculate": z.strictObject({ calculationPending: z.literal(false) }),
  "excel.workbook.saveAs": z.strictObject({ path: z.string(), workingPath: z.string() }),
  "excel.worksheet.exportPdf": z.strictObject({ path: z.string() }),
  "excel.workbook.close": z.strictObject({ closed: z.literal(true) }),
} as const;
const f = (key: string, label: string, type: ActionInputField["type"] = "text", required = true): ActionInputField => ({ key, label, type, required });
const commonBook = [f("workbookId", "ID del libro (o referencia)")];
const commonSheet = [...commonBook, f("worksheetId", "ID o nombre explícito de hoja")];
const commonRange = [...commonSheet, f("address", "Rango A1 (ejemplo A1:B2)")];
const bookDefaults = { workbookId: { $ref: "vars.workbookId" } };
const sheetDefaults = { ...bookDefaults, worksheetId: "Hoja1" };
const rangeDefaults = { ...sheetDefaults, address: "A1:B2" };
const action = (suffix: string, name: string, description: string, effect: "read" | "write", fields: ActionInputField[], defaults: Record<string, AutomationValue>, outputDescription: string): PluginActionDefinition => ({ id: `excel.${suffix}`, contractVersion: "1.0.0", name, description, effect, inputFields: fields, defaults, outputDescription });
const definitions: PluginActionDefinition[] = [
  action("workbook.open", "Abrir libro Excel", "Abre XLSX local sobre una copia de trabajo por defecto. Rechaza vínculos y conexiones externas.", "write", [f("path", "Plantilla XLSX (ruta absoluta)"), f("copy", "Abrir copia", "boolean")], { path: "", copy: true }, "{ workbookId, path, sourcePath, dateSystem }"),
  action("worksheet.list", "Listar hojas", "Lista IDs, nombres y visibilidad de las hojas del libro propio.", "read", commonBook, bookDefaults, "{ worksheets: [{ worksheetId, name, visibility }] }"),
  action("worksheet.add", "Crear hoja", "Crea una hoja; rechaza nombres duplicados.", "write", [...commonBook, f("name", "Nombre de la hoja")], { ...bookDefaults, name: "Resultados" }, "{ worksheetId, name }"),
  action("range.read", "Leer rango", "Lee valores, tipos, fórmulas y errores. Fechas como serial y sistema 1900/1904; indica cálculo pendiente.", "read", commonRange, rangeDefaults, "{ values, types, formulas, errors, dateSystem, calculationPending }. Ejemplo: last.values.0.0"),
  action("range.writeValues", "Escribir valores", "Escribe una matriz literal exacta. null vacía una celda; conserva texto parecido a fórmula.", "write", [...commonRange, f("values", "Matriz JSON o referencia")], { ...rangeDefaults, values: [["001", 2], [null, true]] }, "{ writtenCells }"),
  action("range.writeFormulas", "Escribir fórmulas", "Fórmulas A1 invariantes: =SUM(A1:A2), nombres en inglés y comas. Sin matrices dinámicas ni referencias externas.", "write", [...commonRange, f("formulas", "Matriz JSON de fórmulas"), f("syntax", "Sintaxis")], { ...sheetDefaults, address: "C1", formulas: [["=SUM(A1:B1)"]], syntax: "A1-invariant" }, "{ writtenCells }"),
  action("range.clear", "Vaciar rango", "Borra contenido conservando formato. Rechaza celdas combinadas y hojas protegidas.", "write", commonRange, rangeDefaults, "{ cleared: true }"),
  action("range.format", "Dar formato al rango", "Formato numérico invariante, negrita, relleno #RRGGBB y ancho de columna (afecta columnas completas).", "write", [...commonRange, f("format", "Opciones de formato JSON")], { ...rangeDefaults, format: { numberFormat: "0.00", bold: true } }, "{ formatted: true }"),
  action("workbook.calculate", "Recalcular libro", "Recalcula y espera. El adaptador exige un único libro abierto en su instancia para aislar el cálculo global.", "write", commonBook, bookDefaults, "{ calculationPending: false }"),
  action("workbook.saveAs", "Guardar libro XLSX", "Guarda en una ruta absoluta con sobrescritura explícita.", "write", [...commonBook, f("path", "Destino XLSX"), f("overwrite", "Sobrescribir", "boolean")], { ...bookDefaults, path: "", overwrite: false }, "{ path }"),
  action("worksheet.exportPdf", "Exportar hoja a PDF", "Exporta una hoja visible con área y configuración de página explícitas.", "write", [...commonRange, f("path", "Destino PDF"), f("overwrite", "Sobrescribir", "boolean"), f("page", "Página JSON")], { ...rangeDefaults, path: "", overwrite: false, page: { orientation: "portrait", fitToPagesWide: 1, fitToPagesTall: 1 } }, "{ path }"),
  action("workbook.close", "Cerrar libro", "Cierra únicamente el libro propio, con política explícita de guardado.", "write", [...commonBook, f("saveChanges", "Guardar cambios", "boolean")], { ...bookDefaults, saveChanges: false }, "{ closed: true }"),
];
export const excelActionDefinitions: PluginActionDefinition[] = definitions.map((definition) => ({
  ...definition,
  inputSchema: z.toJSONSchema(excelInputSchemas[definition.id as ExcelActionId], { unrepresentable: "any" }),
  outputSchema: z.toJSONSchema(excelOutputSchemas[definition.id as ExcelActionId], { unrepresentable: "any" }),
}));
export const excelPluginManifest: AutomationPluginManifest = {
  id: "excel", name: "Microsoft Excel", packageVersion: "0.1.0", sdkVersion: PLUGIN_SDK_VERSION,
  platforms: ["darwin", "win32"], capabilities: ["xlsx", "literal-values", "a1-invariant", "bounded-ranges", "single-workbook-calculation", "worksheet-pdf"], actions: excelActionDefinitions,
};
export function excelPluginRequirement(actionIds: string[]) {
  return { pluginId: "excel", packageVersion: excelPluginManifest.packageVersion, sdkVersion: excelPluginManifest.sdkVersion, actions: Object.fromEntries(excelActionDefinitions.filter((a) => actionIds.includes(a.id)).map((a) => [a.id, a.contractVersion])) };
}
export function excelAgentGuide() {
  return ["## Microsoft Excel", "Excel de escritorio requerido. Las rutas y archivos son locales al robot. Captura workbookId en vars.workbookId. Usa una hoja explícita; las matrices admiten JSON o referencias. Activa sensitiveOutput para datos privados.", ...excelActionDefinitions.map((a) => `- ${a.id} (v${a.contractVersion}): ${a.description} Entradas: ${a.inputFields.map((f) => f.key).join(", ")}. Salida: ${a.outputDescription}`)].join("\n");
}

/** Pin requirements without silently upgrading requirements already present in imported/published flows. */
export function pinExcelRequirements<T extends import("./workflow").FlowDocument>(document: T): T {
  const ids = workflowActionIds(document).filter(id => id.startsWith("excel."));
  if (!ids.length) return document;
  const existing = document.pluginRequirements ?? [];
  const previous = existing.find((r) => r.pluginId === "excel");
  const current = excelPluginRequirement(ids);
  return { ...document, pluginRequirements: previous
    ? existing.map((r) => r.pluginId === "excel" ? { ...r, actions: { ...current.actions, ...r.actions } } : r)
    : [...existing, current] };

}
export function validateExcelTemplate(action: ExcelActionId, input: Record<string, unknown>) {
  const containsReference = (v: unknown): boolean => typeof v === "string" ? /\{\{/.test(v) : !!v && typeof v === "object" && ("$ref" in v || Object.values(v).some(containsReference));
  // Resolve references on the robot; literal dimensions can already be checked in Canvas.
  const fields = excelInputSchemas[action].shape;
  for (const [key, value] of Object.entries(input)) {
    if (!(key in fields)) throw new Error(`Campo Excel desconocido: ${key}`);
    if (!containsReference(value)) (fields as Record<string, z.ZodType>)[key]!.parse(value);
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in input) && !field.safeParse(undefined).success) throw new Error(`Campo Excel obligatorio: ${key}`);
  }
  if (!containsReference(input)) validateExcelInput(action, input);
  else if (!containsReference(input.address) && typeof input.address === "string") {
    const d = parseExcelAddress(input.address);
    const m = input.values ?? input.formulas;
    if (Array.isArray(m) && !containsReference(m) && (m.length !== d.rows || m.some((row) => !Array.isArray(row) || row.length !== d.columns))) throw new Error("La matriz debe coincidir exactamente con las dimensiones del rango.");
  }
}
