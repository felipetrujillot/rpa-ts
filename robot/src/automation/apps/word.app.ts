import { wordActionDefinitions, wordPluginManifest, type WordActionId } from "@rpa/contracts";
import type { AutomationApp } from "../core/types";
import { WordSession } from "../plugins/word/session";
import { inspectWordAvailability } from "../plugins/word/native-adapter";
export const wordApp: AutomationApp = {
  id: "word", name: wordPluginManifest.name, description: "Documentos DOCX y PDF con Microsoft Word de escritorio.", plugin: wordPluginManifest,
  actions: wordActionDefinitions.map((definition) => ({
    ...definition, appId: "word", tags: ["office", "word", "documentos"],
    availability: async () => { const entry = await inspectWordAvailability(); return { available: entry.available, unavailableReason: entry.reason }; },
    run: async (input, context) => {
      try {
        context.appContexts ??= {};
        const session = context.appContexts.word ??= new WordSession();
        if (!(session instanceof WordSession)) throw new Error("Sesión Word inválida.");
        return { ok: true, message: "Acción Word completada.", output: await session.execute(definition.id as WordActionId, input, context.signal) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), errorCode: (error as { code?: string }).code ?? "WORD_VALIDATION_ERROR" };
      }
    },
  })),
};
