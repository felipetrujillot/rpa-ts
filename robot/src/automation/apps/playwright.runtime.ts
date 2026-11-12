import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type LaunchOptions,
} from "playwright";
import type {
  PlaywrightAppContext,
  PlaywrightCookiesPayload,
  PlaywrightDownloadPayload,
  PlaywrightIframePayload,
  PlaywrightLocalStoragePayload,
  PlaywrightNetworkPayload,
} from "../actions/playwright/context";

const DEFAULT_TIMEOUT_MS = 15000;

const normalizeTimeout = (
  timeoutMs?: number,
  fallback = DEFAULT_TIMEOUT_MS,
) => {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return fallback;
  }

  return Math.max(1, Math.floor(timeoutMs));
};

const sanitizeTabId = (tabId?: string): string | undefined => {
  const value = tabId?.trim();
  return value ? value : undefined;
};

export class PlaywrightRuntime {
  constructor(
    private readonly launchOptions: Pick<
      LaunchOptions,
      "channel" | "executablePath" | "headless"
    > = {},
  ) {}
  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private readonly tabs = new Map<string, Page>();

  private activeTabId: string | null = null;

  private tabSequence = 0;

  private initializing: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.browser && this.context) {
      return;
    }

    if (!this.initializing) {
      this.initializing = (async () => {
        // An explicit executable/channel always takes precedence.
        const useInstalledChrome =
          !this.launchOptions.channel &&
          !this.launchOptions.executablePath &&
          !existsSync(chromium.executablePath());
        const browser = await chromium.launch({
          headless: process.env.PLAYWRIGHT_HEADLESS === "true",
          ...this.launchOptions,
          // Use installed Chrome when Playwright's separate Chromium is absent.
          ...(useInstalledChrome ? { channel: "chrome" } : {}),
        });

        const context = await browser.newContext({ acceptDownloads: true });
        this.browser = browser;
        this.context = context;
      })();
    }

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private registerPage(page: Page): string {
    const existing = Array.from(this.tabs.entries()).find(
      ([, value]) => value === page,
    );
    if (existing) {
      this.activeTabId = existing[0];
      return existing[0];
    }

    this.tabSequence += 1;
    const tabId = `tab-${this.tabSequence}`;

    this.tabs.set(tabId, page);
    this.activeTabId = tabId;

    page.on("close", () => {
      this.tabs.delete(tabId);

      if (this.activeTabId === tabId) {
        const next = this.tabs.keys().next();
        this.activeTabId = next.done ? null : next.value;
      }
    });

    return tabId;
  }

  private async getContext(): Promise<BrowserContext> {
    await this.ensureInitialized();

    if (!this.context) {
      throw new Error("Playwright context is not initialized.");
    }

    return this.context;
  }

  private getPageOrThrow(tabId?: string): { tabId: string; page: Page } {
    const resolvedTabId = sanitizeTabId(tabId) ?? this.activeTabId ?? undefined;

    if (!resolvedTabId) {
      throw new Error("No tab is available. Open a tab first.");
    }

    const page = this.tabs.get(resolvedTabId);

    if (!page) {
      throw new Error(`Tab not found: ${resolvedTabId}`);
    }

    return { tabId: resolvedTabId, page };
  }

  private async withPage(
    tabId?: string,
  ): Promise<{ tabId: string; page: Page }> {
    await this.ensureInitialized();
    return this.getPageOrThrow(tabId);
  }

  async openTab(payload: { url?: string }): Promise<unknown> {
    const context = await this.getContext();
    const page = await context.newPage();
    const tabId = this.registerPage(page);

    const url = payload.url?.trim();
    if (url && url !== "about:blank") {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    return {
      tabId,
      url: page.url(),
    };
  }

  async closeTab(payload: { tabId?: string }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    await page.close();

    return {
      tabId,
      remainingTabs: this.tabs.size,
      activeTabId: this.activeTabId,
    };
  }

  async switchTab(payload: { tabId: string }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    await page.bringToFront();
    this.activeTabId = tabId;

    return {
      tabId,
      url: page.url(),
    };
  }

  async click(payload: {
    selector: string;
    tabId?: string;
    frameSelector?: string;
    button?: "left" | "right" | "middle";
    double?: boolean;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const button = payload.button ?? "left";

    if (payload.frameSelector) {
      const locator = page
        .frameLocator(payload.frameSelector)
        .locator(payload.selector);
      if (payload.double) {
        await locator.dblclick({ button });
      } else {
        await locator.click({ button });
      }
    } else {
      const locator = page.locator(payload.selector);
      if (payload.double) {
        await locator.dblclick({ button });
      } else {
        await locator.click({ button });
      }
    }

    return {
      tabId,
      selector: payload.selector,
      frameSelector: payload.frameSelector,
      button,
      double: Boolean(payload.double),
    };
  }

  async type(payload: {
    selector: string;
    text: string;
    tabId?: string;
    frameSelector?: string;
    clearFirst?: boolean;
    delayMs?: number;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const delay = Math.max(0, Math.floor(payload.delayMs ?? 0));

    const locator = payload.frameSelector
      ? page.frameLocator(payload.frameSelector).locator(payload.selector)
      : page.locator(payload.selector);

    if (payload.clearFirst !== false) {
      await locator.fill("");
    }

    await locator.type(payload.text, { delay });

    return {
      tabId,
      selector: payload.selector,
      textLength: payload.text.length,
      delayMs: delay,
    };
  }

  async select(payload: {
    selector: string;
    value: string;
    tabId?: string;
    frameSelector?: string;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);

    const locator = payload.frameSelector
      ? page.frameLocator(payload.frameSelector).locator(payload.selector)
      : page.locator(payload.selector);

    const selected = await locator.selectOption(payload.value);

    return {
      tabId,
      selector: payload.selector,
      selected,
    };
  }

  async upload(payload: {
    selector: string;
    filePath: string;
    tabId?: string;
    frameSelector?: string;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);

    const locator = payload.frameSelector
      ? page.frameLocator(payload.frameSelector).locator(payload.selector)
      : page.locator(payload.selector);

    await locator.setInputFiles(payload.filePath);

    return {
      tabId,
      selector: payload.selector,
      filePath: path.resolve(payload.filePath),
    };
  }

  async download(payload: PlaywrightDownloadPayload): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const timeout = normalizeTimeout(payload.timeoutMs, 30000);

    const downloadPromise = page.waitForEvent("download", { timeout });

    if (payload.triggerSelector) {
      await page.locator(payload.triggerSelector).click();
    } else if (payload.url) {
      await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout });
    } else {
      throw new Error("Provide a trigger selector or url for download.");
    }

    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();
    const targetPath = payload.saveAs
      ? path.resolve(payload.saveAs)
      : path.resolve("downloads", suggestedFilename);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await download.saveAs(targetPath);

    return {
      tabId,
      path: targetPath,
      suggestedFilename,
      url: download.url(),
    };
  }

  async screenshot(payload: {
    path?: string;
    selector?: string;
    fullPage?: boolean;
    tabId?: string;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const outputPath = path.resolve(
      payload.path ?? "./artifacts/screenshot.png",
    );

    await mkdir(path.dirname(outputPath), { recursive: true });

    if (payload.selector) {
      await page.locator(payload.selector).screenshot({ path: outputPath });
    } else {
      await page.screenshot({
        path: outputPath,
        fullPage: payload.fullPage !== false,
      });
    }

    return {
      tabId,
      path: outputPath,
      selector: payload.selector,
      fullPage: payload.fullPage !== false,
    };
  }

  async evaluate(payload: {
    expression: string;
    tabId?: string;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);

    const value = await page.evaluate((expression: string) => {
      // eslint-disable-next-line no-eval
      return eval(expression);
    }, payload.expression);

    return {
      tabId,
      value,
    };
  }

  async iframe(payload: PlaywrightIframePayload): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const timeout = normalizeTimeout(payload.timeoutMs);
    const locator = page
      .frameLocator(payload.frameSelector)
      .locator(payload.selector);

    if (payload.action === "click") {
      await locator.click({ timeout });
    } else if (payload.action === "type") {
      await locator.fill(payload.text ?? "", { timeout });
    } else {
      await locator.waitFor({ state: "visible", timeout });
    }

    return {
      tabId,
      frameSelector: payload.frameSelector,
      selector: payload.selector,
      action: payload.action,
    };
  }

  async popup(payload: {
    triggerSelector?: string;
    urlContains?: string;
    timeoutMs?: number;
    tabId?: string;
  }): Promise<unknown> {
    const { page } = await this.withPage(payload.tabId);
    const timeout = normalizeTimeout(payload.timeoutMs);

    const popupPromise = page.waitForEvent("popup", { timeout });
    if (payload.triggerSelector) {
      await page.locator(payload.triggerSelector).click();
    }

    const popupPage = await popupPromise;
    const tabId = this.registerPage(popupPage);

    if (payload.urlContains) {
      await popupPage.waitForURL(new RegExp(payload.urlContains), { timeout });
    }

    await popupPage.bringToFront();
    this.activeTabId = tabId;

    return {
      tabId,
      url: popupPage.url(),
    };
  }

  async cookies(payload: PlaywrightCookiesPayload): Promise<unknown> {
    const context = await this.getContext();

    if (payload.operation === "get") {
      const cookies = await context.cookies();
      const filtered = payload.name
        ? cookies.filter((item) => item.name === payload.name)
        : cookies;

      return {
        cookies: filtered,
      };
    }

    if (payload.operation === "set") {
      if (
        !payload.name ||
        !payload.value ||
        (!payload.url && !payload.domain)
      ) {
        throw new Error("Invalid cookie payload for set operation.");
      }

      await context.addCookies([
        {
          name: payload.name,
          value: payload.value,
          url: payload.url,
          domain: payload.domain,
          path: payload.path ?? "/",
        },
      ]);

      return {
        set: true,
        name: payload.name,
      };
    }

    if (payload.name) {
      await context.clearCookies({ name: payload.name });
    } else {
      await context.clearCookies();
    }

    return {
      cleared: true,
      name: payload.name,
    };
  }

  async localStorage(payload: PlaywrightLocalStoragePayload): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);

    const value = await page.evaluate(
      ({ operation, key, storageValue }) => {
        if (operation === "get") {
          return key ? window.localStorage.getItem(key) : null;
        }

        if (operation === "set") {
          if (!key) {
            throw new Error("Missing key for localStorage set operation.");
          }

          window.localStorage.setItem(key, storageValue ?? "");
          return true;
        }

        if (operation === "remove") {
          if (!key) {
            throw new Error("Missing key for localStorage remove operation.");
          }

          window.localStorage.removeItem(key);
          return true;
        }

        window.localStorage.clear();
        return true;
      },
      {
        operation: payload.operation,
        key: payload.key,
        storageValue: payload.value,
      },
    );

    return {
      tabId,
      operation: payload.operation,
      key: payload.key,
      value,
    };
  }

  async waitForElement(payload: {
    selector: string;
    state?: "attached" | "visible" | "hidden" | "detached";
    timeoutMs?: number;
    tabId?: string;
    frameSelector?: string;
  }): Promise<unknown> {
    const { tabId, page } = await this.withPage(payload.tabId);
    const timeout = normalizeTimeout(payload.timeoutMs);
    const state = payload.state ?? "visible";

    const locator = payload.frameSelector
      ? page.frameLocator(payload.frameSelector).locator(payload.selector)
      : page.locator(payload.selector);

    await locator.waitFor({ state, timeout });

    return {
      tabId,
      selector: payload.selector,
      state,
      timeoutMs: timeout,
    };
  }

  async network(payload: PlaywrightNetworkPayload): Promise<unknown> {
    const context = await this.getContext();
    const timeout = normalizeTimeout(payload.timeoutMs, 20000);

    let headers: Record<string, string> | undefined;
    if (payload.headers) {
      try {
        const parsed = JSON.parse(payload.headers) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          headers = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(
              ([key, value]) => [key, String(value)],
            ),
          );
        }
      } catch {
        throw new Error("Invalid headers JSON.");
      }
    }

    const response = await context.request.fetch(payload.url, {
      method: payload.method,
      headers,
      data: payload.body,
      timeout,
    });

    return {
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
      headers: response.headers(),
      body: await response.text(),
    };
  }

  async shutdown(): Promise<void> {
    // A cancellation can arrive while Chromium is launching. Wait for that
    // launch before closing it so it cannot escape cleanup after cancellation.
    if (this.initializing) await this.initializing.catch(() => undefined);
    const context = this.context;
    const browser = this.browser;

    this.tabs.clear();
    this.activeTabId = null;
    this.tabSequence = 0;
    this.context = null;
    this.browser = null;
    this.initializing = null;

    if (context) {
      try {
        await context.close();
      } catch {
        // ignore cleanup errors
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  getAppContext(): PlaywrightAppContext {
    return {
      connected: true,
      openTab: (payload) => this.openTab(payload),
      closeTab: (payload) => this.closeTab(payload),
      switchTab: (payload) => this.switchTab(payload),
      click: (payload) => this.click(payload),
      type: (payload) => this.type(payload),
      select: (payload) => this.select(payload),
      upload: (payload) => this.upload(payload),
      download: (payload) => this.download(payload),
      screenshot: (payload) => this.screenshot(payload),
      evaluate: (payload) => this.evaluate(payload),
      iframe: (payload) => this.iframe(payload),
      popup: (payload) => this.popup(payload),
      cookies: (payload) => this.cookies(payload),
      localStorage: (payload) => this.localStorage(payload),
      waitForElement: (payload) => this.waitForElement(payload),
      network: (payload) => this.network(payload),
    };
  }
}

let sharedPlaywrightRuntime: PlaywrightRuntime | null = null;

export const getSharedPlaywrightRuntime = (): PlaywrightRuntime => {
  if (!sharedPlaywrightRuntime) {
    sharedPlaywrightRuntime = new PlaywrightRuntime();
  }

  return sharedPlaywrightRuntime;
};
