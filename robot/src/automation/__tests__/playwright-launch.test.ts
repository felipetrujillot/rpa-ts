import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaywrightRuntime } from "../apps/playwright.runtime";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("playwright", () => ({
  chromium: {
    executablePath: () => "/playwright/chromium",
    launch: mocks.launch,
  },
}));

beforeEach(() => {
  mocks.existsSync.mockReturnValue(true);
  const page = { on: vi.fn(), url: () => "about:blank" };
  const context = { newPage: async () => page, close: vi.fn() };
  mocks.launch.mockResolvedValue({
    newContext: async () => context,
    close: vi.fn(),
  });
});

describe("Playwright browser startup", () => {
  it("uses bundled Chromium when installed", async () => {
    const runtime = new PlaywrightRuntime({ headless: true });
    try {
      expect(await runtime.openTab({})).toMatchObject({
        tabId: "tab-1",
        url: "about:blank",
      });
      expect(mocks.launch).toHaveBeenCalledWith({ headless: true });
    } finally {
      await runtime.shutdown();
    }
  });

  it("uses installed Chrome when bundled Chromium is missing, including undefined options", async () => {
    mocks.existsSync.mockReturnValue(false);
    const runtime = new PlaywrightRuntime({
      headless: true,
      channel: undefined,
      executablePath: undefined,
    });
    try {
      await runtime.openTab({});
      expect(mocks.launch).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "chrome", headless: true }),
      );
      expect(mocks.launch).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it.each([{ channel: "msedge" }, { executablePath: "/custom/browser" }])(
    "respects an explicitly selected browser: %j",
    async (options) => {
      mocks.existsSync.mockReturnValue(false);
      const runtime = new PlaywrightRuntime({ headless: true, ...options });
      try {
        await runtime.openTab({});
        expect(mocks.launch).toHaveBeenCalledWith({
          headless: true,
          ...options,
        });
      } finally {
        await runtime.shutdown();
      }
    },
  );

  it("propagates startup errors without attempting a second launch", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.launch.mockRejectedValueOnce(new Error("Chrome is unavailable"));
    const runtime = new PlaywrightRuntime({ headless: true });
    await expect(runtime.openTab({})).rejects.toThrow("Chrome is unavailable");
    expect(mocks.launch).toHaveBeenCalledTimes(1);
  });
});
