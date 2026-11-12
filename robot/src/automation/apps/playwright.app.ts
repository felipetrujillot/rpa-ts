import {
  playwrightClickAction,
  playwrightCloseTabAction,
  playwrightCookiesAction,
  playwrightDownloadAction,
  playwrightEvaluateAction,
  playwrightIframeAction,
  playwrightLocalStorageAction,
  playwrightNetworkAction,
  playwrightOpenTabAction,
  playwrightPopupAction,
  playwrightScreenshotAction,
  playwrightSelectAction,
  playwrightSwitchTabAction,
  playwrightTypeAction,
  playwrightUploadAction,
  playwrightWaitForElementAction,
} from "../actions";
import type { AutomationApp } from "../core/types";
import { browserActionFields, type browserInputSchemas } from "@rpa/contracts";

export const playwrightApp: AutomationApp = {
  id: "playwright",
  name: "Playwright",
  description:
    "Browser automation action schema for Playwright-driven sessions.",
  actions: [
    playwrightOpenTabAction,
    playwrightCloseTabAction,
    playwrightSwitchTabAction,
    playwrightClickAction,
    playwrightTypeAction,
    playwrightSelectAction,
    playwrightUploadAction,
    playwrightDownloadAction,
    playwrightScreenshotAction,
    playwrightEvaluateAction,
    playwrightIframeAction,
    playwrightPopupAction,
    playwrightCookiesAction,
    playwrightLocalStorageAction,
    playwrightWaitForElementAction,
    playwrightNetworkAction,
  ].map((action) => ({
    ...action,
    inputFields: browserActionFields(
      action.id as keyof typeof browserInputSchemas,
    ).map((field) => {
      const previous = action.inputFields?.find(
        (item) => item.key === field.key,
      );
      return {
        ...field,
        label: previous?.label ?? field.label,
        ...(previous?.defaultValue !== undefined
          ? { defaultValue: previous.defaultValue }
          : {}),
      };
    }),
  })),
};
