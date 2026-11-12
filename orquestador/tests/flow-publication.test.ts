import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeFlowChecksum,
  createWorkflow,
  pinBuiltinPluginRequirements,
  scriptSdkActionIds,
  type FlowDocument,
} from "@rpa/contracts";
import { flowsTrpc } from "../server/trpc/routers/flows";
import type { Principal } from "../server/auth/principal";

const mock = vi.hoisted(() => {
  const state = { rows: [] as unknown[] };
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
    orderBy: vi.fn(),
    then: (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(state.rows).then(resolve),
  };
  for (const method of [
    query.from,
    query.where,
    query.limit,
    query.for,
    query.orderBy,
  ])
    method.mockReturnValue(query);
  const values = vi.fn(async (_value: Record<string, unknown>) => undefined);
  const set = vi.fn((_value: Record<string, unknown>) => ({
    where: vi.fn(async () => undefined),
  }));
  const db = {
    select: vi.fn(() => query),
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set })),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (fn) => fn(db));
  return { state, values, set, db };
});
vi.mock("../server/db", () => ({ db: mock.db }));

const caller = flowsTrpc.createCaller({
  user: {
    tipo: "usuario",
    uuid_empresa: "company-a",
    uuid_usuario: "admin",
    role: 1,
    activo: 1,
  } as Principal,
  publicIp: "test",
  requestId: "test",
});
const ids = { uuid_flujo: "flow-a", uuid_flow_version: "version-a" };

function scriptDocument(allowedActions = scriptSdkActionIds): FlowDocument {
  const document = createWorkflow("Script");
  document.workflow.nodes.push({
    id: "script",
    name: "Script",
    type: "rpa.action",
    typeVersion: 1,
    position: [100, 0],
    parameters: {
      actionId: "script.typescript.run",
      input: { code: "return 1;", allowedActions },
    },
  });
  document.workflow.connections.Inicio = {
    main: [[{ node: "Script", type: "main", index: 0 }]],
  };
  return document;
}

// JSON databases may return object keys in a different order after storage.
function reorderJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reorderJson(entry)]),
    );
  return value;
}

function storedVersion(document: unknown) {
  mock.state.rows = [
    {
      ...ids,
      version_number: 1,
      schema_version: "2.0.0",
      definition_json: document,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.state.rows = [];
});

describe("flow plugin publication", () => {
  it("saves and publishes a script with every SDK action after JSON keys are reordered", async () => {
    mock.state.rows = [{ uuid_flujo: ids.uuid_flujo }];
    const draft = await caller.createDraft({
      uuid_flujo: ids.uuid_flujo,
      nombre: "Script",
      document: scriptDocument(),
    });
    const saved = mock.values.mock.calls[0]![0] as unknown as {
      definition_json: FlowDocument;
      checksum: string;
    };
    expect(
      saved.definition_json.pluginRequirements?.map((p) => p.pluginId),
    ).toEqual(["excel", "word"]);
    expect(saved.checksum).toBe(
      await computeFlowChecksum(saved.definition_json),
    );
    const checksum = saved.checksum;
    const restored = reorderJson(saved.definition_json) as FlowDocument;
    storedVersion(restored);
    mock.set.mockClear();
    await expect(
      caller.publishVersion({
        uuid_flujo: ids.uuid_flujo,
        uuid_flow_version: draft.data.uuid_flow_version,
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(mock.set).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "published" }),
    );
    expect(await computeFlowChecksum(restored)).toBe(checksum);
    expect(
      mock.set.mock.calls.every(
        ([value]) => !("definition_json" in value) && !("checksum" in value),
      ),
    ).toBe(true);
  });

  it("still rejects missing action pins before changing publication state", async () => {
    const document = pinBuiltinPluginRequirements(scriptDocument());
    delete document.pluginRequirements![0]!.actions["excel.workbook.open"];
    storedVersion(document);
    await expect(caller.publishVersion(ids)).rejects.toThrow(
      /fijar los requisitos de plugins/,
    );
    expect(mock.set).not.toHaveBeenCalled();
  });

  it("still rejects incompatible pinned contracts", async () => {
    const document = pinBuiltinPluginRequirements(scriptDocument());
    document.pluginRequirements![0]!.actions["excel.workbook.open"] = "2.0.0";
    storedVersion(reorderJson(document));
    await expect(caller.publishVersion(ids)).rejects.toThrow(/incompatibles/);
    expect(mock.set).not.toHaveBeenCalled();
  });

  it("publishes scripts that do not require plugins", async () => {
    storedVersion(scriptDocument(["playwright.browser.openTab"]));
    await expect(caller.publishVersion(ids)).resolves.toMatchObject({
      status: "ok",
    });
  });
});
