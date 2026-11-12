import { afterAll, beforeAll, expect, it } from "vitest";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let electron: ElectronApplication;
let page: Page;
let profile: string;

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "rpa-tray-ui-"));
  const env = { ...process.env, RPA_UI_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    args: [resolve("tests/ui/fixtures/tray-main.cjs")],
    env,
  });
  page = await electron.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

afterAll(async () => {
  await electron?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

it("hides on close and keeps the same renderer and its timers alive", async () => {
  const window = await electron.browserWindow(page);
  await expect.poll(() => window.evaluate((win) => win.isVisible())).toBe(true);
  await page.evaluate(() => {
    (globalThis as any).trayTicks = 0;
    setInterval(() => (globalThis as any).trayTicks++, 100);
  });
  await window.evaluate((win) => win.close());
  expect(await window.evaluate((win) => win.isDestroyed())).toBe(false);
  expect(await window.evaluate((win) => win.isVisible())).toBe(false);
  expect(await window.evaluate((win) => win.webContents.backgroundThrottling)).toBe(false);
  const ticks = await page.evaluate(() => (globalThis as any).trayTicks as number);
  await expect.poll(() => page.evaluate(() => (globalThis as any).trayTicks as number)).toBeGreaterThan(ticks + 2);

  await electron.evaluate(() => {
    const tray = (globalThis as any).testTray as Electron.Tray;
    if (tray.isDestroyed()) throw new Error("Tray was destroyed on window close");
    const menu = (globalThis as any).testTrayMenu as Electron.Menu;
    const item = menu.items.find((item) => item.label === "Abrir robot")!;
    item.click();
  });
  expect(await window.evaluate((win) => win.isVisible())).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).trayTicks)).toBeGreaterThan(ticks);
});

it("restores the existing window on activation and a second instance", async () => {
  const window = await electron.browserWindow(page);
  await window.evaluate((win) => win.hide());
  await electron.evaluate(({ app }) => { app.emit("activate"); });
  expect(await window.evaluate((win) => win.isVisible())).toBe(true);
  await window.evaluate((win) => win.minimize());
  await expect.poll(() => window.evaluate((win) => win.isMinimized())).toBe(true);
  await electron.evaluate(({ app }) => { app.emit("second-instance", {}, [], ""); });
  await expect.poll(() => window.evaluate((win) => win.isMinimized())).toBe(false);
  expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

it("exits completely from the tray even when the window is hidden", async () => {
  const window = await electron.browserWindow(page);
  await window.evaluate((win) => win.close());
  const closed = electron.waitForEvent("close");
  await electron.evaluate(() => {
    const menu = (globalThis as any).testTrayMenu as Electron.Menu;
    const item = menu.items.find((item) => item.label === "Salir")!;
    setImmediate(() => item.click());
  });
  await closed;
  expect(page.isClosed()).toBe(true);
});
