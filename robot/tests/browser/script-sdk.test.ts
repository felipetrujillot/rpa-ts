import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  CuaDriver,
  type CuaTransport,
} from "../../src/automation/drivers/cua-driver";
import { createAutomationRegistry } from "../../src/automation";
import { PlaywrightRuntime } from "../../src/automation/apps/playwright.runtime";

it("opens, reads and closes a real browser through the isolated TypeScript SDK", async () => {
  const runtime = new PlaywrightRuntime({ headless: true });
  const registry = createAutomationRegistry();
  const allowedActions = [
    "playwright.browser.openTab",
    "playwright.page.evaluate",
    "playwright.browser.closeTab",
  ];
  try {
    const result = await registry.execute(
      "script.typescript.run",
      {
        code: `const tab = await rpa.browser.openTab({url: "data:text/html,<title>SDK test</title>"});
        const page = await rpa.browser.evaluate({tabId: tab.tabId, expression: "document.title"});
        await rpa.browser.closeTab({tabId: tab.tabId});
        return { correcto: true, tabId: tab.tabId, title: page.value };`,
        allowedActions,
        timeoutMs: 15000,
      },
      {
        appContexts: { playwright: runtime.getAppContext() },
        authorizeScriptAction: async (id) => allowedActions.includes(id),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      output: {
        result: { correcto: true, tabId: "tab-1", title: "SDK test" },
        actions: allowedActions.map((actionId) => ({
          actionId,
          status: "success",
        })),
      },
    });
  } finally {
    await runtime.shutdown();
  }
});

it("runs the form example in a real browser and sends the verified record to CUA clipboard", async () => {
  const runtime = new PlaywrightRuntime({ headless: true });
  const registry = createAutomationRegistry();
  const transport = vi.fn<CuaTransport>(async () => ({ written: true }));
  const code = await readFile(
    new URL("../../../docs/examples/formulario-cua.ts", import.meta.url),
    "utf8",
  );
  const allowedActions = [
    "playwright.browser.openTab",
    "playwright.page.type",
    "playwright.page.select",
    "playwright.page.click",
    "playwright.page.waitForElement",
    "playwright.page.evaluate",
    "cua.clipboard.write",
  ];
  try {
    const result = await registry.execute(
      "script.typescript.run",
      {
        code,
        timeoutMs: 30000,
        allowedActions,
        data: {
          nombre: "Ana Prueba",
          email: "ana@example.com",
          area: "ventas",
          mensaje: "Una solicitud de prueba",
        },
      },
      {
        appContexts: {
          playwright: runtime.getAppContext(),
          cua: new CuaDriver("form-sdk-test", transport),
        },
        authorizeScriptAction: async (id) => allowedActions.includes(id),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      output: {
        result: {
          correcto: true,
          copiadoAlPortapapeles: true,
          registro: {
            nombre: "Ana Prueba",
            email: "ana@example.com",
            area: "ventas",
            mensaje: "Una solicitud de prueba",
            codigo: "DEMO-001",
          },
        },
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "clipboard_write",
      expect.objectContaining({
        text: expect.stringContaining(
          "Solicitud DEMO-001\nNombre: Ana Prueba\nEmail: ana@example.com",
        ),
      }),
    );
  } finally {
    await runtime.shutdown();
  }
});
