import type { AutomationAction } from "../../core/types";
import {
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightEvaluateAction: AutomationAction = {
  id: "playwright.page.evaluate",
  appId: "playwright",
  name: "Evaluate",
  description: "Evaluates JavaScript in the page context.",
  tags: ["browser", "page", "script"],
  inputFields: [
    {
      key: "expression",
      label: "Expression",
      type: "text",
      required: true,
      defaultValue: "document.title",
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

    const expression = readRequiredStringField(input, "expression");
    if (!expression) {
      return {
        ok: false,
        message: "The 'expression' input is required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const tabId = readStringField(input, "tabId", "").trim();
    const output = await playwright.evaluate({
      expression,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "Evaluate executed successfully.",
      output,
    };
  },
};
