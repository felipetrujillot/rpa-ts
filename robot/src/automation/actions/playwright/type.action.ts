import type { AutomationAction } from "../../core/types";
import {
  readBooleanField,
  readNumberField,
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightTypeAction: AutomationAction = {
  id: "playwright.page.type",
  appId: "playwright",
  name: "Type",
  description: "Types text into an input element.",
  tags: ["browser", "page", "interaction"],
  inputFields: [
    {
      key: "selector",
      label: "Selector",
      type: "text",
      required: true,
    },
    {
      key: "text",
      label: "Text",
      type: "text",
      required: true,
    },
    {
      key: "tabId",
      label: "Tab ID",
      type: "text",
      required: false,
    },
    {
      key: "frameSelector",
      label: "Frame Selector",
      type: "text",
      required: false,
    },
    {
      key: "clearFirst",
      label: "Clear First",
      type: "boolean",
      required: false,
      defaultValue: true,
    },
    {
      key: "delayMs",
      label: "Delay (ms)",
      type: "number",
      required: false,
      defaultValue: 0,
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
    const text = readRequiredStringField(input, "text");
    if (!selector || text == null) {
      return {
        ok: false,
        message: "The 'selector' and 'text' inputs are required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const tabId = readStringField(input, "tabId", "").trim();
    const frameSelector = readStringField(input, "frameSelector", "").trim();
    const clearFirst = readBooleanField(input, "clearFirst", true);
    const delayMs = Math.max(0, readNumberField(input, "delayMs", 0));

    const output = await playwright.type({
      selector,
      text,
      tabId: tabId || undefined,
      frameSelector: frameSelector || undefined,
      clearFirst,
      delayMs,
    });

    return {
      ok: true,
      message: "Type executed successfully.",
      output,
    };
  },
};
