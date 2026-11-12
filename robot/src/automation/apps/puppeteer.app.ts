import { puppeteerNavigateAction } from "../actions/puppeteer/navigate.action";
import type { AutomationApp } from "../core/types";

export const puppeteerApp: AutomationApp = {
  id: "puppeteer",
  name: "Puppeteer",
  description:
    "Browser automation action schema for Puppeteer-driven sessions.",
  actions: [puppeteerNavigateAction],
};
