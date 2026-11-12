import type { AutomationAction } from "../../core/types";
import { readStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightOpenTabAction: AutomationAction = {
  id: "playwright.browser.openTab",
  appId: "playwright",
  name: "Open tab",
  description: "Opens a new browser tab.",
  tags: ["browser", "tab"],
  inputFields: [
    {
      key: "url",
      label: "URL",
      type: "text",
      required: false,
      defaultValue: "about:blank",
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

    const url = readStringField(input, "url", "about:blank").trim();
    const output = await playwright.openTab({ url: url || undefined });

    return {
      ok: true,
      message: "Open tab executed successfully.",
      output,
    };
  },
};
