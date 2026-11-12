import type { AutomationAction } from "../../core/types";
import { readRequiredStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightSwitchTabAction: AutomationAction = {
  id: "playwright.browser.switchTab",
  appId: "playwright",
  name: "Switch tab",
  description: "Switches focus to another tab.",
  tags: ["browser", "tab"],
  inputFields: [
    {
      key: "tabId",
      label: "Tab ID",
      type: "text",
      required: true,
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

    const tabId = readRequiredStringField(input, "tabId");
    if (!tabId) {
      return {
        ok: false,
        message: "The 'tabId' input is required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const output = await playwright.switchTab({ tabId });

    return {
      ok: true,
      message: "Switch tab executed successfully.",
      output,
    };
  },
};
