import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflow,
  scriptActionDefinition,
  type AutomationValue,
} from "@rpa/contracts";
import { AutomationRegistry } from "../core/registry";
import { scriptApp } from "../apps/script.app";
import { executeFlowDocument } from "../flow/runner";
import { runTypeScript } from "../scripts/run";

const registry = new AutomationRegistry();
registry.registerApp(scriptApp);
const execute = (
  code: string,
  data: AutomationValue = "{}",
  timeoutMs = 5000,
) => registry.execute(scriptActionDefinition.id, { code, data, timeoutMs }, {});

afterEach(() => vi.unstubAllEnvs());

describe("TypeScript scripts", () => {
  it("executes typed async code with JSON input, logs and output", async () => {
    const result = await execute(
      `
      type Item = { amount: number };
      const items = input as Item[];
      const total: number = await Promise.resolve(items.reduce((sum, item) => sum + item.amount, 0));
      log("total", total);
      console.info({ count: items.length });
      return { total };
    `,
      [{ amount: 2 }, { amount: 3 }],
    );
    expect(result).toMatchObject({
      ok: true,
      output: { result: { total: 5 }, logs: [["total", 5], [{ count: 2 }]] },
    });
  });

  it("provides no Node, Electron, browser or direct network APIs", async () => {
    const result = await execute(
      `return [typeof process, typeof require, typeof fetch, typeof WebSocket, typeof window, typeof Buffer, typeof Deno];`,
    );
    expect(result).toMatchObject({
      ok: true,
      output: { result: Array(7).fill("undefined") },
    });
  });

  it("keeps function constructors inside the guest interpreter", async () => {
    const result = await execute(
      `return { node: Function("return typeof process")(), host: log.constructor("return typeof require")() };`,
    );
    expect(result).toMatchObject({
      ok: true,
      output: { result: { node: "undefined", host: "undefined" } },
    });
  });

  it("rejects module imports without a module loader", async () => {
    expect((await execute('return await import("node:fs");')).ok).toBe(false);
  });

  it("reports syntax errors and runtime errors with logs", async () => {
    expect(await execute("const x: = ;")).toMatchObject({
      ok: false,
      message: expect.stringContaining("TypeScript línea"),
    });
    expect(
      await execute('log("antes"); throw new Error("prueba");'),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("prueba"),
      output: { logs: [["antes"]] },
    });
  });

  it("terminates synchronous loops without blocking the host", async () => {
    let hostResponsive = false;
    const timer = setTimeout(() => {
      hostResponsive = true;
    }, 20);
    const result = await execute("while (true) {}", "{}", 800);
    clearTimeout(timer);
    expect(hostResponsive).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toMatch(/SCRIPT_TIMEOUT|SCRIPT_FAILED/);
  });

  it("terminates endless promises and async job loops", async () => {
    expect((await execute("await new Promise(() => {});", "{}", 800)).ok).toBe(
      false,
    );
    expect(
      (await execute("while (true) { await Promise.resolve(); }", "{}", 800))
        .ok,
    ).toBe(false);
  });

  it("limits guest memory and keeps later executions healthy", async () => {
    const result = await execute(
      'const a = []; for (;;) a.push("x".repeat(10000));',
      "{}",
      2000,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/memory|allocation|memoria/i);
    expect(await execute("return 42;")).toMatchObject({
      ok: true,
      output: { result: 42 },
    });
  });

  it("bounds logs and serialized output", async () => {
    expect((await execute("for (let i = 0; i < 101; i++) log(i);")).ok).toBe(
      false,
    );
    expect((await execute('return "x".repeat(1100000);')).ok).toBe(false);
    expect((await execute("const a = {}; a.self = a; return a;")).ok).toBe(
      false,
    );
  });

  it("cancels an active worker and accepts a pre-cancelled signal", async () => {
    const controller = new AbortController();
    const pending = runTypeScript(
      "while (true) {}",
      {},
      5000,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toMatchObject({
      ok: false,
      errorCode: "FLOW_CANCELLED",
    });
    expect(
      await runTypeScript("return 1;", {}, 5000, controller.signal),
    ).toMatchObject({ ok: false, errorCode: "FLOW_CANCELLED" });
  });

  it("denies network by default through the async bridge", async () => {
    vi.stubEnv("RPA_SCRIPT_ALLOWED_ORIGINS", "");
    expect(
      await execute('return await http.get("https://example.com");'),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Destino no autorizado"),
    });
  });

  it("validates code, data and execution limits", async () => {
    for (const [code, data, timeout] of [
      ["", "{}", 1000],
      ["return 1", "bad json", 1000],
      ["return 1", "{}", 30001],
    ] as const)
      expect(await execute(code, data, timeout)).toMatchObject({
        ok: false,
        errorCode: "SCRIPT_VALIDATION_ERROR",
      });
  });

  it("passes results to following nodes and treats source code as literal", async () => {
    const flow = createWorkflow();
    flow.workflow.nodes.push(
      {
        id: "script",
        name: "Script",
        type: "rpa.action",
        typeVersion: 1,
        position: [300, 0],
        parameters: {
          actionId: scriptActionDefinition.id,
          input: {
            code: 'const value: string = input.value; log(value); return { value, literal: "{{input.value}}" };',
            data: { value: { $ref: "input.value" } },
          },
        },
      },
      {
        id: "set",
        name: "Resultado",
        type: "rpa.set",
        typeVersion: 1,
        position: [600, 0],
        parameters: { values: { result: { $ref: "last.result.value" } } },
      },
    );
    flow.workflow.connections = {
      Inicio: { main: [[{ node: "Script", type: "main", index: 0 }]] },
      Script: { main: [[{ node: "Resultado", type: "main", index: 0 }]] },
    };
    const result = await executeFlowDocument(
      flow,
      { input: { value: '"); throw new Error("injected"); //' } },
      {
        runAction: (id, input) => registry.execute(id, input, {}),
      },
    );
    expect(result.status).toBe("success");
    expect(result.outputs.vars.result).toBe(
      '"); throw new Error("injected"); //',
    );
    expect(result.nodeRuns[1]?.output).toMatchObject({
      result: { literal: "{{input.value}}" },
      logs: [[expect.any(String)]],
    });
  });
});
