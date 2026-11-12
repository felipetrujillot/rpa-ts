import { createWorkflow } from "@rpa/contracts";
import { expect, it, vi } from "vitest";
import { PlaywrightRuntime } from "../../src/automation/apps/playwright.runtime";
import { executeFlowDocument } from "../../src/automation/flow/runner";
import { ExecutionController } from "../../src/automation/flow/execution-controller";
import type { FlowDocument } from "../../src/automation/flow/types";

it("closes a real browser action before releasing the desktop and skips subsequent actions", async () => {
  const runtime = new PlaywrightRuntime({
    headless: true,
    executablePath: process.env.RPA_BROWSER_EXECUTABLE_PATH,
    channel: process.env.RPA_BROWSER_CHANNEL,
  });
  const executions = new ExecutionController();
  const signal = executions.begin("browser-cancel", 1);
  const document: FlowDocument = createWorkflow(
    "Browser cancellation",
    "browser-cancel",
  );
  document.workflow.nodes.push(
    {
      id: "wait",
      name: "wait",
      type: "rpa.action",
      typeVersion: 1,
      position: [300, 100],
      parameters: { actionId: "wait", input: {} },
    },
    {
      id: "must-not-run",
      name: "must-not-run",
      type: "rpa.action",
      typeVersion: 1,
      position: [600, 100],
      parameters: { actionId: "side-effect", input: {} },
    },
  );
  document.workflow.connections = {
    Inicio: { main: [[{ node: "wait", type: "main", index: 0 }]] },
    wait: { main: [[{ node: "must-not-run", type: "main", index: 0 }]] },
  };
  try {
    const tab = (await runtime.openTab({
      url: "data:text/html,<title>Cancellation test</title><p>Ready</p>",
    })) as { tabId: string };
    let started!: () => void;
    const actionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runAction = vi.fn(async () => {
      const pending = runtime.waitForElement({
        tabId: tab.tabId,
        selector: "#never-created",
        timeoutMs: 60000,
      });
      started();
      try {
        await pending;
        return { ok: true, message: "unexpected completion" };
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    });
    const run = executeFlowDocument(
      document,
      {},
      { runAction },
      { signal },
    ).finally(() => executions.finish("browser-cancel"));
    await actionStarted;
    const stop = executions.stopAll(() => runtime.shutdown());
    expect(executions.busy).toBe(true);
    await stop;
    const result = await run;
    expect(result.status).toBe("cancelled");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(executions.busy).toBe(false);
    await expect(runtime.switchTab({ tabId: tab.tabId })).rejects.toThrow();
  } finally {
    await runtime.shutdown();
  }
});
