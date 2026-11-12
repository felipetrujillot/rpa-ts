import type { AutomationAction } from "../../core/types";
import {
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseCookiesOperation = (
  value: string,
): "get" | "set" | "clear" | null => {
  if (value === "get" || value === "set" || value === "clear") {
    return value;
  }

  return null;
};

export const playwrightCookiesAction: AutomationAction = {
  id: "playwright.browser.cookies",
  appId: "playwright",
  name: "Cookies",
  description: "Gets, sets, or clears browser cookies.",
  tags: ["browser", "storage", "cookies"],
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
        { label: "Clear", value: "clear" },
      ],
    },
    { key: "name", label: "Name", type: "text", required: false },
    { key: "value", label: "Value", type: "text", required: false },
    { key: "url", label: "URL", type: "text", required: false },
    { key: "domain", label: "Domain", type: "text", required: false },
    { key: "path", label: "Path", type: "text", required: false },
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

    const operation = parseCookiesOperation(
      readRequiredStringField(input, "operation") ?? "",
    );

    if (!operation) {
      return {
        ok: false,
        message: "The 'operation' input is invalid.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const name = readStringField(input, "name", "").trim();
    const value = readStringField(input, "value", "").trim();
    const url = readStringField(input, "url", "").trim();
    const domain = readStringField(input, "domain", "").trim();
    const path = readStringField(input, "path", "").trim();
    const tabId = readStringField(input, "tabId", "").trim();

    if (operation === "set" && (!name || !value || (!url && !domain))) {
      return {
        ok: false,
        message:
          "For 'set', provide 'name', 'value' and either 'url' or 'domain'.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const output = await playwright.cookies({
      operation,
      name: name || undefined,
      value: value || undefined,
      url: url || undefined,
      domain: domain || undefined,
      path: path || undefined,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "Cookies action executed successfully.",
      output,
    };
  },
};
