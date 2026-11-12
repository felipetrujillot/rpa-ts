import { z } from "zod";
import type { ActionInputField } from "./automation";

const text = z.string();
const required = z.string().min(1);
const tab = { tabId: text.optional() };
const target = { selector: required, ...tab, frameSelector: text.optional() };
const timeoutMs = z.number().int().min(1).max(120000).optional();
export const browserInputSchemas = {
  "playwright.browser.openTab": z.strictObject({ url: text.optional() }),
  "playwright.browser.closeTab": z.strictObject(tab),
  "playwright.browser.switchTab": z.strictObject({ tabId: required }),
  "playwright.page.click": z.strictObject({
    ...target,
    button: z.enum(["left", "right", "middle"]).optional(),
    double: z.boolean().optional(),
  }),
  "playwright.page.type": z.strictObject({
    ...target,
    text,
    clearFirst: z.boolean().optional(),
    delayMs: z.number().nonnegative().optional(),
  }),
  "playwright.page.select": z.strictObject({ ...target, value: required }),
  "playwright.page.upload": z.strictObject({ ...target, filePath: required }),
  "playwright.page.download": z.strictObject({
    ...tab,
    triggerSelector: text.optional(),
    url: text.optional(),
    saveAs: text.optional(),
    timeoutMs,
  }),
  "playwright.page.screenshot": z.strictObject({
    ...tab,
    path: text.optional(),
    selector: text.optional(),
    fullPage: z.boolean().optional(),
  }),
  "playwright.page.evaluate": z.strictObject({ ...tab, expression: required }),
  "playwright.page.iframe": z.strictObject({
    ...tab,
    frameSelector: required,
    selector: required,
    action: z.enum(["click", "type", "waitForElement"]),
    text: text.optional(),
    timeoutMs,
  }),
  "playwright.page.popup": z.strictObject({
    ...tab,
    triggerSelector: text.optional(),
    urlContains: text.optional(),
    timeoutMs,
  }),
  "playwright.browser.cookies": z.strictObject({
    ...tab,
    operation: z.enum(["get", "set", "clear"]),
    name: text.optional(),
    value: text.optional(),
    url: text.optional(),
    domain: text.optional(),
    path: text.optional(),
  }),
  "playwright.browser.localStorage": z.strictObject({
    ...tab,
    operation: z.enum(["get", "set", "remove", "clear"]),
    key: text.optional(),
    value: text.optional(),
  }),
  "playwright.page.waitForElement": z.strictObject({
    ...target,
    state: z.enum(["attached", "visible", "hidden", "detached"]).optional(),
    timeoutMs,
  }),
  "playwright.network.request": z.strictObject({
    ...tab,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: required,
    headers: text.optional(),
    body: text.optional(),
    timeoutMs,
  }),
  "puppeteer.page.navigate": z.strictObject({ url: required }),
} as const;
const outputTab = { tabId: text };
const outputPage = { ...outputTab, url: text };
const outputTarget = { ...outputTab, selector: text };
export const browserOutputSchemas = {
  "playwright.browser.openTab": z.object(outputPage),
  "playwright.browser.closeTab": z.object({
    ...outputTab,
    remainingTabs: z.number(),
    activeTabId: text.nullable(),
  }),
  "playwright.browser.switchTab": z.object(outputPage),
  "playwright.page.click": z.object({
    ...outputTarget,
    frameSelector: text.optional(),
    button: z.enum(["left", "right", "middle"]),
    double: z.boolean(),
  }),
  "playwright.page.type": z.object({
    ...outputTarget,
    textLength: z.number(),
    delayMs: z.number(),
  }),
  "playwright.page.select": z.object({
    ...outputTarget,
    selected: z.array(text),
  }),
  "playwright.page.upload": z.object({ ...outputTarget, filePath: text }),
  "playwright.page.download": z.object({
    ...outputTab,
    path: text,
    suggestedFilename: text,
    url: text,
  }),
  "playwright.page.screenshot": z.object({
    ...outputTab,
    path: text,
    selector: text.optional(),
    fullPage: z.boolean(),
  }),
  "playwright.page.evaluate": z.object({ ...outputTab, value: z.unknown() }),
  "playwright.page.iframe": z.object({
    ...outputTarget,
    frameSelector: text,
    action: z.enum(["click", "type", "waitForElement"]),
  }),
  "playwright.page.popup": z.object(outputPage),
  "playwright.browser.cookies": z.union([
    z.object({
      cookies: z.array(
        z.object({
          name: text,
          value: text,
          domain: text,
          path: text,
          expires: z.number(),
          httpOnly: z.boolean(),
          secure: z.boolean(),
          sameSite: z.enum(["Strict", "Lax", "None"]),
        }),
      ),
    }),
    z.object({ set: z.literal(true), name: text }),
    z.object({ cleared: z.literal(true), name: text.optional() }),
  ]),
  "playwright.browser.localStorage": z.object({
    ...outputTab,
    operation: text,
    key: text.optional(),
    value: z.unknown(),
  }),
  "playwright.page.waitForElement": z.object({
    ...outputTarget,
    state: text,
    timeoutMs: z.number(),
  }),
  "playwright.network.request": z.object({
    url: text,
    status: z.number(),
    ok: z.boolean(),
    headers: z.record(text, text),
    body: text,
  }),
  "puppeteer.page.navigate": z.object({ url: text }),
} as const;

// The browser action forms and script declarations use the same input contract.
export function browserActionFields(
  actionId: keyof typeof browserInputSchemas,
): ActionInputField[] {
  return Object.entries(browserInputSchemas[actionId].shape).map(
    ([key, schema]) => {
      const json = z.toJSONSchema(schema, {
        io: "input",
        unrepresentable: "any",
      }) as Record<string, unknown>;
      const options = Array.isArray(json.enum)
        ? json.enum.map((value) => ({
            label: String(value),
            value: String(value),
          }))
        : undefined;
      return {
        key,
        label: key,
        required: !schema.safeParse(undefined).success,
        type: options
          ? "select"
          : json.type === "boolean"
            ? "boolean"
            : json.type === "number" || json.type === "integer"
              ? "number"
              : "text",
        ...(options ? { options } : {}),
      };
    },
  );
}
