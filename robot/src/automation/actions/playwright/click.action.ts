import type { AutomationAction } from "../../core/types";
import {
  readBooleanField,
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseButton = (
  value: string,
): "left" | "right" | "middle" | undefined => {
  if (value === "left" || value === "right" || value === "middle") {
    return value;
  }

  return undefined;
};

export const playwrightClickAction: AutomationAction = {
  id: "playwright.page.click",
  appId: "playwright",
  name: "Click",
  description: "Clicks an element in the page.",
  tags: ["browser", "page", "interaction"],
  inputFields: [
    {
      key: "selector",
      label: "Selector",
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
      key: "button",
      label: "Button",
      type: "select",
      required: false,
      defaultValue: "left",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
        { label: "Middle", value: "middle" },
      ],
    },
    {
      key: "double",
      label: "Double Click",
      type: "boolean",
      required: false,
      defaultValue: false,
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

    const tabId = readStringField(input, "tabId", "").trim();
    const frameSelector = readStringField(input, "frameSelector", "").trim();
    const button = parseButton(readStringField(input, "button", "left"));
    const double = readBooleanField(input, "double", false);

    const output = await playwright.click({
      selector,
      tabId: tabId || undefined,
      frameSelector: frameSelector || undefined,
      button,
      double,
    });

    return {
      ok: true,
      message: "Click executed successfully.",
      output,
    };
  },
};
