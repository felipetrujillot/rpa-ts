import type { AutomationAction } from "../../core/types";
import { readNumberField, readStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightDownloadAction: AutomationAction = {
  id: "playwright.page.download",
  appId: "playwright",
  name: "Download",
  description: "Triggers and tracks a file download.",
  tags: ["browser", "page", "file"],
  inputFields: [
    {
      key: "triggerSelector",
      label: "Trigger Selector",
      type: "text",
      required: false,
    },
    {
      key: "url",
      label: "URL",
      type: "text",
      required: false,
      description: "Optional direct URL download.",
    },
    {
      key: "saveAs",
      label: "Save As",
      type: "text",
      required: false,
    },
    { key: "tabId", label: "Tab ID", type: "text", required: false },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      required: false,
      defaultValue: 30000,
    },
  ],
  availability: getPlaywrightAvailability,
  run: async (input, context) => {
    const playwright = getPlaywrightContext(context);
    if (!playwright?.connected) {
      return {
        ok: false,
        message: "Playwright app is not connected yet.",
        errorCode: "APP_NOT_CONNECTED",
      };
    }

    const triggerSelector = readStringField(
      input,
      "triggerSelector",
      "",
    ).trim();
    const url = readStringField(input, "url", "").trim();
    if (!triggerSelector && !url) {
      return {
        ok: false,
        message: "Provide 'triggerSelector' or 'url'.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const saveAs = readStringField(input, "saveAs", "").trim();
    const tabId = readStringField(input, "tabId", "").trim();
    const timeoutMs = Math.max(1, readNumberField(input, "timeoutMs", 30000));
    const output = await playwright.download({
      triggerSelector: triggerSelector || undefined,
      url: url || undefined,
      saveAs: saveAs || undefined,
      tabId: tabId || undefined,
      timeoutMs,
    });

    return {
      ok: true,
      message: "Download executed successfully.",
      output,
    };
  },
};
