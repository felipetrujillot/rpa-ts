import type { AutomationAction } from "../../core/types";
import {
  readNumberField,
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

const parseMethod = (
  value: string,
): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | null => {
  if (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  ) {
    return value;
  }

  return null;
};

export const playwrightNetworkAction: AutomationAction = {
  id: "playwright.network.request",
  appId: "playwright",
  name: "Network",
  description: "Executes a network request from the browser automation layer.",
  tags: ["browser", "network", "request"],
  inputFields: [
    {
      key: "method",
      label: "Method",
      type: "select",
      required: true,
      defaultValue: "GET",
      options: [
        { label: "GET", value: "GET" },
        { label: "POST", value: "POST" },
        { label: "PUT", value: "PUT" },
        { label: "PATCH", value: "PATCH" },
        { label: "DELETE", value: "DELETE" },
      ],
    },
    { key: "url", label: "URL", type: "text", required: true },
    {
      key: "headers",
      label: "Headers (JSON)",
      type: "text",
      required: false,
    },
    { key: "body", label: "Body", type: "text", required: false },
    { key: "tabId", label: "Tab ID", type: "text", required: false },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      required: false,
      defaultValue: 20000,
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

    const method = parseMethod(readRequiredStringField(input, "method") ?? "");
    const url = readRequiredStringField(input, "url");
    if (!method || !url) {
      return {
        ok: false,
        message: "The 'method' and 'url' inputs are required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const headers = readStringField(input, "headers", "").trim();
    const body = readStringField(input, "body", "");
    const tabId = readStringField(input, "tabId", "").trim();
    const timeoutMs = Math.max(1, readNumberField(input, "timeoutMs", 20000));

    const output = await playwright.network({
      method,
      url,
      headers: headers || undefined,
      body: body || undefined,
      tabId: tabId || undefined,
      timeoutMs,
    });

    return {
      ok: true,
      message: "Network action executed successfully.",
      output,
    };
  },
};
