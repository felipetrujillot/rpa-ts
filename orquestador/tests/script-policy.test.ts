import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { router } from "../server/trpc/trpc";
import * as policy from "../server/trpc/routers/agentes/scriptPolicy";
import type { Principal } from "../server/auth/principal";

const mock = vi.hoisted(() => {
  const state = { rows: [] as Array<{ actions: unknown; state?: string }> };
  const where = vi.fn();
  const query = {
    from: vi.fn(),
    where,
    limit: vi.fn(),
    for: vi.fn(),
    then: (
      resolve: (rows: typeof state.rows) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(state.rows).then(resolve, reject),
  };
  query.from.mockReturnValue(query);
  where.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.for.mockReturnValue(query);
  const values = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const db = {
    select: vi.fn(() => query),
    update: vi.fn(() => ({ set })),
    insert: vi.fn(() => ({ values })),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (fn) => fn(db));
  return { state, query, where, values, set, db };
});
vi.mock("../server/db", () => ({ db: mock.db }));
const api = router(policy);
const caller = (role = 1, robot = false) =>
  api.createCaller({
    user: {
      tipo: robot ? "agente" : "usuario",
      uuid_empresa: "company-a",
      uuid_usuario: "admin",
      uuid_agente: "robot-a",
      session_id: "session-a",
      role,
      activo: 1,
      email: "a@example.com",
      nombre: "test",
      exp: 9999999999,
    } as Principal,
    publicIp: "test",
    requestId: "test",
  });
const id = "playwright.browser.openTab";
beforeEach(() => {
  vi.clearAllMocks();
  mock.state.rows = [{ actions: null, state: "online" }];
});
describe("server-managed script policy", () => {
  it("starts denied and reads current grants for the authenticated robot only", async () => {
    expect(
      await caller(1, true).authorizeScriptAction({ actionId: id }),
    ).toEqual({ allowed: false });
    const query = new MySqlDialect().sqlToQuery(mock.where.mock.calls[0]![0]);
    expect(query.params).toEqual(["company-a", "robot-a", "session-a"]);
    mock.state.rows = [{ actions: [id], state: "online" }];
    expect(
      await caller(1, true).authorizeScriptAction({ actionId: id }),
    ).toEqual({ allowed: true });
    mock.state.rows = [{ actions: [], state: "online" }];
    expect(
      await caller(1, true).authorizeScriptAction({ actionId: id }),
    ).toEqual({ allowed: false });
  });
  it("denies malformed policies, revoked sessions and cross-device parameters", async () => {
    mock.state.rows = [{ actions: ["unknown.action"], state: "online" }];
    expect(
      await caller(1, true).authorizeScriptAction({ actionId: id }),
    ).toEqual({ allowed: false });
    mock.state.rows = [{ actions: [id], state: "revocado" }];
    await expect(
      caller(1, true).authorizeScriptAction({ actionId: id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller(1, true).authorizeScriptAction({
        actionId: id,
        uuid_agente: "other",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().authorizeScriptAction({ actionId: id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("lets only administrators update a tenant-scoped policy and writes an audit record", async () => {
    expect(
      await caller().getAgenteScriptPolicy({ uuid_agente: "robot-a" }),
    ).toEqual({ allowedActions: [], canManage: true });
    expect(
      await caller().updateAgenteScriptPolicy({
        uuid_agente: "robot-a",
        allowedActions: [id],
      }),
    ).toEqual({ allowedActions: [id] });
    expect(mock.set).toHaveBeenCalledWith(
      expect.objectContaining({ script_allowed_actions_json: [id] }),
    );
    expect(mock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "admin",
        uuid_empresa: "company-a",
        action: "script.policy.updated",
        resource_id: "robot-a",
        details: { previous: [], allowedActions: [id] },
      }),
    );
    expect(
      new MySqlDialect().sqlToQuery(mock.where.mock.calls[1]![0]).params,
    ).toEqual(["company-a", "robot-a"]);
    await expect(
      caller(2).updateAgenteScriptPolicy({
        uuid_agente: "robot-a",
        allowedActions: [id],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(1, true).updateAgenteScriptPolicy({
        uuid_agente: "robot-a",
        allowedActions: [id],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects nonexistent robots and unsupported, recursive or dynamic grants", async () => {
    mock.state.rows = [];
    await expect(
      caller().updateAgenteScriptPolicy({
        uuid_agente: "other-company",
        allowedActions: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const allowedActions of [
      ["playwright.*"],
      ["unknown.action"],
      ["script.typescript.run"],
      [id, id],
      { $ref: "input.grants" },
    ])
      await expect(
        caller().updateAgenteScriptPolicy({
          uuid_agente: "robot-a",
          allowedActions,
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
