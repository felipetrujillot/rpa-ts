import { createWorkflow } from "@rpa/contracts";
import { describe, expect, it, vi } from "vitest";
import { ExecutionController } from "../flow/execution-controller";
import { executeFlowDocument } from "../flow/runner";
import type { FlowDocument } from "../flow/types";

const document: FlowDocument = createWorkflow("Cancel", "cancel");
document.workflow.nodes.push(
  {
    id: "first",
    name: "first",
    type: "rpa.action",
    typeVersion: 1,
    position: [300, 100],
    onError: "continueRegularOutput",
    parameters: { actionId: "test", input: {} },
  },
  {
    id: "second",
    name: "second",
    type: "rpa.action",
    typeVersion: 1,
    position: [600, 100],
    parameters: { actionId: "test", input: {} },
  },
);
document.workflow.connections = {
  Inicio: { main: [[{ node: "first", type: "main", index: 0 }]] },
  first: { main: [[{ node: "second", type: "main", index: 0 }]] },
};
describe("Desktop cancellation", () => {
  it("waits for the active action to settle and prevents subsequent actions", async () => {
    const controller = new AbortController();
    let settle!: (value: { ok: boolean; message: string }) => void;
    const runAction = vi.fn(
      () =>
        new Promise<{ ok: boolean; message: string }>((resolve) => {
          settle = resolve;
        }),
    );
    let finished = false;
    const pending = executeFlowDocument(
      document,
      {},
      { runAction },
      { signal: controller.signal },
    ).then((result) => {
      finished = true;
      return result;
    });
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    settle({ ok: true, message: "stopped" });
    expect((await pending).status).toBe("cancelled");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("does not follow continue-on-error when cancellation interrupts an action", async () => {
    const controller = new AbortController();
    const runAction = vi.fn(async () => {
      controller.abort();
      throw new Error("browser closed");
    });
    const result = await executeFlowDocument(
      document,
      {},
      { runAction },
      { signal: controller.signal },
    );
    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("FLOW_CANCELLED");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("performs no action for a pre-cancelled execution", async () => {
    const controller = new AbortController();
    controller.abort();
    const runAction = vi.fn();
    expect(
      (
        await executeFlowDocument(
          document,
          {},
          { runAction },
          { signal: controller.signal },
        )
      ).status,
    ).toBe("cancelled");
    expect(runAction).not.toHaveBeenCalled();
  });
  it("keeps the desktop reserved until finish and refuses competing owners", () => {
    const executions = new ExecutionController();
    const signal = executions.begin("one", 1);
    expect(() => executions.begin("two", 1)).toThrow();
    expect(() => executions.cancel("one", 2)).toThrow();
    expect(executions.cancel("one", 1)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(executions.busy).toBe(true);
    expect(() => executions.begin("two", 1)).toThrow();
    executions.finish("one");
    expect(executions.busy).toBe(false);
    expect(() => executions.begin("one", 1)).toThrow();
    expect(executions.begin("two", 1).aborted).toBe(false);
  });
  it("remembers a cancellation received before dispatch", () => {
    const executions = new ExecutionController();
    expect(executions.cancel("one", 1)).toBe(false);
    expect(() => executions.begin("one", 1)).toThrow();
  });
});
