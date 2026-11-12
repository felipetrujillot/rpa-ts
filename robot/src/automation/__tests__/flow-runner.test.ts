import { describe, expect, it, vi } from "vitest";
import {
  createWorkflow,
  type WorkflowNode,
  type FlowDocument,
} from "@rpa/contracts";
import { executeFlowDocument } from "../flow/runner";
const node = (
  id: string,
  type: WorkflowNode["type"],
  parameters: unknown = {},
): WorkflowNode =>
  ({
    id,
    name: id,
    type,
    typeVersion: 1,
    position: [0, 0],
    parameters,
  }) as WorkflowNode;
const workflow = (
  nodes: WorkflowNode[],
  links: Record<string, string[][]>,
): FlowDocument => {
  const document = createWorkflow();
  document.workflow.nodes.push(...nodes);
  document.workflow.connections = Object.fromEntries(
    Object.entries(links).map(([source, ports]) => [
      source,
      {
        main: ports.map((targets) =>
          targets.map((name) => ({
            node: name,
            type: "main" as const,
            index: 0 as const,
          })),
        ),
      },
    ]),
  );
  return document;
};
describe("Node graph execution", () => {
  it("routes true and false ports and resolves typed values between connected nodes", async () => {
    const document = workflow(
      [
        node("set", "rpa.set", {
          values: { enabled: { $ref: "input.enabled" } },
        }),
        node("if", "rpa.if", {
          condition: { op: "truthy", value: { $ref: "vars.enabled" } },
        }),
        node("yes", "rpa.action", {
          actionId: "yes",
          input: { text: { $ref: "input.text" } },
        }),
        node("no", "rpa.action", { actionId: "no", input: {} }),
      ],
      { Inicio: [["set"]], set: [["if"]], if: [["yes"], ["no"]] },
    );
    const runAction = vi.fn(async () => ({
      ok: true,
      message: "ok",
      output: { value: 42 },
    }));
    const result = await executeFlowDocument(
      document,
      { input: { enabled: true, text: "hola" } },
      { runAction },
    );
    expect(result.status).toBe("success");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith("yes", { text: "hola" });
    expect(result.nodeRuns.map((run) => run.nodeId)).toEqual([
      "start",
      "set",
      "if",
      "yes",
    ]);
    runAction.mockClear();
    await executeFlowDocument(
      document,
      { input: { enabled: false } },
      { runAction },
    );
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith("no", {});
  });
  it("runs fan-out deterministically and passes each branch its upstream JSON", async () => {
    const document = workflow(
      [
        node("source", "rpa.action", { actionId: "source", input: {} }),
        node("a", "rpa.action", {
          actionId: "a",
          input: { number: { $ref: "json.number" } },
        }),
        node("b", "rpa.action", {
          actionId: "b",
          input: { number: { $ref: "json.number" } },
        }),
      ],
      { Inicio: [["source"]], source: [["a", "b"]] },
    );
    const runAction = vi.fn(async (action: string) => ({
      ok: true,
      message: action,
      output: action === "source" ? { number: 42 } : { number: 0 },
    }));
    expect(
      (await executeFlowDocument(document, {}, { runAction })).status,
    ).toBe("success");
    expect(runAction.mock.calls.map((call) => call[0])).toEqual([
      "source",
      "a",
      "b",
    ]);
    expect(runAction.mock.calls[2]).toEqual(["b", { number: 42 }]);
  });
  it("executes bounded loop back-edges, foreach values and the done output", async () => {
    const document = workflow(
      [
        node("loop", "rpa.forEach", {
          items: { $ref: "input.items" },
          itemVar: "item",
          indexVar: "index",
          maxIterations: 3,
        }),
        node("body", "rpa.action", {
          actionId: "body",
          input: { text: { $ref: "vars.item" } },
        }),
        node("end", "rpa.end"),
      ],
      { Inicio: [["loop"]], loop: [["body"], ["end"]], body: [["loop"]] },
    );
    const runAction = vi.fn(async () => ({ ok: true, message: "ok" }));
    const result = await executeFlowDocument(
      document,
      { input: { items: ["uno", "dos"] } },
      { runAction },
    );
    expect(result.status).toBe("success");
    expect(runAction.mock.calls).toEqual([
      ["body", { text: "uno" }],
      ["body", { text: "dos" }],
    ]);
    expect(result.nodeRuns.at(-1)?.nodeId).toBe("end");
  });
  it("limits while cycles and never retries native effects", async () => {
    const document = workflow(
      [
        node("loop", "rpa.while", {
          condition: { op: "truthy", value: true },
          maxIterations: 2,
        }),
        node("body", "rpa.action", { actionId: "click", input: {} }),
      ],
      { Inicio: [["loop"]], loop: [["body"], []], body: [["loop"]] },
    );
    const runAction = vi.fn(async () => ({ ok: true, message: "ok" }));
    const result = await executeFlowDocument(document, {}, { runAction });
    expect(result.error?.code).toBe("LOOP_LIMIT");
    expect(runAction).toHaveBeenCalledTimes(2);
  });
  it("passes through disabled nodes and records errors according to the node policy", async () => {
    const disabled = node("disabled", "rpa.action", {
      actionId: "disabled",
      input: {},
    });
    disabled.disabled = true;
    const failing = node("failing", "rpa.action", {
      actionId: "failing",
      input: {},
    });
    failing.onError = "continueRegularOutput";
    const document = workflow([disabled, failing, node("end", "rpa.end")], {
      Inicio: [["disabled"]],
      disabled: [["failing"]],
      failing: [["end"]],
    });
    const runAction = vi.fn(async () => ({ ok: false, message: "failed" }));
    const result = await executeFlowDocument(document, {}, { runAction });
    expect(result.status).toBe("success");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(
      result.nodeRuns.find((run) => run.nodeId === "failing")?.status,
    ).toBe("failed");
  });
});
