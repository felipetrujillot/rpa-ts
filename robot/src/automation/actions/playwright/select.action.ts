import type { AutomationAction } from "../../core/types";
import {
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightSelectAction: AutomationAction = {
  id: "playwright.page.select",
  appId: "playwright",
  name: "Select",
  description: "Selects a value from a select element.",
  tags: ["browser", "page", "form"],
  inputFields: [
    { key: "selector", label: "Selector", type: "text", required: true },
    { key: "value", label: "Value", type: "text", required: true },
    { key: "tabId", label: "Tab ID", type: "text", required: false },
    {
      key: "frameSelector",
      label: "Frame Selector",
      type: "text",
      required: false,
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

    const selector = readRequiredStringField(input, "selector");
    const value = readRequiredStringField(input, "value");

    if (!selector || !value) {
      return {
        ok: false,
        message: "The 'selector' and 'value' inputs are required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const tabId = readStringField(input, "tabId", "").trim();
    const frameSelector = readStringField(input, "frameSelector", "").trim();
    const output = await playwright.select({
      selector,
      value,
      tabId: tabId || undefined,
      frameSelector: frameSelector || undefined,
    });

    return {
      ok: true,
      message: "Select executed successfully.",
      output,
    };
  },
};
