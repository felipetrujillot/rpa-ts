import type { AutomationAction } from "../../core/types";
import {
  readRequiredStringField,
  readStringField,
} from "../../core/validation";
import { getPlaywrightAvailability, getPlaywrightContext } from "./context";

export const playwrightUploadAction: AutomationAction = {
  id: "playwright.page.upload",
  appId: "playwright",
  name: "Upload",
  description: "Uploads a file using an input[type=file] element.",
  tags: ["browser", "page", "file"],
  inputFields: [
    { key: "selector", label: "Selector", type: "text", required: true },
    { key: "filePath", label: "File Path", type: "text", required: true },
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
    const filePath = readRequiredStringField(input, "filePath");
    if (!selector || !filePath) {
      return {
        ok: false,
        message: "The 'selector' and 'filePath' inputs are required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    const tabId = readStringField(input, "tabId", "").trim();
    const frameSelector = readStringField(input, "frameSelector", "").trim();
    const output = await playwright.upload({
      selector,
      filePath,
      tabId: tabId || undefined,
      frameSelector: frameSelector || undefined,
    });

    return {
      ok: true,
      message: "Upload executed successfully.",
      output,
    };
  },
};
