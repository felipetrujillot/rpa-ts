import { z } from "zod";
import type { ActionInputField, AutomationValue } from "./automation";

export const PLUGIN_SDK_VERSION = "1.0.0";
export type PluginActionDefinition = {
  id: string;
  name: string;
  description: string;
  contractVersion: string;
  effect: "read" | "write";
  inputFields: ActionInputField[];
  defaults: Record<string, AutomationValue>;
  outputDescription: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};
export type AutomationPluginManifest = {
  id: string;
  name: string;
  description?: string;
  packageVersion: string;
  sdkVersion: string;
  platforms: ("darwin" | "win32")[];
  capabilities: string[];
  actions: PluginActionDefinition[];
};

export function validatePluginManifest(manifest: AutomationPluginManifest) {
  const semver = /^\d+\.\d+\.\d+$/;
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id) || !manifest.name || !semver.test(manifest.packageVersion) || manifest.sdkVersion !== PLUGIN_SDK_VERSION)
    throw new Error("ID o versión del plugin inválidos.");
  if (!manifest.platforms.length || manifest.platforms.some((p) => !["darwin", "win32"].includes(p))) throw new Error("Plataformas inválidas.");
  const ids = new Set<string>();
  const inspectSchema = (schema: unknown, depth = 0): void => {
    if (depth > 30 || !schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Esquema de acción inválido.");
    const s = schema as Record<string, unknown>;
    const types = ["object", "array", "string", "number", "integer", "boolean", "null"];
    if (s.type !== undefined && (Array.isArray(s.type) ? s.type.some((t) => !types.includes(String(t))) : !types.includes(String(s.type)))) throw new Error("Tipo de esquema inválido.");
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((k) => typeof k !== "string"))) throw new Error("required inválido.");
    if (s.properties !== undefined) {
      if (!s.properties || typeof s.properties !== "object" || Array.isArray(s.properties)) throw new Error("properties inválido.");
      for (const child of Object.values(s.properties)) inspectSchema(child, depth + 1);
    }
    if (s.items !== undefined) inspectSchema(s.items, depth + 1);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (s[key] !== undefined) {
      if (!Array.isArray(s[key]) || !s[key].length) throw new Error("Composición de esquema inválida.");
      for (const child of s[key]) inspectSchema(child, depth + 1);
    }
  };
  for (const action of manifest.actions) {
    if (!action.id.startsWith(`${manifest.id}.`) || ids.has(action.id) || !semver.test(action.contractVersion) || !["read", "write"].includes(action.effect)) throw new Error("Acción de plugin inválida o duplicada.");
    ids.add(action.id);
    for (const schema of [action.inputSchema, action.outputSchema]) if (schema !== undefined) {
      inspectSchema(schema); if (schema.type !== "object") throw new Error("Se requiere un esquema de objeto.");
    }
    if (!Array.isArray(action.inputFields) || new Set(action.inputFields.map((f) => f.key)).size !== action.inputFields.length) throw new Error("Formulario de plugin inválido.");
  }
  JSON.stringify(manifest); // Reject circular metadata before the registry is modified.
}
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const pluginRequirementSchema = z.strictObject({
  pluginId: z.string().min(1).max(80),
  packageVersion: version,
  sdkVersion: version,
  actions: z.record(z.string().min(1).max(160), version),
});
export type PluginRequirement = z.infer<typeof pluginRequirementSchema>;
export const pluginInventorySchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  plugins: z.array(pluginRequirementSchema.extend({
    available: z.boolean(),
    reason: z.string().max(500).optional(),
    platform: z.string().max(40),
    capabilities: z.array(z.string().max(100)).max(100),
    permissions: z.array(z.string().max(100)).max(20),
    verified: z.boolean(),
    state: z.enum(["installed", "compatible", "permissions-pending", "unavailable"]).optional(),
    appVersion: z.string().max(100).optional(),
  })).max(50),
});
export type PluginInventory = z.infer<typeof pluginInventorySchema>;
export function pluginCompatibility(requirements: PluginRequirement[], inventory?: PluginInventory | null, now = Date.now()): string[] {
  if (!requirements.length) return [];
  if (!inventory || now - Date.parse(inventory.sampledAt) > 30_000 || Date.parse(inventory.sampledAt) > now + 5000)
    return ["Inventario de plugins desconocido o desactualizado."];
  return requirements.flatMap((requirement) => {
    const plugin = inventory.plugins.find((entry) => entry.pluginId === requirement.pluginId);
    if (!plugin?.available) return [`${requirement.pluginId}: ${plugin?.reason ?? "no disponible"}`];
    if (plugin.sdkVersion !== requirement.sdkVersion || plugin.packageVersion !== requirement.packageVersion ||
      Object.entries(requirement.actions).some(([id, version]) => plugin.actions[id] !== version))
      return [`${requirement.pluginId}: versiones incompatibles.`];
    return [];
  });
}
export const hasUncertainEffect = (error?: { code?: string; message?: string } | null) =>
  error?.code === "ACTION_EFFECT_UNCERTAIN" || error?.message?.includes("CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE") === true;
