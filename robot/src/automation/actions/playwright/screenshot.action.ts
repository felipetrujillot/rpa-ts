import type { AutomationAction } from "../../core/types";
import { readBooleanField, readStringField } from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightScreenshotAction: AutomationAction = {
  id: "playwright.page.screenshot",
  appId: "playwright",
  name: "Screenshot",
  description: "Captures a page or element screenshot.",
  tags: ["browser", "page", "capture"],
  inputFields: [
    {
      key: "path",
      label: "Output Path",
      type: "text",
      required: false,
      defaultValue: "./artifacts/screenshot.png",
    },
    { key: "selector", label: "Selector", type: "text", required: false },
    {
      key: "fullPage",
      label: "Full Page",
      type: "boolean",
      required: false,
      defaultValue: true,
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

    const path = readStringField(
      input,
      "path",
      "./artifacts/screenshot.png",
    ).trim();
    const selector = readStringField(input, "selector", "").trim();
    const fullPage = readBooleanField(input, "fullPage", true);
    const tabId = readStringField(input, "tabId", "").trim();

    const output = await playwright.screenshot({
      path,
      selector: selector || undefined,
      fullPage,
      tabId: tabId || undefined,
    });

    return {
      ok: true,
      message: "Screenshot executed successfully.",
      output,
    };
  },
};
