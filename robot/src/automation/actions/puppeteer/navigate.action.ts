import type { AutomationAction } from "../../core/types";
import { readRequiredStringField } from "../../core/validation";

type PuppeteerAppContext = {
  connected: boolean;
  navigate: (url: string) => Promise<void>;
};

const getPuppeteerContext = (context: {
  appContexts?: Record<string, unknown>;
}): PuppeteerAppContext | null => {
  const appContext = context.appContexts?.puppeteer;

  if (!appContext || typeof appContext !== "object") {
    return null;
  }

  const candidate = appContext as Partial<PuppeteerAppContext>;

  if (typeof candidate.navigate !== "function") {
    return null;
  }

  return {
    connected: Boolean(candidate.connected),
    navigate: candidate.navigate,
  };
};

export const puppeteerNavigateAction: AutomationAction = {
  id: "puppeteer.page.navigate",
  appId: "puppeteer",
  name: "Navigate page",
  description: "Navigates the active Puppeteer page to an URL.",
  tags: ["browser", "navigation"],
  inputFields: [
    {
      key: "url",
      label: "URL",
      type: "text",
      required: true,
      defaultValue: "https://example.com",
    },
  ],
  availability: (context) => {
    const puppeteer = getPuppeteerContext(context);

    if (!puppeteer?.connected) {
      return {
        available: false,
        unavailableReason: "Puppeteer app is not connected yet.",
      };
    }

    return { available: true };
  },
  run: async (input, context) => {
    const puppeteer = getPuppeteerContext(context);

    if (!puppeteer?.connected) {
      return {
        ok: false,
        message: "Puppeteer app is not connected yet.",
        errorCode: "APP_NOT_CONNECTED",
      };
    }

    const url = readRequiredStringField(input, "url");

    if (!url) {
      return {
        ok: false,
        message: "The 'url' input is required.",
        errorCode: "VALIDATION_ERROR",
      };
    }

    await puppeteer.navigate(url);

    return {
      ok: true,
      message: "Navigation executed successfully.",
      output: { url },
    };
  },
};
