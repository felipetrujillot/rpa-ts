import type { AutomationAction } from "../../core/types";
import {
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseOperation = (
  value: string,
): "get" | "set" | "remove" | "clear" | null => {
  if (
    value === "get" ||
    value === "set" ||
    value === "remove" ||
    value === "clear"
  ) {
    return value;
  }

  return null;
};

export const playwrightLocalStorageAction: AutomationAction = {
  id: "playwright.browser.localStorage",
  appId: "playwright",
  name: "Local Storage",
  description: "Reads and writes localStorage values.",
  tags: ["browser", "storage", "localStorage"],
  inputFields: [
    {
      key: "operation",
      label: "Operation",
      type: "select",
      required: true,
      defaultValue: "get",
      options: [
        { label: "Get", value: "get" },
        { label: "Set", value: "set" },
        { label: "Remove", value: "remove" },
        { label: "Clear", value: "clear" },
      ],
    },
    { key: "key", label: "Key", type: "text", required: false },
    { key: "value", label: "Value", type: "text", required: false },
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

    const operation = parseOperation(
      readRequiredStringField(input, "operation") ?? "",
    );
    if (!operation) {
      return {
        ok: false,
        message: "The 'operation' input is invalid.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const key = readStringField(input, "key", "").trim();
    const value = readStringField(input, "value", "");
    const tabId = readStringField(input, "tabId", "").trim();

    if ((operation === "get" || operation === "remove") && !key) {
      return {
        ok: false,
        message: "The 'key' input is required for get/remove operations.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    if (operation === "set" && !key) {
      return {
        ok: false,
        message: "The 'key' input is required for set operation.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const output = await playwright.localStorage({
      operation,
      key: key || undefined,
      value: value || undefined,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "LocalStorage action executed successfully.",
      output,
    };
  },
};
