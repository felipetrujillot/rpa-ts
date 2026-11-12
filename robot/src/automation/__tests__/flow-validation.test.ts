import { describe, expect, it } from "vitest";
import {
  createWorkflow,
  validateFlowDocument,
  isSchemaVersionCompatible,
  workflowToDiagram,
  diagramToWorkflow,
  type WorkflowNode,
} from "@rpa/contracts";
const action: WorkflowNode = {
  id: "act",
  name: "Acción",
  type: "rpa.action",
  typeVersion: 1,
  position: [350, 160],
  parameters: { actionId: "test", input: { text: { $ref: "input.text" } } },
};
const sample = () => {
  const document = createWorkflow();
  document.workflow.nodes.push(structuredClone(action));
  document.workflow.connections = {
    Inicio: { main: [[{ node: "Acción", type: "main", index: 0 }]] },
  };
  return document;
};
describe("Shared workflow v2 contract", () => {
  it("validates node types, parameters and known action versions", () => {
    expect(
      validateFlowDocument(sample(), { knownActionIds: new Set(["test"]) }).ok,
    ).toBe(true);
    expect(
      validateFlowDocument(sample(), {
        knownActionIds: new Set([]),
      }).errors.some((error) => error.code === "UNKNOWN_ACTION"),
    ).toBe(true);
    const document = sample();
    expect(
      validateFlowDocument({
        ...document,
        workflow: {
          ...document.workflow,
          nodes: document.workflow.nodes.map((node) => ({
            ...node,
            typeVersion: 99,
          })),
        },
      }).ok,
    ).toBe(false);
  });
  it("rejects every older envelope and unknown properties rather than converting them", () => {
    expect(isSchemaVersionCompatible("2.0.0")).toBe(true);
    expect(isSchemaVersionCompatible("1.0.0")).toBe(false);
    expect(isSchemaVersionCompatible("2.1.0")).toBe(false);
    expect(
      validateFlowDocument({ ...sample(), schemaVersion: "1.0.0" }).ok,
    ).toBe(false);
    expect(validateFlowDocument({ ...sample(), flow: { steps: [] } }).ok).toBe(
      false,
    );
  });
  it("rejects duplicate names and IDs, invalid ports and missing targets", () => {
    const document = sample();
    document.workflow.nodes.push({ ...action });
    const codes = validateFlowDocument(document).errors.map(
      (error) => error.code,
    );
    expect(codes).toContain("DUPLICATE_NODE_ID");
    expect(codes).toContain("DUPLICATE_NODE_NAME");
    const broken = sample();
    broken.workflow.connections.Inicio = {
      main: [
        [{ node: "missing", type: "main", index: 0 }],
        [{ node: "Inicio", type: "main", index: 0 }],
      ],
    };
    expect(
      validateFlowDocument(broken).errors.map((error) => error.code),
    ).toEqual(expect.arrayContaining(["INVALID_REFERENCE", "INVALID_PORT"]));
  });
  it("rejects unreachable nodes and uncontrolled cycles", () => {
    const disconnected = sample();
    disconnected.workflow.connections = {};
    expect(
      validateFlowDocument(disconnected).errors.map((error) => error.code),
    ).toContain("UNREACHABLE_NODE");
    const cyclic = sample();
    cyclic.workflow.connections["Acción"] = {
      main: [[{ node: "Acción", type: "main", index: 0 }]],
    };
    expect(
      validateFlowDocument(cyclic).errors.map((error) => error.code),
    ).toContain("UNBOUNDED_CYCLE");
  });
  it("preserves positions, ports, parameters, notes and renamed connections through the designer", () => {
    const document = sample();
    document.workflow.nodes[1]!.notes = "No perder";
    const diagram = workflowToDiagram(document);
    diagram.nodes[1]!.data.node.name = "Renombrada";
    diagram.nodes[1]!.position = { x: 910, y: 200 };
    const saved = diagramToWorkflow(document, diagram.nodes, diagram.edges);
    expect(saved.workflow.connections.Inicio!.main[0]![0]!.node).toBe(
      "Renombrada",
    );
    expect(saved.workflow.nodes[1]).toMatchObject({
      position: [910, 200],
      notes: "No perder",
      parameters: action.parameters,
    });
    expect(validateFlowDocument(saved).ok).toBe(true);
  });
  it("rejects reserved object keys and unsafe data paths", () => {
    const document = sample();
    (document.workflow.nodes[1] as typeof action).parameters.input = {
      text: { $ref: "vars.__proto__.polluted" },
    };
    expect(validateFlowDocument(document).ok).toBe(false);
    expect(
      validateFlowDocument(
        JSON.parse(JSON.stringify(sample()).replace('"text"', '"__proto__"')),
      ).ok,
    ).toBe(false);
  });
});
