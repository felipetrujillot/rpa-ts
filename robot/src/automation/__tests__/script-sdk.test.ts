import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflow,
  scriptSdkActionIds,
  type ActionRunResult,
  type AutomationInput,
} from "@rpa/contracts";
import { AutomationRegistry } from "../core/registry";
import { scriptApp } from "../apps/script.app";
import type { AutomationContext } from "../core/types";
import { runTypeScript } from "../scripts/run";
import { ScriptActionBroker } from "../scripts/actions";
import { executeFlowDocument } from "../flow/runner";
import { defaultAutomationApps } from "../apps";

const id = "playwright.browser.openTab";
const output = { tabId: "shared-tab", url: "https://example.com" };
const success: ActionRunResult = { ok: true, message: "ok", output };
const source =
  'return await rpa.browser.openTab({ url: "https://example.com" });';
let serverAllows = false;
const authorize = vi.fn(async () => serverAllows);
const permit = () => {
  serverAllows = true;
};
const run = (
  code = source,
  execute = vi.fn(async () => success),
  allowedActions: unknown = [id],
  signal?: AbortSignal,
) =>
  runTypeScript(code, {}, 5000, signal, { allowedActions, execute, authorize });
afterEach(() => {
  serverAllows = false;
  vi.unstubAllEnvs();
});

describe("isolated TypeScript SDK", () => {
  it("covers every built-in action except recursive scripts", () => {
    expect(new Set(scriptSdkActionIds)).toEqual(
      new Set(
        defaultAutomationApps
          .flatMap((app) => app.actions.map((a) => a.id))
          .filter((id) => !id.startsWith("script.")),
      ),
    );
  });

  it("executes aliases and generic actions serially, with typed JSON results and traces", async () => {
    permit();
    let active = 0;
    const execute = vi.fn(async () => {
      expect(active++).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return success;
    });
    const result = await run(
      `const values = await Promise.all([rpa.browser.openTab({}), rpa.actions.execute("${id}", {})]); return values.map(v => v.tabId);`,
      execute,
    );
    expect(result).toMatchObject({
      ok: true,
      result: ["shared-tab", "shared-tab"],
      actions: [
        { sequence: 1, actionId: id, status: "success", output },
        { sequence: 2, status: "success" },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.actions?.[0]).not.toHaveProperty("input");
  });

  it("requires both literal node permissions and the server policy", async () => {
    const execute = vi.fn(async () => success);
    vi.stubEnv("RPA_SCRIPT_ALLOWED_ACTIONS", id); // Legacy environment settings cannot grant access.
    serverAllows = false;
    expect(await run(source, execute)).toMatchObject({
      ok: false,
      errorCode: "SCRIPT_ACTION_DENIED",
    });
    permit();
    expect(await run(source, execute, [])).toMatchObject({
      ok: false,
      errorCode: "SCRIPT_ACTION_DENIED",
    });
    for (const invalid of [
      { $ref: "input.permissions" },
      ["script.typescript.run"],
      ["playwright.*"],
      [id, id],
    ])
      await expect(run(source, execute, invalid)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("checks current server policy before every call and denies when unavailable", async () => {
    permit();
    const execute = vi.fn(async () => {
      serverAllows = false;
      return success;
    });
    expect(
      await run(
        "await rpa.browser.openTab({}); return await rpa.browser.openTab({});",
        execute,
      ),
    ).toMatchObject({ ok: false, errorCode: "SCRIPT_ACTION_DENIED" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    const broken = vi.fn(async () => {
      throw new Error("server unavailable");
    });
    expect(
      await runTypeScript(source, {}, 5000, undefined, {
        allowedActions: [id],
        execute,
        authorize: broken,
      }),
    ).toMatchObject({ ok: false, errorCode: "SCRIPT_POLICY_UNAVAILABLE" });
    expect(
      await runTypeScript(source, {}, 5000, undefined, {
        allowedActions: [id],
        execute,
      }),
    ).toMatchObject({ ok: false, errorCode: "SCRIPT_ACTION_DENIED" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not execute if cancellation arrives while authorizing", async () => {
    permit();
    const controller = new AbortController();
    const execute = vi.fn(async () => success);
    const pending = runTypeScript(source, {}, 5000, controller.signal, {
      allowedActions: [id],
      execute,
      authorize: async () => {
        controller.abort();
        return true;
      },
    });
    expect(await pending).toMatchObject({
      ok: false,
      errorCode: "FLOW_CANCELLED",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("validates inputs and rejects unknown IDs even through the raw bridge", async () => {
    permit();
    const execute = vi.fn(async () => success);
    expect(
      await run("return await rpa.browser.openTab({ url: 42 });", execute),
    ).toMatchObject({ ok: false, errorCode: "SCRIPT_ACTION_INVALID" });
    expect(
      await run(
        'return await __action(JSON.stringify({actionId:"script.typescript.run",input:{}}));',
        execute,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await run('return await rpa.actions.execute("shell.exec", {});', execute),
    ).toMatchObject({ ok: false, errorCode: "SCRIPT_ACTION_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("lets scripts handle ordinary action errors using RpaActionError", async () => {
    permit();
    const execute = vi.fn(async () => ({
      ok: false,
      message: "not available",
      errorCode: "ACTION_UNAVAILABLE",
    }));
    expect(
      await run(
        `try { await rpa.browser.openTab({}); } catch (error) { return { typed: error instanceof RpaActionError, code: error.code, actionId: error.actionId }; }`,
        execute,
      ),
    ).toMatchObject({
      ok: true,
      result: { typed: true, code: "ACTION_UNAVAILABLE", actionId: id },
      actions: [{ status: "failed" }],
    });
  });

  it("does not let guest catch uncertain effects or execute a later flow node", async () => {
    permit();
    const execute = vi.fn(async () => ({
      ok: false,
      message: "interrupted",
      errorCode: "ACTION_EFFECT_UNCERTAIN",
    }));
    const code =
      'try { await rpa.browser.openTab({}); } catch {} return "ignored";';
    expect(await run(code, execute)).toMatchObject({
      ok: false,
      errorCode: "ACTION_EFFECT_UNCERTAIN",
      actions: [{ status: "uncertain" }],
    });
    const flow = createWorkflow();
    flow.workflow.nodes.push(
      {
        id: "script",
        name: "Script",
        type: "rpa.action",
        typeVersion: 1,
        position: [200, 0],
        onError: "continueRegularOutput",
        parameters: {
          actionId: "script.typescript.run",
          input: { code, allowedActions: [id] },
        },
      },
      {
        id: "next",
        name: "Next",
        type: "rpa.set",
        typeVersion: 1,
        position: [400, 0],
        parameters: { values: { reached: true } },
      },
    );
    flow.workflow.connections = {
      Inicio: { main: [[{ node: "Script", type: "main", index: 0 }]] },
      Script: { main: [[{ node: "Next", type: "main", index: 0 }]] },
    };
    const result = await executeFlowDocument(
      flow,
      {},
      {
        runAction: async () => {
          const result = await run(code, execute);
          return {
            ok: result.ok,
            message: result.error ?? "",
            errorCode: result.errorCode,
            output: { actions: result.actions },
          } as ActionRunResult;
        },
      },
    );
    expect(result.status).toBe("failed");
    expect(result.outputs.vars).not.toHaveProperty("reached");
  });

  it("shares native sessions with visual actions through the registry", async () => {
    permit();
    const registry = new AutomationRegistry();
    registry.registerApp(scriptApp);
    const context: AutomationContext = { authorizeScriptAction: authorize };
    registry.registerAction({
      id,
      appId: "playwright",
      name: "test",
      description: "test",
      run: async (_input, child) => {
        child.appContexts!.session ??= output;
        expect(child.appContexts).toBe(context.appContexts);
        return {
          ...success,
          output: child.appContexts!.session as AutomationInput,
        };
      },
    });
    expect((await registry.execute(id, {}, context)).ok).toBe(true);
    expect(
      await registry.execute(
        "script.typescript.run",
        { code: source, allowedActions: [id] },
        context,
      ),
    ).toMatchObject({ ok: true, output: { result: output } });
    expect(context.pendingActions?.size).toBe(0);
  });

  it("cancels the active action, aborts queued calls and records uncertain effects", async () => {
    permit();
    const controller = new AbortController();
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute = vi.fn(
      async (_id: string, _input: AutomationInput, signal: AbortSignal) => {
        started();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return success;
      },
    );
    const pending = run(
      "await Promise.all([rpa.browser.openTab({}), rpa.browser.openTab({})]);",
      execute,
      [id],
      controller.signal,
    );
    await active;
    controller.abort();
    const cancelled = await pending;
    expect(cancelled).toMatchObject({
      ok: false,
      errorCode: "ACTION_EFFECT_UNCERTAIN",
    });
    expect(cancelled.actions?.[0]?.status).toBe("uncertain");
    expect(
      cancelled.actions?.slice(1).every((trace) => trace.status === "failed"),
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![2].aborted).toBe(true);
  });

  it("marks invalid/oversized native results uncertain instead of retrying", async () => {
    permit();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      {},
      { ...output, data: "x".repeat(1100000) },
      cyclic,
      { ...output, value: 1n },
    ]) {
      const execute = vi.fn(async () => ({
        ...success,
        output: value as AutomationInput,
      }));
      expect(await run(source, execute)).toMatchObject({
        ok: false,
        errorCode: "ACTION_EFFECT_UNCERTAIN",
      });
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it("fails when scripts finish without awaiting an action", async () => {
    permit();
    const execute = vi.fn(
      async (_id: string, _input: AutomationInput, signal: AbortSignal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return success;
      },
    );
    const result = await run(
      'rpa.browser.openTab({}); return "done";',
      execute,
    );
    expect(result.ok).toBe(false);
    expect(["SCRIPT_UNAWAITED_ACTION", "ACTION_EFFECT_UNCERTAIN"]).toContain(
      result.errorCode,
    );
    expect(execute.mock.calls.every((call) => call[2].aborted)).toBe(true);
  });

  it("shares the total deadline with native actions and stops on executor crashes", async () => {
    permit();
    const controller = new AbortController();
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute = vi.fn(
      async (_id: string, _input: AutomationInput, signal: AbortSignal) => {
        started();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return success;
      },
    );
    const result = runTypeScript(source, {}, 1500, controller.signal, {
      allowedActions: [id],
      execute,
      authorize,
    });
    await active;
    expect(await result).toMatchObject({
      ok: false,
      errorCode: "ACTION_EFFECT_UNCERTAIN",
    });
    expect(execute.mock.calls[0]![2].aborted).toBe(true);
    expect(
      await run(
        source,
        vi.fn(async () => {
          throw new Error("transport lost");
        }),
      ),
    ).toMatchObject({ ok: false, errorCode: "ACTION_EFFECT_UNCERTAIN" });
  });

  it("preserves the action and original executor error without retrying or allowing continuation", async () => {
    permit();
    const execute = vi.fn(async () => {
      throw new Error("browserType.launch: Executable doesn't exist");
    });
    const result = await run(
      'try { await rpa.browser.openTab({}); } catch {} return await rpa.browser.openTab({});',
      execute,
    );
    expect(result).toMatchObject({
      ok: false,
      errorCode: "ACTION_EFFECT_UNCERTAIN",
      error: expect.stringContaining("browserType.launch: Executable doesn't exist"),
      actions: [{ actionId: id, status: "uncertain" }],
    });
    expect(result.error).toContain(id);
    expect(result.actions?.[0]?.message).toBe(result.error);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects excess pending calls on the host and never starts aborted queued work", async () => {
    permit();
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notify!: () => void;
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const execute = vi.fn(async () => {
      notify();
      await gate;
      return success;
    });
    const fatal = vi.fn();
    const broker = new ScriptActionBroker(
      [id],
      execute,
      controller.signal,
      Date.now() + 5000,
      fatal,
      authorize,
    );
    const pending = Array.from({ length: 4 }, () =>
      broker.request({ actionId: id, input: {} }),
    );
    const settled = Promise.allSettled(pending);
    await expect(
      broker.request({ actionId: id, input: {} }),
    ).rejects.toMatchObject({ code: "SCRIPT_LIMIT" });
    await started;
    controller.abort();
    release();
    await settled;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      broker.traces.slice(1).every((trace) => trace.status === "failed"),
    ).toBe(true);
  });

  it("limits host calls, clamps action timeouts and bounds stored evidence", async () => {
    permit();
    const execute = vi.fn(async (_id: string, input: AutomationInput) => ({
      ok: true,
      message: "ok",
      output: {
        tabId: "t",
        selector: "x",
        state: "visible",
        timeoutMs: input.timeoutMs,
        extra: "x".repeat(70000),
      },
    }));
    const broker = new ScriptActionBroker(
      ["playwright.page.waitForElement"],
      execute,
      new AbortController().signal,
      Date.now() + 5000,
      vi.fn(),
      authorize,
    );
    for (let i = 0; i < 100; i++)
      await broker.request({
        actionId: "playwright.page.waitForElement",
        input: { selector: "x", timeoutMs: 10000 },
      });
    await expect(
      broker.request({ actionId: "playwright.page.waitForElement", input: {} }),
    ).rejects.toMatchObject({ code: "SCRIPT_LIMIT" });
    expect(Number(execute.mock.calls[0]![1].timeoutMs)).toBeLessThanOrEqual(
      5000,
    );
    expect(broker.traces[0]?.output).toBeDefined();
    expect(broker.traces[1]?.outputOmitted).toBe(true);
  });
});
