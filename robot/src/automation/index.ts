import { WordSession } from "./plugins/word/session";
import { ExcelSession } from "./plugins/excel/session";
import { defaultAutomationApps } from "./apps";
import { getSharedPlaywrightRuntime } from "./apps/playwright.runtime";
import { AutomationRegistry } from "./core/registry";
import type { AutomationContext } from "./core/types";
export * from "./flow";

export * from "./core/types";
export { AutomationRegistry } from "./core/registry";

import type { CuaDriver } from "./drivers/cua-driver";
import type { ImageAssets } from "./vision/types";
type CreateAutomationContextOptions = {
  cua?: CuaDriver;
  imageAssets?: ImageAssets;
  authorizeScriptAction?: AutomationContext["authorizeScriptAction"];
};

export const createAutomationRegistry = (): AutomationRegistry => {
  const registry = new AutomationRegistry();
  registry.registerApps(defaultAutomationApps);

  return registry;
};

export const createAutomationContext = (
  options?: CreateAutomationContextOptions,
): AutomationContext => ({
  pendingActions: new Set(),
  authorizeScriptAction: options?.authorizeScriptAction,
  appContexts: {
    cua: options?.cua,
    imageAssets: options?.imageAssets,
    puppeteer: {
      connected: false,
      navigate: async (_url: string) => {
        throw new Error("Puppeteer integration not configured yet.");
      },
    },
    playwright: getSharedPlaywrightRuntime().getAppContext(),
  },
});

export const disposeAutomationContext = async (context: AutomationContext) => {
  // Cooperative cancellation may finish after the script's worker is gone.
  // Do not dispose Office sessions while a nested native action still owns them.
  await Promise.allSettled([...(context.pendingActions ?? [])]);
  const word = context.appContexts?.word;
  if (word instanceof WordSession) {
    await word.dispose();
    if (word.cleanupFailures.length) console.warn("WORD_CLEANUP_INCOMPLETE", word.cleanupFailures);
  }
  const excel = context.appContexts?.excel;
  if (excel instanceof ExcelSession) await excel.dispose();
};
