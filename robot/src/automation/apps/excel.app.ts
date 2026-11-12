import { excelActionDefinitions, excelPluginManifest, type ExcelActionId } from "@rpa/contracts";
import type { AutomationApp } from "../core/types";
import { ExcelSession } from "../plugins/excel/session";
import { inspectExcelAvailability } from "../plugins/excel/native-adapter";
export const excelApp: AutomationApp = {
  id: "excel", name: excelPluginManifest.name, description: "Automatización nativa de libros XLSX con Excel de escritorio.",
  plugin: excelPluginManifest,
  actions: excelActionDefinitions.map((definition) => ({
    ...definition, appId: "excel", tags: ["office", "excel"],
    availability: async () => { const entry = await inspectExcelAvailability(); return { available: entry.available, unavailableReason: entry.reason }; },
    run: async (input, context) => {
      try {
        context.appContexts ??= {};
        const session = context.appContexts.excel ??= new ExcelSession();
        if (!(session instanceof ExcelSession)) throw new Error("Sesión Excel inválida.");
        return { ok: true, message: "Acción Excel completada.", output: await session.execute(definition.id as ExcelActionId, input, context.signal) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), errorCode: (error as { code?: string }).code ?? "EXCEL_VALIDATION_ERROR" };
      }
    },
  })),
};
