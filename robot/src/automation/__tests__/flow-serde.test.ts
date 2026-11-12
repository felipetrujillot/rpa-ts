import { describe, expect, it } from "vitest";
import {
  createWorkflow,
  serializeFlowDocument,
  deserializeFlowDocument,
  computeFlowChecksum,
} from "@rpa/contracts";
describe("Shared serialization", () => {
  it("round-trips all v2 fields and produces the same checksum for different property order", async () => {
    const document = createWorkflow();
    const serialized = serializeFlowDocument(document);
    expect(deserializeFlowDocument(serialized).normalized).toEqual(document);
    const reordered = {
      workflow: document.workflow,
      schemaVersion: document.schemaVersion,
      kind: document.kind,
    };
    expect(await computeFlowChecksum(document)).toBe(
      await computeFlowChecksum(reordered),
    );
    expect((await computeFlowChecksum(document)).length).toBe(64);
  });
  it("reports invalid JSON and rejects the old version", () => {
    expect(deserializeFlowDocument("{").errors[0]?.code).toBe("INVALID_JSON");
    expect(deserializeFlowDocument('{"schemaVersion":"1.0.0"}').ok).toBe(false);
  });
});
