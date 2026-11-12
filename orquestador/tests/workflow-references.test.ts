import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@rpa/contracts";
import {
  dataReferences,
  describeReference,
  referenceExampleValue,
  referencePath,
  scriptInputDescription,
  upstreamNodeIds,
  type ReferenceExample,
} from "../layers/admin/app/utils/workflow-references";

const source: WorkflowNode = {
  id: "source-id",
  name: "Obtener cliente",
  type: "rpa.action",
  typeVersion: 1,
  position: [0, 0],
  parameters: {
    actionId: "script.typescript.run",
    input: { code: "return {};", data: {} },
  },
};
const consumer: WorkflowNode = {
  ...source,
  id: "consumer-id",
  name: "Saludar",
  parameters: {
    actionId: "script.typescript.run",
    input: {
      code: "return input;",
      data: { $ref: "nodeOutputs.source-id.result" },
    },
  },
};
const nodes = [source, consumer];
const example: ReferenceExample = {
  runId: "run-id",
  date: "2026-01-01",
  versionId: "v1",
  context: {
    input: { cliente: { nombre: "Felipe" } },
    vars: { clientes: [{ id: 7 }] },
    nodeOutputs: { "source-id": { result: { nombre: "Felipe" }, logs: [] } },
  },
};

describe("script data references", () => {
  it("uses node IDs and keeps the human label in sync with renames", () => {
    expect(scriptInputDescription(consumer, nodes)?.label).toBe(
      "Obtener cliente · resultado",
    );
    expect(
      scriptInputDescription(consumer, [
        { ...source, name: "Consultar cliente" },
        consumer,
      ])?.label,
    ).toBe("Consultar cliente · resultado");
    expect(referencePath(consumer.parameters.input.data)).toBe(
      "nodeOutputs.source-id.result",
    );
    expect(
      referenceExampleValue(consumer.parameters.input.data, example, nodes),
    ).toEqual({ value: { nombre: "Felipe" } });
  });
  it("marks deleted, self, disabled and disconnected sources", () => {
    expect(scriptInputDescription(consumer, [consumer])?.label).toBe(
      "Referencia sin origen",
    );
    expect(scriptInputDescription(consumer, [consumer])?.warning).toContain(
      "ya no existe",
    );
    expect(
      describeReference("nodeOutputs.consumer-id.result", nodes, consumer.id)
        .warning,
    ).toContain("propio resultado");
    expect(
      describeReference("nodeOutputs.source-id.result", [
        { ...source, disabled: true },
      ]).warning,
    ).toContain("deshabilitado");
    expect(scriptInputDescription(consumer, nodes, [])?.warning).toContain(
      "no está conectado antes",
    );
  });
  it("finds upstream sources through intermediate steps and terminates on cycles", () => {
    const edges = [
      { source: source.id, target: "middle" },
      { source: "middle", target: consumer.id },
      { source: consumer.id, target: "middle" },
      { source: consumer.id, target: "future" },
    ];
    const available = upstreamNodeIds(consumer.id, edges);
    expect(available).toEqual(["middle", source.id]);
    expect(
      scriptInputDescription(consumer, nodes, available)?.warning,
    ).toBeUndefined();
  });
  it("supports nested JSON, legacy templates, variables and array indices", () => {
    const data = {
      cliente: { $ref: "input.cliente" },
      id: { $ref: "vars.clientes.0.id" },
      otra: "{{nodeOutputs.source-id.result}}",
    };
    expect(dataReferences(data)).toEqual([
      "input.cliente",
      "vars.clientes.0.id",
      "nodeOutputs.source-id.result",
    ]);
    expect(referenceExampleValue(data, example, nodes)).toEqual({
      value: {
        cliente: { nombre: "Felipe" },
        id: 7,
        otra: { nombre: "Felipe" },
      },
    });
    expect(referencePath("{{ last.result }}")).toBe("last.result");
    expect(
      referenceExampleValue(
        '{"nombre":"{{input.cliente.nombre}}"}',
        example,
        nodes,
      ),
    ).toEqual({ value: { nombre: "Felipe" } });
    expect(
      scriptInputDescription(
        {
          ...consumer,
          parameters: { actionId: "script.typescript.run", input: { data } },
        },
        nodes,
      )?.label,
    ).toBe("JSON con 3 referencias");
  });
  it("never fabricates missing, dynamic or private historical values", () => {
    expect(describeReference("nodeOutputs", nodes).label).toBe(
      "Salidas de todos los pasos",
    );
    expect(
      referenceExampleValue({ $ref: "nodeOutputs" }, example, [
        { ...source, sensitiveOutput: true },
      ]).unavailable,
    ).toContain("protegidas");
    expect(
      referenceExampleValue({ $ref: "input.noExiste" }, example, nodes)
        .unavailable,
    ).toContain("no contiene datos");
    expect(
      referenceExampleValue({ $ref: "last.result" }, example, nodes)
        .unavailable,
    ).toContain("recorrido");
    expect(
      referenceExampleValue({ $ref: "nodeOutputs.source-id.result" }, example, [
        { ...source, sensitiveOutput: true },
      ]).unavailable,
    ).toContain("protegida");
    expect(
      referenceExampleValue({ $ref: "input.__proto__" }, example, nodes)
        .unavailable,
    ).toContain("inválida");
    expect(describeReference("input.constructor", nodes).warning).toContain(
      "reservadas",
    );
    expect(
      referenceExampleValue("texto sin JSON", example, nodes).unavailable,
    ).toContain("JSON válido");
    expect(
      referenceExampleValue({ $ref: "input.toString" }, example, nodes)
        .unavailable,
    ).toContain("no contiene datos");
  });
});
