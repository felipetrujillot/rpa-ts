import { expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  CuaDriver,
  type CuaWindow,
} from "../../src/automation/drivers/cua-driver";
import { cuaApp } from "../../src/automation/apps/cua.app";
import { AutomationRegistry } from "../../src/automation/core/registry";
import { executeFlowDocument } from "../../src/automation/flow/runner";
import { validateFlowDocument } from "../../src/automation/flow/validate";
import type {
  FlowDocument,
  FlowExecutionResult,
} from "../../src/automation/flow/types";
const artifacts = resolve(
  process.env.RPA_DESKTOP_ARTIFACTS || "artifacts/desktop",
);
const selectWindow = async (
  driver: CuaDriver,
  pid: number,
  title?: string,
): Promise<CuaWindow> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await driver.call("list_windows", { pid });
    const windows = ((result.windows as CuaWindow[]) || []).filter(
      (w) => w.pid === pid && (!title || w.title?.includes(title)),
    );
    if (windows.length === 1) return windows[0]!;
    if (windows.length > 1)
      throw new Error(
        "Varias ventanas coinciden: no se seleccionará una ventana arbitraria.",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("CUA no encontró una ventana única lista para operar.");
};
const run = async (
  driver: CuaDriver,
  fixture: string,
  input: Record<string, unknown>,
) => {
  const document = JSON.parse(
    await readFile(resolve("examples", fixture), "utf8"),
  ) as FlowDocument;
  const registry = new AutomationRegistry();
  registry.registerApp(cuaApp);
  expect(
    validateFlowDocument(document, {
      knownActionIds: new Set(registry.getActionIds()),
    }).ok,
  ).toBe(true);
  return executeFlowDocument(
    document,
    { input },
    {
      runAction: (id, values) =>
        registry.execute(id, values, { appContexts: { cua: driver } }),
    },
  );
};
const saveEvidence = async (name: string, result: FlowExecutionResult) => {
  await mkdir(artifacts, { recursive: true });
  const verified = result.outputs.nodeOutputs.verify as
    | {
        verified?: boolean;
        expected?: string;
        observed?: unknown;
        method?: string;
        snapshot_id?: string;
        pid?: number;
        window_id?: number;
        images?: Array<{ data: string; mimeType: string }>;
      }
    | undefined;
  if (verified?.images?.[0])
    await writeFile(
      join(artifacts, `${name}.png`),
      Buffer.from(verified.images[0].data, "base64"),
    );
  await writeFile(
    join(artifacts, `${name}.json`),
    JSON.stringify(
      {
        status: result.status,
        error: result.error,
        verified: verified?.verified,
        expected: verified?.expected,
        observed: verified?.observed,
        method: verified?.method || "accessibility",
        snapshot_id: verified?.snapshot_id,
        pid: verified?.pid,
        window_id: verified?.window_id,
        platform: process.platform,
        arch: process.arch,
        nodes: result.nodeRuns.map(({ output, ...step }) => step),
      },
      null,
      2,
    ),
  );
};
it("Calculadora: opera 6 × 7 y verifica 42 en una captura real", async () => {
  if (process.platform !== "darwin")
    throw new Error(
      "Este fixture valida Calculadora de macOS; configurar un fixture equivalente para la plataforma instalada.",
    );
  const driver = new CuaDriver(`rpa-calculator-${Date.now()}`);
  try {
    const launched = await driver.call("launch_app", {
      bundle_id: "com.apple.calculator",
      creates_new_application_instance: true,
    });
    const window = await selectWindow(driver, Number(launched.pid));
    await driver.call("invoke_menu", {
      pid: window.pid,
      window_id: window.window_id,
      path: ["View", "Basic"],
    });
    const initial = await driver.snapshot(window.pid, window.window_id);
    if (initial.elements?.some((e) => e.label === "Input Unit"))
      await driver.call("invoke_menu", {
        pid: window.pid,
        window_id: window.window_id,
        path: ["View", "Convert"],
      });
    const result = await run(driver, "calculator.flow.json", {
      pid: window.pid,
      windowId: window.window_id,
    });
    await saveEvidence("calculator", result);
    expect(result.error?.message || result.status).toBe("success");
    expect(
      (result.outputs.nodeOutputs.verify as { verified: boolean }).verified,
    ).toBe(true);
  } finally {
    await driver.shutdown();
  }
});
it("TextEdit: escribe texto en un archivo de prueba, captura, comprueba y guarda", async () => {
  if (process.platform !== "darwin")
    throw new Error("Este fixture valida TextEdit de macOS.");
  const driver = new CuaDriver(`rpa-textedit-${Date.now()}`);
  await mkdir(artifacts, { recursive: true });
  const filename = `rpa-textedit-${Date.now()}.txt`;
  const path = join(artifacts, filename);
  await writeFile(path, "");
  const expected = "RPA CUA: macOS verificado — 6 x 7 = 42.";
  try {
    const launched = await driver.call("launch_app", {
      bundle_id: "com.apple.TextEdit",
      urls: [path],
    });
    const window = await selectWindow(driver, Number(launched.pid), filename);
    const result = await run(driver, "textedit.flow.json", {
      pid: window.pid,
      windowId: window.window_id,
      text: expected,
    });
    await saveEvidence("textedit", result);
    expect(result.error?.message || result.status).toBe("success");
    await expect
      .poll(() => readFile(path, "utf8"), { timeout: 5000 })
      .toBe(expected);
  } finally {
    await driver.shutdown();
  }
});
