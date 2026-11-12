import type { AutomationAction } from "../../core/types";
import {
  readNumberField,
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseFrameAction = (
  value: string,
): "click" | "type" | "waitForElement" | null => {
  if (value === "click" || value === "type" || value === "waitForElement") {
    return value;
  }

  return null;
};

export const playwrightIframeAction: AutomationAction = {
  id: "playwright.page.iframe",
  appId: "playwright",
  name: "Iframe",
  description: "Runs a basic action inside an iframe.",
  tags: ["browser", "page", "iframe"],
  inputFields: [
    {
      key: "frameSelector",
      label: "Frame Selector",
      type: "text",
      required: true,
    },
    {
      key: "action",
      label: "Action",
      type: "select",
      required: true,
      defaultValue: "click",
      options: [
        { label: "Click", value: "click" },
        { label: "Type", value: "type" },
        { label: "Wait For Element", value: "waitForElement" },
      ],
    },
    { key: "selector", label: "Selector", type: "text", required: true },
    { key: "text", label: "Text", type: "text", required: false },
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

    const frameSelector = readRequiredStringField(input, "frameSelector");
    const actionValue = parseFrameAction(readStringField(input, "action", ""));
    const selector = readRequiredStringField(input, "selector");
    if (!frameSelector || !actionValue || !selector) {
      return {
        ok: false,
        message:
          "The 'frameSelector', 'action' and 'selector' inputs are required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const text = readStringField(input, "text", "");
    const timeoutMs = Math.max(1, readNumberField(input, "timeoutMs", 15000));
    const tabId = readStringField(input, "tabId", "").trim();

    const output = await playwright.iframe({
      frameSelector,
      action: actionValue,
      selector,
      text: text || undefined,
      timeoutMs,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "Iframe action executed successfully.",
      output,
    };
  },
};
