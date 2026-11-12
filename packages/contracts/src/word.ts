import { z } from "zod";
import { PLUGIN_SDK_VERSION, type AutomationPluginManifest, type PluginActionDefinition } from "./plugins";
import type { ActionInputField, AutomationValue } from "./automation";
import type { FlowDocument } from "./workflow";
import { workflowActionIds } from "./script-policy";

const path = z.string().min(1).max(4096).refine((s) => !/[\x00-\x1f]/.test(s), "Ruta inválida");
const text = z.string().max(500_000).refine((s) => !s.includes("\0"), "Texto inválido");
const doc = { documentId: z.string().uuid() };
const key = z.string().min(1).max(200).refine((k) => !["__proto__", "prototype", "constructor"].includes(k));
const templateValue: z.ZodType<AutomationValue> = z.lazy(() => z.union([text, z.number().finite(), z.boolean(), z.null(), z.array(templateValue).max(100), z.record(key, templateValue)]));
const schema = (shape: z.ZodRawShape) => z.strictObject({ ...shape, timeoutMs: z.number().int().min(100).max(120000).default(60000) });
export const wordInputSchemas = {
  "word.document.open": schema({ path, copy: z.boolean().default(true) }),
  "word.document.readText": schema(doc),
  "word.document.replaceText": schema({ ...doc, find: text.min(1), replacement: text, missing: z.enum(["error", "ignore"]).default("error"), matches: z.enum(["all", "first"]).default("all") }),
  "word.document.appendText": schema({ ...doc, text }),
  "word.document.fillTemplate": schema({ ...doc, data: z.record(key, templateValue).refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 100, "Se requieren entre 1 y 100 campos"), missing: z.enum(["error", "ignore"]).default("error") }),
  "word.document.saveAs": schema({ ...doc, path, overwrite: z.boolean().default(false) }),
  "word.document.exportPdf": schema({ ...doc, path, overwrite: z.boolean().default(false) }),
  "word.document.close": schema({ ...doc, changes: z.enum(["discard", "save", "rejectIfDirty"]) }),
} as const;
export type WordActionId = keyof typeof wordInputSchemas;
const outputDoc = { documentId: z.string().uuid() };
const counts = z.array(z.strictObject({ marker: z.string(), count: z.number().int().nonnegative() }));
export const wordOutputSchemas = {
  "word.document.open": z.strictObject({ ...outputDoc, path: z.string(), sourcePath: z.string(), wordVersion: z.string().optional() }),
  "word.document.readText": z.strictObject({ ...outputDoc, text: z.string().max(500_000) }),
  "word.document.replaceText": z.strictObject({ ...outputDoc, replacements: z.number().int().nonnegative(), counts }),
  "word.document.fillTemplate": z.strictObject({ ...outputDoc, replacements: z.number().int().nonnegative(), counts }),
  "word.document.appendText": z.strictObject({ ...outputDoc, appendedCharacters: z.number().int().nonnegative() }),
  "word.document.saveAs": z.strictObject({ ...outputDoc, path: z.string(), bytes: z.number().int().positive() }),
  "word.document.exportPdf": z.strictObject({ ...outputDoc, path: z.string(), bytes: z.number().int().positive() }),
  "word.document.close": z.strictObject({ ...outputDoc, closed: z.literal(true) }),
} as const;
export function validateWordInput(action: WordActionId, raw: unknown): Record<string, unknown> {
  const pending = [{ value: raw, depth: 0 }]; let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 20 || ++count > 10000) throw new Error("Entrada Word demasiado compleja.");
    if (value && typeof value === "object") for (const nested of Object.values(value)) pending.push({ value: nested, depth: depth + 1 });
  }
  const input = wordInputSchemas[action].parse(raw);
  if (new TextEncoder().encode(JSON.stringify(input)).length > 1_000_000) throw new Error("La entrada Word supera 1 MB.");
  return input;
}
export function validateWordTemplate(action: WordActionId, input: Record<string, unknown>) {
  const reference = (v: unknown): boolean => typeof v === "string" ? /\{\{/.test(v) : !!v && typeof v === "object" && ("$ref" in v || Object.values(v).some(reference));
  const fields = wordInputSchemas[action].shape as Record<string, z.ZodType>;
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Campo Word desconocido: ${key}`);
    if (!reference(value) || (key === "find" && typeof value === "string")) fields[key]!.parse(value);
  }
  for (const [key, field] of Object.entries(fields)) if (!(key in input) && !field.safeParse(undefined).success) throw new Error(`Campo Word obligatorio: ${key}`);
}
const f = (key: string, label: string, type: ActionInputField["type"] = "text"): ActionInputField => ({ key, label, type: ["missing", "matches", "changes"].includes(key) ? "select" : type, required: true,
  ...(["missing", "matches", "changes"].includes(key) ? { options: (key === "missing" ? ["error", "ignore"] : key === "matches" ? ["all", "first"] : ["discard", "save", "rejectIfDirty"]).map((value) => ({ value, label: value })) } : {}) });
const documentFields = [f("documentId", "Documento (ID o referencia)")];
const defaults = { documentId: { $ref: "last.documentId" } };
const action = (id: WordActionId, name: string, description: string, fields: ActionInputField[], values: Record<string, AutomationValue>, outputDescription: string) => ({
  id, name, description, contractVersion: "1.0.0", effect: id.endsWith("readText") ? "read" as const : "write" as const,
  inputFields: fields, defaults: values, outputDescription,
  inputSchema: z.toJSONSchema(wordInputSchemas[id]),
  outputSchema: z.toJSONSchema(wordOutputSchemas[id]),
});
export const wordActionDefinitions = [
  action("word.document.open", "Abrir documento Word", "DOCX local. Copia de trabajo por defecto; nunca usa el documento activo. En macOS, copy=false solo admite originales dentro del espacio de trabajo privado de Word.", [f("path", "Plantilla DOCX (ruta absoluta del robot)"), f("copy", "Abrir copia", "boolean")], { path: "", copy: true }, "{ documentId, path, sourcePath }"),
  action("word.document.readText", "Leer texto Word", "Cuerpo principal, sin encabezados, pies ni cuadros de texto. Saltos normalizados a LF.", documentFields, defaults, "{ documentId, text }"),
  action("word.document.replaceText", "Reemplazar texto Word", "Búsqueda literal y sensible a mayúsculas. find es literal; admite una referencia explícita. Conserva formato fuera del texto reemplazado.", [...documentFields, f("find", "Buscar (literal)"), f("replacement", "Reemplazo"), f("missing", "Si no existe: error / ignore"), f("matches", "Coincidencias: all / first")], { ...defaults, find: "{{cliente}}", replacement: "", missing: "error", matches: "all" }, "{ documentId, replacements }"),
  action("word.document.appendText", "Añadir texto Word", "Añade texto literal al final del cuerpo, antes del terminador de párrafo.", [...documentFields, f("text", "Texto")], { ...defaults, text: "" }, "{ documentId, appendedCharacters }"),
  action("word.document.fillTemplate", "Completar plantilla Word", "data: cliente sustituye {{cliente}}. Datos anidados usan {{cliente.nombre}} y listas {{items.0}}. Todas las coincidencias; null produce texto vacío. Valida antes de escribir.", [...documentFields, f("data", "Datos de la plantilla o referencia"), f("missing", "Si falta un marcador: error / ignore")], { ...defaults, data: { cliente: "María" }, missing: "error" }, "{ documentId, replacements, counts }"),
  action("word.document.saveAs", "Guardar DOCX", "Ruta explícita del robot. Protege siempre las plantillas de origen; sobrescritura de otros archivos solo si overwrite es true.", [...documentFields, f("path", "Destino DOCX"), f("overwrite", "Sobrescribir", "boolean")], { ...defaults, path: "", overwrite: false }, "{ documentId, path, bytes }"),
  action("word.document.exportPdf", "Exportar PDF", "PDF local del robot, sin transferencia al servidor.", [...documentFields, f("path", "Destino PDF"), f("overwrite", "Sobrescribir", "boolean")], { ...defaults, path: "", overwrite: false }, "{ documentId, path, bytes }"),
  action("word.document.close", "Cerrar documento Word", "changes: discard, save o rejectIfDirty. Nunca termina Word ni cierra documentos ajenos.", [...documentFields, f("changes", "Cambios pendientes")], { ...defaults, changes: "rejectIfDirty" }, "{ documentId, closed }"),
] satisfies PluginActionDefinition[];
export const wordPluginManifest: AutomationPluginManifest = {
  id: "word", name: "Microsoft Word", description: "Plantillas DOCX, texto literal y exportación PDF con Word de escritorio.", packageVersion: "0.1.0", sdkVersion: PLUGIN_SDK_VERSION,
  platforms: ["darwin", "win32"], capabilities: ["docx", "main-story", "literal-text", "template-json", "nested-template-data", "pdf"], actions: wordActionDefinitions,
};
export function pinWordRequirements(document: FlowDocument): FlowDocument {
  const ids = workflowActionIds(document).filter(id => id.startsWith("word."));
  if (!ids.length) return document;
  const requirement = { pluginId: "word", packageVersion: wordPluginManifest.packageVersion, sdkVersion: wordPluginManifest.sdkVersion, actions: Object.fromEntries(wordActionDefinitions.filter((a) => ids.includes(a.id)).map((a) => [a.id, a.contractVersion])) };
  const existing = document.pluginRequirements ?? [];
  const previous = existing.find((r) => r.pluginId === "word");
  return { ...document, pluginRequirements: previous ? existing.map((r) => r.pluginId === "word" ? { ...r, actions: { ...requirement.actions, ...r.actions } } : r) : [...existing, requirement] };
}
export const wordAgentGuide = () => ["## Microsoft Word", "Word de escritorio y sesión iniciada. Rutas locales al robot. Conserva documentId usando una referencia a nodeOutputs.<ID>.documentId. Declara marcadores en data; find es literal. Usa sensitiveOutput para contenido privado.", ...wordActionDefinitions.map((a) => `- ${a.id} (v${a.contractVersion}): ${a.description} Entradas: ${a.inputFields.map((f) => f.key).join(", ")}. Salida: ${a.outputDescription}`)].join("\n");
