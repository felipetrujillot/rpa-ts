import { excelPluginManifest, pinExcelRequirements } from "./excel";
import { wordPluginManifest, pinWordRequirements } from "./word";
import type { FlowDocument } from "./workflow";
export const builtinPluginManifests = [excelPluginManifest, wordPluginManifest];
export const builtinPluginActions = builtinPluginManifests.flatMap((p) => p.actions);
export const pinBuiltinPluginRequirements = (document: FlowDocument) => pinWordRequirements(pinExcelRequirements(document));
export function validateBuiltinPluginRequirements(document: FlowDocument): string[] {
  return (document.pluginRequirements ?? []).flatMap((r) => {
    const manifest = builtinPluginManifests.find((m) => m.id === r.pluginId);
    return !manifest || manifest.packageVersion !== r.packageVersion || manifest.sdkVersion !== r.sdkVersion ||
      Object.entries(r.actions).some(([id, version]) => !manifest.actions.some((a) => a.id === id && a.contractVersion === version))
      ? [`Versiones de plugin incompatibles: ${r.pluginId}`] : [];
  });
}
