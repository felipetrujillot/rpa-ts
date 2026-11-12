import type { AutomationAction } from "../../core/types";
import { readNumberField, readStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightPopupAction: AutomationAction = {
  id: "playwright.page.popup",
  appId: "playwright",
  name: "Popup",
  description: "Waits for or handles a popup window.",
  tags: ["browser", "page", "popup"],
  inputFields: [
    {
      key: "triggerSelector",
      label: "Trigger Selector",
      type: "text",
      required: false,
    },
    {
      key: "urlContains",
      label: "URL Contains",
      type: "text",
      required: false,
    },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      required: false,
      defaultValue: 15000,
    },
    { key: "tabId", label: "Tab ID", type: "text", required: false },
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
    const urlContains = readStringField(input, "urlContains", "").trim();
    const timeoutMs = Math.max(1, readNumberField(input, "timeoutMs", 15000));
    const tabId = readStringField(input, "tabId", "").trim();

    const output = await playwright.popup({
      triggerSelector: triggerSelector || undefined,
      urlContains: urlContains || undefined,
      timeoutMs,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "Popup action executed successfully.",
      output,
    };
  },
};
