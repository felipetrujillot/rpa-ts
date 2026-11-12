import { describe, expect, it, vi } from "vitest";
import { createWorkflow, excelPluginRequirement, type FlowDocument } from "@rpa/contracts";
import { executeFlowDocument } from "../flow/runner";
function flow(): FlowDocument {
  const d = createWorkflow();
  d.workflow.nodes.push(
    { id: "a", name: "a", type: "rpa.action", typeVersion: 1, position: [0, 0], onError: "continueRegularOutput", parameters: { actionId: "sample.write", input: {} } },
    { id: "b", name: "b", type: "rpa.action", typeVersion: 1, position: [0, 0], parameters: { actionId: "excel.workbook.close", input: { workbookId: "book", saveChanges: false } } },
  );
  d.workflow.connections = { Inicio: { main: [[{ node: "a", type: "main", index: 0 }]] }, a: { main: [[{ node: "b", type: "main", index: 0 }]] } };
  return d;
}
const inventory = () => ({ sampledAt: new Date().toISOString(), plugins: [{ ...excelPluginRequirement(["excel.workbook.close"]), available: true, platform: "darwin", capabilities: [], permissions: [], verified: false }] });
describe("Excel execution admission and uncertainty", () => {
  it("validates all plugin versions before the first workflow effect", async () => {
    const runAction = vi.fn(async () => ({ ok: true, message: "ok" }));
    const doc = flow();
    let result = await executeFlowDocument(doc, {}, { runAction });
    expect(result.error?.code).toBe("PLUGIN_INCOMPATIBLE"); expect(runAction).not.toHaveBeenCalled();
    doc.pluginRequirements = [excelPluginRequirement(["excel.workbook.close"])];
    doc.pluginRequirements[0]!.actions["excel.workbook.close"] = "2.0.0";
    result = await executeFlowDocument(doc, {}, { runAction, plugins: inventory() });
    expect(result.error?.code).toBe("PLUGIN_INCOMPATIBLE"); expect(runAction).not.toHaveBeenCalled();
  });
  it("halts uncertain effects despite continueRegularOutput, retaining the error code", async () => {
    const runAction = vi.fn(async () => ({ ok: false, message: "Timeout after submission", errorCode: "ACTION_EFFECT_UNCERTAIN" }));
    const result = await executeFlowDocument(flow(), {}, { runAction, plugins: inventory() });
    expect(result.status).toBe("failed"); expect(result.error?.code).toBe("ACTION_EFFECT_UNCERTAIN");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("preserves matrix and primitive types through numeric reference paths", async () => {
    const doc = flow();
    if (doc.workflow.nodes[2]!.type === "rpa.action") doc.workflow.nodes[2]!.parameters = { actionId: "sample.read", input: { value: { $ref: "last.values.0.1" }, matrix: { $ref: "last.values" } } };
    const runAction = vi.fn().mockResolvedValueOnce({ ok: true, message: "ok", output: { values: [["001", false], [null, 0]] } }).mockResolvedValueOnce({ ok: true, message: "ok" });
    expect((await executeFlowDocument(doc, {}, { runAction })).status).toBe("success");
    expect(runAction.mock.calls[1]![1]).toEqual({ value: false, matrix: [["001", false], [null, 0]] });
  });
});
