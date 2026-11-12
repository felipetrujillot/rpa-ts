import type { AutomationAction } from "../../core/types";
import { readStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightCloseTabAction: AutomationAction = {
  id: "playwright.browser.closeTab",
  appId: "playwright",
  name: "Close tab",
  description: "Closes a browser tab.",
  tags: ["browser", "tab"],
  inputFields: [
    {
      key: "tabId",
      label: "Tab ID",
      type: "text",
      required: false,
      description: "If omitted, implementation can close active tab.",
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

    const tabId = readStringField(input, "tabId", "").trim();
    const output = await playwright.closeTab({ tabId: tabId || undefined });

    return {
      ok: true,
      message: "Close tab executed successfully.",
      output,
    };
  },
};
