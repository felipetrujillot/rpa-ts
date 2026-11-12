import type { AutomationAction } from "../../core/types";
import {
  readNumberField,
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseWaitState = (
  value: string,
): "attached" | "visible" | "hidden" | "detached" => {
  if (
    value === "attached" ||
    value === "visible" ||
    value === "hidden" ||
    value === "detached"
  ) {
    return value;
  }

  return "visible";
};

export const playwrightWaitForElementAction: AutomationAction = {
  id: "playwright.page.waitForElement",
  appId: "playwright",
  name: "Wait For Element",
  description: "Waits until an element reaches a target state.",
  tags: ["browser", "page", "wait"],
  inputFields: [
    { key: "selector", label: "Selector", type: "text", required: true },
    {
      key: "state",
      label: "State",
      type: "select",
      required: false,
      defaultValue: "visible",
      options: [
        { label: "Visible", value: "visible" },
        { label: "Attached", value: "attached" },
        { label: "Hidden", value: "hidden" },
        { label: "Detached", value: "detached" },
      ],
    },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      required: false,
      defaultValue: 15000,
    },
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
    if (!selector) {
      return {
        ok: false,
        message: "The 'selector' input is required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const state = parseWaitState(readStringField(input, "state", "visible"));
    const timeoutMs = Math.max(1, readNumberField(input, "timeoutMs", 15000));
    const tabId = readStringField(input, "tabId", "").trim();
    const frameSelector = readStringField(input, "frameSelector", "").trim();

    const output = await playwright.waitForElement({
      selector,
      state,
      timeoutMs,
      tabId: tabId || undefined,
      frameSelector: frameSelector || undefined,
    });

    return {
      ok: true,
      message: "Wait For Element executed successfully.",
      output,
    };
  },
};
