import { describe, expect, it, vi } from "vitest";
import { createAutomationRegistry } from "../index";
import type { AutomationContext } from "../core/types";

const createContext = () => {
  const openTab = vi.fn(async () => ({ tabId: "tab-1" }));
  const closeTab = vi.fn(async () => ({ closed: true }));
  const switchTab = vi.fn(async () => ({ activeTabId: "tab-1" }));
  const click = vi.fn(async () => ({ clicked: true }));
  const type = vi.fn(async () => ({ typed: true }));
  const select = vi.fn(async () => ({ selected: true }));
  const upload = vi.fn(async () => ({ uploaded: true }));
  const download = vi.fn(async () => ({ downloaded: true }));
  const screenshot = vi.fn(async () => ({ path: "./artifacts/search.png" }));
  const evaluate = vi.fn(async () => ({ value: "Example Domain" }));
  const iframe = vi.fn(async () => ({ frameHandled: true }));
  const popup = vi.fn(async () => ({ popupTabId: "tab-2" }));
  const cookies = vi.fn(async () => ({ cookies: [{ name: "session" }] }));
  const localStorage = vi.fn(async () => ({ value: "abc" }));
  const waitForElement = vi.fn(async () => ({ found: true }));
  const network = vi.fn(async () => ({ status: 200 }));

  const context: AutomationContext = {
    appContexts: {
      playwright: {
        connected: true,
        openTab,
        closeTab,
        switchTab,
        click,
        type,
        select,
        upload,
        download,
        screenshot,
        evaluate,
        iframe,
        popup,
        cookies,
        localStorage,
        waitForElement,
        network,
      },
      puppeteer: {
        connected: true,
        navigate: vi.fn(async () => undefined),
      },
    },
  };

  return {
    context,
    openTab,
    closeTab,
    switchTab,
    click,
    type,
    select,
    upload,
    download,
    screenshot,
    evaluate,
    iframe,
    popup,
    cookies,
    localStorage,
    waitForElement,
    network,
  };
};

describe("Playwright actions", () => {
  it("lists all browser prototype actions", async () => {
    const registry = createAutomationRegistry();
    const { context } = createContext();

    const actions = await registry.listActions(context, {
      appId: "playwright",
    });
    const ids = actions.map((item) => item.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "playwright.browser.openTab",
        "playwright.browser.closeTab",
        "playwright.browser.switchTab",
        "playwright.page.click",
        "playwright.page.type",
        "playwright.page.select",
        "playwright.page.upload",
        "playwright.page.download",
        "playwright.page.screenshot",
        "playwright.page.evaluate",
        "playwright.page.iframe",
        "playwright.page.popup",
        "playwright.browser.cookies",
        "playwright.browser.localStorage",
        "playwright.page.waitForElement",
        "playwright.network.request",
      ]),
    );
  });

  it("runs a browser example flow with all Playwright options", async () => {
    const registry = createAutomationRegistry();
    const spies = createContext();
    const { context } = spies;

    const executions = [
      registry.execute(
        "playwright.browser.openTab",
        { url: "https://example.com" },
        context,
      ),
      registry.execute(
        "playwright.browser.switchTab",
        { tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.waitForElement",
        {
          selector: "#search",
          state: "visible",
          timeoutMs: 2000,
          tabId: "tab-1",
        },
        context,
      ),
      registry.execute(
        "playwright.page.click",
        { selector: "#search", tabId: "tab-1", button: "left" },
        context,
      ),
      registry.execute(
        "playwright.page.type",
        { selector: "#search", text: "playwright", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.select",
        { selector: "#category", value: "all", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.upload",
        { selector: "#file", filePath: "/tmp/query.txt", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.download",
        { triggerSelector: "#download", saveAs: "result.csv", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.screenshot",
        { path: "./artifacts/search.png", fullPage: true, tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.evaluate",
        { expression: "document.title", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.page.iframe",
        {
          frameSelector: "iframe#results",
          action: "click",
          selector: ".item:first-child",
          tabId: "tab-1",
        },
        context,
      ),
      registry.execute(
        "playwright.page.popup",
        { triggerSelector: "#open-help", urlContains: "help", tabId: "tab-1" },
        context,
      ),
      registry.execute(
        "playwright.browser.cookies",
        {
          operation: "set",
          name: "session",
          value: "abc",
          url: "https://example.com",
        },
        context,
      ),
      registry.execute(
        "playwright.browser.localStorage",
        {
          operation: "set",
          key: "recentQuery",
          value: "playwright",
          tabId: "tab-1",
        },
        context,
      ),
      registry.execute(
        "playwright.network.request",
        {
          method: "GET",
          url: "https://example.com/api/search?q=playwright",
          tabId: "tab-1",
        },
        context,
      ),
      registry.execute(
        "playwright.browser.closeTab",
        { tabId: "tab-1" },
        context,
      ),
    ];

    const results = await Promise.all(executions);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }

    expect(spies.openTab).toHaveBeenCalledTimes(1);
    expect(spies.switchTab).toHaveBeenCalledTimes(1);
    expect(spies.waitForElement).toHaveBeenCalledTimes(1);
    expect(spies.click).toHaveBeenCalledTimes(1);
    expect(spies.type).toHaveBeenCalledTimes(1);
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.upload).toHaveBeenCalledTimes(1);
    expect(spies.download).toHaveBeenCalledTimes(1);
    expect(spies.screenshot).toHaveBeenCalledTimes(1);
    expect(spies.evaluate).toHaveBeenCalledTimes(1);
    expect(spies.iframe).toHaveBeenCalledTimes(1);
    expect(spies.popup).toHaveBeenCalledTimes(1);
    expect(spies.cookies).toHaveBeenCalledTimes(1);
    expect(spies.localStorage).toHaveBeenCalledTimes(1);
    expect(spies.network).toHaveBeenCalledTimes(1);
    expect(spies.closeTab).toHaveBeenCalledTimes(1);
  });
});
