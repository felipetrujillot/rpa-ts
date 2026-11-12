import { wordApp } from "./word.app";
import { excelApp } from "./excel.app";
import { cuaApp } from "./cua.app";
import type { AutomationApp } from "../core/types";
import { playwrightApp } from "./playwright.app";
import { puppeteerApp } from "./puppeteer.app";
import { scriptApp } from "./script.app";

export const defaultAutomationApps: AutomationApp[] = [
  wordApp,
  scriptApp,
  excelApp,
  puppeteerApp,
  playwrightApp,
  cuaApp,
];
