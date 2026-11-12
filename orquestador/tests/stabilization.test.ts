import {
  createWorkflow,
  excelPluginRequirement,
  pinBuiltinPluginRequirements,
  computeFlowChecksum,
  PROTOCOL_VERSION,
  agentMessageSchema,
  serverMessageSchema,
  wordPluginManifest,
} from "@rpa/contracts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq } from "drizzle-orm";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, cp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createApp, createRouter, toNodeListener } from "h3";
import sharp from "sharp";
import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import { db, pool } from "./database";
import {
  agentes,
  empresas,
  usuarios,
  flujos,
  flowVersions,
  flowRuns,
  agenteFlujos,
  agentCommands,
  agentReservations,
  flowNodeRuns,
  runArtifacts,
  runTelemetryReceipts,
  executionAudit,
  tenantRetentionPolicies,
  assets,
} from "../server/db/schema/schema";
import { appRouter } from "../server/trpc/routers";
import { usuariosTrpc } from "../server/trpc/routers/usuarios";
import { desencriptaToken, signUserToken } from "../server/auth";
import { dispatchNextQueuedFlowRunForAgent } from "../server/rpa-flow/queue-dispatch";
import { enqueueScheduledAssignment, runAssignmentSchedules } from "../server/rpa-flow/scheduler";
import wsHandler from "../server/routes/api/rpa/ws";
import liveStatus from "../server/api/rpa/live-status";
import initial from "../server/api/admin/initial";
import assetUpload from "../server/api/assets/index.post";
import assetList from "../server/api/assets/index.get";
import assetContent from "../server/api/assets/[id]/content.get";
import assetMetadata from "../server/api/assets/[id]/index.get";
import { uploadImageAsset } from "../server/assets/service";
import type { UserPrincipal } from "../server/auth/principal";
import type { Principal } from "../server/auth/principal";

const context = (user: Principal | null, ip = "127.0.0.1") => ({
  user,
  publicIp: ip,
  requestId: "test",
});
const caller = async (token: string) =>
  appRouter.createCaller(context(await desencriptaToken(token)));
const publicCaller = () =>
  appRouter.createCaller(context(null, `test-${crypto.randomUUID()}`));
const userToken = async (company: string, id: string, role = 1) =>
  signUserToken({
    activo: 1,
    uuid_usuario: id,
    uuid_empresa: company,
    role,
    nombre: id,
    email: `${id}@test.invalid`,
    logo_empresa: null,
    created_at: new Date(),
  });
let tokenA: string;
let tokenB: string;
let baseUrl: string;
let assetDirectory: string;
const app = createApp()
  .use("/api/rpa/live-status", liveStatus)
  .use("/api/admin/initial", initial)
  .use(createRouter()
    .post("/api/assets", assetUpload)
    .get("/api/assets", assetList)
    .get("/api/assets/:id", assetMetadata)
    .get("/api/assets/:id/content", assetContent));
const server = createServer(toNodeListener(app));
const peers: FakePeer[] = [];
type FakePeer = {
  request: { url: string };
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const ws = wsHandler as unknown as {
  open: (peer: FakePeer) => Promise<void>;
  message: (peer: FakePeer, message: { text: () => string }) => Promise<void>;
  close: (peer: FakePeer) => Promise<void>;
};
const connect = async (token: string) => {
  const { ticket } = await caller(token)
    .then((client) => client.agentes.createSocketTicket())
    .catch(() => ({ ticket: "invalid" }));
  const peer = {
    request: { url: `http://localhost/api/rpa/ws?ticket=${ticket}` },
    send: vi.fn(),
    close: vi.fn(),
  };
  peers.push(peer);
  await ws.open(peer);
  return peer;
};
const report = async (
  peer: FakePeer,
  id: string,
  status: string,
  overrides: Record<string, unknown> = {},
) => {
  const [command] = await db
    .select()
    .from(agentCommands)
    .where(eq(agentCommands.uuid_flow_run, id));
  await ws.message(peer, {
    text: () =>
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "event",
        event: "flow_run_status",
        data: {
          uuid_flow_run: id,
          status,
          command_id: command?.command_id,
          lease_token: command?.lease_token,
          ...overrides,
        },
      }),
  });
};
const messages = (peer: FakePeer) =>
  peer.send.mock.calls.map(([message]) => JSON.parse(message));
const pair = async (token: string, name = "robot") => {
  const admin = await caller(token);
  const created = await admin.agentes.addAgente({ nombre: name });
  return publicCaller().agentes.vincularAgente({
    codigo_vinculacion: created.data.codigo_vinculacion,
  });
};
const seedFlow = async (agentId: string, company = "a") => {
  await db.insert(flujos).values({
    uuid_flujo: `flow-${company}`,
    uuid_empresa: company,
    nombre: "Flow",
    estado_publicacion: "published",
  });
  await db.insert(flowVersions).values({
    uuid_flow_version: `version-${company}`,
    uuid_flujo: `flow-${company}`,
    uuid_empresa: company,
    version_number: 1,
    schema_version: "2.0.0",
    estado: "published",
    checksum: "test",
    definition_json: createWorkflow("Test", "test"),
  });
  await db.insert(agenteFlujos).values({
    uuid_agente_flujo: `assignment-${company}`,
    uuid_empresa: company,
    uuid_agente: agentId,
    uuid_flujo: `flow-${company}`,
    uuid_flow_version: `version-${company}`,
  });
};
const seedRun = async (
  id: string,
  agentId: string,
  status: "queued" | "running" = "queued",
) => {
  await db.insert(flowRuns).values({
    uuid_flow_run: id,
    uuid_empresa: "a",
    uuid_agente: agentId,
    uuid_flujo: "flow-a",
    uuid_flow_version: "version-a",
    trigger_type: "manual",
    status,
  });
};
const runStatus = async (id: string) =>
  (await db.select().from(flowRuns).where(eq(flowRuns.uuid_flow_run, id)))[0]!;

describe("programación persistente de asignaciones", () => {
  const due = new Date("2026-11-03T10:00:00Z");
  const prepareSchedule = async () => {
    const linked = await pair(tokenA);
    await seedFlow(linked.data.agente.uuid_agente);
    await db.update(agenteFlujos).set({ cron_expression: "* * * * *", schedule_timezone: "UTC", next_scheduled_at: due })
      .where(eq(agenteFlujos.uuid_agente_flujo, "assignment-a"));
    return linked;
  };

  it("guarda zona y próxima fecha, valida en servidor y permite volver a manual", async () => {
    const linked = await pair(tokenA);
    await seedFlow(linked.data.agente.uuid_agente);
    const admin = await caller(tokenA);
    await admin.agentes.updateAgenteFlowAssignment({ uuid_agente_flujo: "assignment-a", cron_expression: "0 9 * * 1-5", schedule_timezone: "America/Santiago" });
    const [saved] = await admin.agentes.getAgenteFlowAssignments({ uuid_agente: linked.data.agente.uuid_agente });
    expect(saved).toMatchObject({ cron_expression: "0 9 * * 1-5", schedule_timezone: "America/Santiago", next_scheduled_at: expect.any(Date), scheduling_error: null });
    for (const settings of [{ cron_expression: "0 25 * * *" }, { cron_expression: "* * * * *", schedule_timezone: "Invalid/Timezone" }])
      await expect(admin.agentes.updateAgenteFlowAssignment({ uuid_agente_flujo: "assignment-a", ...settings })).rejects.toThrow();
    const foreign = await caller(tokenB);
    await expect(foreign.agentes.updateAgenteFlowAssignment({ uuid_agente_flujo: "assignment-a", cron_expression: "" })).rejects.toThrow("Asignación no encontrada");
    await admin.agentes.updateAgenteFlowAssignment({ uuid_agente_flujo: "assignment-a", cron_expression: "" });
    expect((await db.select().from(agenteFlujos))[0]).toMatchObject({ cron_expression: null, next_scheduled_at: null, scheduling_error: null });
  });

  it("encola una sola vez aunque dos planificadores reclamen el mismo horario", async () => {
    await prepareSchedule();
    const results = await Promise.all([enqueueScheduledAssignment("assignment-a", due), enqueueScheduledAssignment("assignment-a", due)]);
    expect(results.filter(result => result?.state === "queued")).toHaveLength(1);
    const runs = await db.select().from(flowRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "queued", trigger_type: "schedule", uuid_empresa: "a", uuid_agente_flujo: "assignment-a", uuid_flow_version: "version-a" });
    expect((await db.select().from(agenteFlujos))[0]?.next_scheduled_at?.toISOString()).toBe("2026-11-03T10:01:00.000Z");
    expect((await db.select().from(executionAudit)).some(event => event.action === "run.scheduled")).toBe(true);
  });

  it("despacha al robot conectado mediante el protocolo durable y no solapa la asignación", async () => {
    const linked = await prepareSchedule();
    const peer = await connect(linked.data.token);
    expect(await runAssignmentSchedules(due)).toMatchObject({ queued: 1, errors: 0 });
    const [run] = await db.select().from(flowRuns);
    expect(run?.status).toBe("running");
    expect(messages(peer).filter(message => message.command === "run_flow")).toHaveLength(1);
    expect(messages(peer).find(message => message.command === "run_flow")?.data.uuid_flow_run).toBe(run?.uuid_flow_run);
    expect(await runAssignmentSchedules(new Date("2026-11-03T10:01:00Z"))).toMatchObject({ queued: 0, errors: 0 });
    expect(await db.select().from(flowRuns)).toHaveLength(1);
  });

  it("crea la programación al asignar y la reinicia al reasignar", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await db.delete(agenteFlujos);
    const admin = await caller(tokenA);
    await expect(admin.agentes.assignFlowToAgente({ uuid_agente: id, uuid_flujo: "flow-a", cron_expression: "bad" })).rejects.toThrow();
    expect(await db.select().from(agenteFlujos)).toHaveLength(0);
    const created = await admin.agentes.assignFlowToAgente({ uuid_agente: id, uuid_flujo: "flow-a", cron_expression: "0 9 * * *", schedule_timezone: "UTC" });
    expect((await db.select().from(agenteFlujos))[0]).toMatchObject({ schedule_timezone: "UTC", next_scheduled_at: expect.any(Date) });
    await admin.agentes.assignFlowToAgente({ uuid_agente: id, uuid_flujo: "flow-a" });
    expect(await db.select().from(agenteFlujos)).toHaveLength(1);
    expect((await db.select().from(agenteFlujos))[0]).toMatchObject({ uuid_agente_flujo: created.data.uuid_agente_flujo, cron_expression: null, next_scheduled_at: null, schedule_timezone: "UTC" });
  });

  it("mantiene una sola ejecución pendiente sin conexión y retoma tras completarla", async () => {
    await prepareSchedule();
    expect(await runAssignmentSchedules(due)).toMatchObject({ queued: 1, errors: 0 });
    expect(await runAssignmentSchedules(new Date("2026-11-03T10:01:00Z"))).toMatchObject({ queued: 0, errors: 0 });
    expect(await db.select().from(flowRuns)).toHaveLength(1);
    await db.update(flowRuns).set({ status: "success" });
    expect(await runAssignmentSchedules(new Date("2026-11-03T10:02:00Z"))).toMatchObject({ queued: 1, errors: 0 });
    expect(await db.select().from(flowRuns)).toHaveLength(2);
  });

  it("recupera solo una ocurrencia tras una caída y adelanta al siguiente horario futuro", async () => {
    await prepareSchedule();
    const now = new Date("2026-11-04T10:00:30Z");
    expect((await enqueueScheduledAssignment("assignment-a", now))?.state).toBe("queued");
    expect((await db.select().from(agenteFlujos))[0]?.next_scheduled_at?.toISOString()).toBe("2026-11-04T10:01:00.000Z");
    expect(await enqueueScheduledAssignment("assignment-a", now)).toBeNull();
  });

  it("no ejecuta asignaciones inactivas ni versiones no publicadas", async () => {
    await prepareSchedule();
    await db.update(agenteFlujos).set({ activo: 0 });
    expect(await enqueueScheduledAssignment("assignment-a", due)).toBeNull();
    await db.update(agenteFlujos).set({ activo: 1 });
    await db.update(flowVersions).set({ estado: "draft" });
    expect((await enqueueScheduledAssignment("assignment-a", due))?.state).toBe("unavailable");
    expect(await db.select().from(flowRuns)).toHaveLength(0);
    expect((await db.select().from(agenteFlujos))[0]?.scheduling_error).toMatch(/versión publicada/);
  });

  it("inicializa cron heredado sin ejecución inmediata y aísla cron inválido", async () => {
    await prepareSchedule();
    await db.update(agenteFlujos).set({ next_scheduled_at: null });
    expect((await enqueueScheduledAssignment("assignment-a", due))?.state).toBe("initialized");
    expect(await db.select().from(flowRuns)).toHaveLength(0);
    await db.update(agenteFlujos).set({ cron_expression: "invalid", next_scheduled_at: null });
    expect((await enqueueScheduledAssignment("assignment-a", due))?.state).toBe("invalid");
    expect((await db.select().from(agenteFlujos))[0]?.scheduling_error).toBeTruthy();
    expect(await runAssignmentSchedules(due)).toEqual({ queued: 0, skipped: 0, errors: 0 });
  });
});

beforeAll(async () => {
  assetDirectory = await mkdtemp(join(tmpdir(), "rpa-api-assets-"));
  vi.stubGlobal("useRuntimeConfig", () => ({
    jwtSecret: "rpa-integration-tests-only-secret-32-characters",
    assets: { provider: "local", localDirectory: assetDirectory },
  }));
  const migrationsFolder = resolve("orquestador/server/db/migrations/mysql");
  const legacyFolder = await mkdtemp(join(tmpdir(), "rpa-migrations-"));
  try {
    await cp(migrationsFolder, legacyFolder, { recursive: true });
    const journalPath = join(legacyFolder, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 5,
    );
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: legacyFolder });
    await pool.query(
      "INSERT INTO agentes (uuid_agente, uuid_empresa, nombre, estado, codigo_vinculacion) VALUES ('legacy', 'legacy', 'Legacy', 'online', 'OLD-CODE')",
    );
    await pool.query(
      "INSERT INTO flow_runs (uuid_flow_run, uuid_flujo, uuid_flow_version, uuid_empresa, trigger_type, status) VALUES ('legacy-run', 'legacy', 'legacy', 'legacy', 'manual', 'running')",
    );
    await migrate(db, { migrationsFolder });
    const [legacy] = await db
      .select()
      .from(agentes)
      .where(eq(agentes.uuid_agente, "legacy"));
    expect(legacy).toMatchObject({
      estado: "desvinculado",
      codigo_vinculacion: null,
      session_id: null,
    });
    expect(await runStatus("legacy-run")).toMatchObject({
      status: "failed",
      finished_at: expect.any(Date),
    });
  } finally {
    await rm(legacyFolder, { recursive: true, force: true });
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => {
  for (const peer of peers.splice(0)) await ws.close(peer);
  for (const table of [
    assets,
    flowNodeRuns,
    runArtifacts,
    runTelemetryReceipts,
    executionAudit,
    tenantRetentionPolicies,
    agentCommands,
    agentReservations,
    flowRuns,
    agenteFlujos,
    flowVersions,
    flujos,
    agentes,
    usuarios,
    empresas,
  ])
    await db.delete(table);
  await db.insert(empresas).values([
    { uuid_empresa: "a", nombre: "A" },
    { uuid_empresa: "b", nombre: "B" },
  ]);
  await db.insert(usuarios).values([
    {
      uuid_usuario: "user-a",
      uuid_empresa: "a",
      nombre: "A",
      email: "a@test.invalid",
      password: "unused",
      role: 1,
    },
    {
      uuid_usuario: "user-b",
      uuid_empresa: "b",
      nombre: "B",
      email: "b@test.invalid",
      password: "unused",
      role: 1,
    },
  ]);
  tokenA = await userToken("a", "user-a");
  tokenB = await userToken("b", "user-b");
});
afterAll(async () => {
  for (const peer of peers.splice(0)) await ws.close(peer);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await rm(assetDirectory, { recursive: true, force: true });
});

describe("Image assets API", () => {
  const upload = async (token: string, body?: Buffer, type = "image/png") => fetch(`${baseUrl}/api/assets?name=button.png`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type },
    body: body ?? await sharp({ create: { width: 12, height: 8, channels: 3, background: "red" } }).png().toBuffer(),
  });
  it("stores metadata separately, lists only company images and serves authenticated bytes", async () => {
    const response = await upload(tokenA);
    expect(response.status).toBe(201);
    const image = await response.json();
    expect(image).toMatchObject({ originalName: "button.png", width: 12, height: 8, contentType: "image/png" });
    expect(image.storage_key).toBeUndefined();
    const [row] = await db.select().from(assets).where(eq(assets.id, image.id));
    expect(row).toMatchObject({ uuid_empresa: "a", storage_provider: "local", created_by: "user-a" });
    const content = await fetch(`${baseUrl}/api/assets/${image.id}/content`, { headers: { cookie: `token=${tokenA}` } });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(await readFile(join(assetDirectory, row!.storage_key)));
    const own = await fetch(`${baseUrl}/api/assets`, { headers: { authorization: `Bearer ${tokenA}` } }).then(r => r.json());
    expect(own.items.map((item: { id: string }) => item.id)).toEqual([image.id]);
    const foreign = await fetch(`${baseUrl}/api/assets`, { headers: { authorization: `Bearer ${tokenB}` } }).then(r => r.json());
    expect(foreign.items).toEqual([]);
    expect((await fetch(`${baseUrl}/api/assets/${image.id}/content`, { headers: { authorization: `Bearer ${tokenB}` } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/assets/${image.id}/content`)).status).toBe(401);
  });
  it("allows same-company agents to download but rejects agent uploads and revoked sessions", async () => {
    const image = await upload(tokenA).then(r => r.json());
    const linked = await pair(tokenA);
    const headers = { authorization: `Bearer ${linked.data.token}` };
    expect((await fetch(`${baseUrl}/api/assets/${image.id}/content`, { headers })).status).toBe(200);
    const metadata = await fetch(`${baseUrl}/api/assets/${image.id}`, { headers }).then(r => r.json());
    expect(metadata).toMatchObject({ id: image.id, sha256: image.sha256 });
    expect(metadata.storage_key).toBeUndefined();
    expect((await upload(linked.data.token)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/assets`, { headers })).status).toBe(401);
    const foreign = await pair(tokenB);
    expect((await fetch(`${baseUrl}/api/assets/${image.id}/content`, { headers: { authorization: `Bearer ${foreign.data.token}` } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/assets/${image.id}`, { headers: { authorization: `Bearer ${foreign.data.token}` } })).status).toBe(404);
    await db.update(agentes).set({ session_id: null }).where(eq(agentes.uuid_agente, linked.data.agente.uuid_agente));
    expect((await fetch(`${baseUrl}/api/assets/${image.id}/content`, { headers })).status).toBe(401);
  });
  it("rejects forged images, unsupported types and oversized uploads without storing metadata", async () => {
    expect((await upload(tokenA, Buffer.from("not an image"))).status).toBe(415);
    expect((await upload(tokenA, Buffer.from("<svg/>"), "image/svg+xml")).status).toBe(415);
    expect((await upload(tokenA, Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect(await db.select().from(assets)).toHaveLength(0);
  });
  it("bounds chunked uploads without relying on Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 11; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const response = await fetch(`${baseUrl}/api/assets?name=too-large.png`, {
      method: "POST", headers: { authorization: `Bearer ${tokenA}`, "content-type": "image/png" },
      body: stream, duplex: "half",
    } as RequestInit & { duplex: string });
    expect(response.status).toBe(413);
    expect(await db.select().from(assets)).toHaveLength(0);
    expect((await fetch(`${baseUrl}/api/assets`, { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
  });
  it("removes the stored file if metadata persistence fails", async () => {
    const before = await readdir(assetDirectory);
    const user = await desencriptaToken(tokenA) as UserPrincipal;
    const data = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => { throw new Error("insert failed"); });
    try {
      await expect(uploadImageAsset(user, data, "image.png", "image/png")).rejects.toThrow("insert failed");
      expect(await readdir(assetDirectory)).toEqual(before);
    } finally { insert.mockRestore(); }
  });
  it("paginates company metadata without exposing storage keys", async () => {
    await upload(tokenA);
    const [row] = await db.select().from(assets);
    await db.insert(assets).values(Array.from({ length: 51 }, (_, i) => ({
      ...row!, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    })));
    const headers = { authorization: `Bearer ${tokenA}` };
    const first = await fetch(`${baseUrl}/api/assets`, { headers }).then(r => r.json());
    expect(first.items).toHaveLength(50);
    expect(first.items[0].storage_key).toBeUndefined();
    const second = await fetch(`${baseUrl}/api/assets?cursor=${first.nextCursor}`, { headers }).then(r => r.json());
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(52);
  });
});

describe("Authorization and tenant isolation", () => {
  it("rejects anonymous and agent identities on panel operations", async () => {
    await expect(publicCaller().agentes.getAgentes()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const linked = await pair(tokenA);
    const robot = await caller(linked.data.token);
    await expect(robot.flows.getFlows()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      robot.agentes.addAgente({ nombre: "forbidden" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(robot.root.getEmpresas()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("persists Word inventory from authenticated heartbeats and isolates its read by company", async () => {
    const linked = await pair(tokenA), uuid_agente = linked.data.agente.uuid_agente;
    const peer = await connect(linked.data.token);
    const inventory = { sampledAt: new Date().toISOString(), plugins: [{
      pluginId: "word", packageVersion: wordPluginManifest.packageVersion, sdkVersion: wordPluginManifest.sdkVersion,
      actions: Object.fromEntries(wordPluginManifest.actions.map(a => [a.id, a.contractVersion])), available: true, platform: "darwin", capabilities: wordPluginManifest.capabilities, permissions: ["apple-events:com.microsoft.Word"], verified: false,
    }] };
    await ws.message(peer, { text: () => JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "heartbeat", plugins: inventory }) });
    const [persisted] = await db.select({ inventory: agentes.plugin_inventory_json }).from(agentes).where(eq(agentes.uuid_agente, uuid_agente));
    expect(persisted?.inventory?.plugins[0]?.pluginId).toBe("word");
    const admin = await caller(tokenA), other = await caller(tokenB);
    expect((await admin.agentes.getAgentePlugins({ uuid_agente }))?.plugins[0]?.pluginId).toBe("word");
    await expect(other.agentes.getAgentePlugins({ uuid_agente })).rejects.toThrow("Agente no encontrado");
  });
  it("filters companies and only lets robots access their own device", async () => {
    const first = await pair(tokenA, "first");
    const second = await pair(tokenA, "second");
    const other = await pair(tokenB, "other");
    const admin = await caller(tokenA);
    expect(
      (await admin.agentes.getAgentes()).map((a) => a.nombre).sort(),
    ).toEqual(["first", "second"]);
    expect(
      await admin.agentes.getAgenteById({
        uuid_agente: other.data.agente.uuid_agente,
      }),
    ).toEqual([]);
    const robot = await caller(first.data.token);
    expect(
      await robot.agentes.getAgenteFlowAssignments({
        uuid_agente: first.data.agente.uuid_agente,
      }),
    ).toEqual([]);
    await expect(
      robot.agentes.getAgenteFlowAssignments({
        uuid_agente: second.data.agente.uuid_agente,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const user = await desencriptaToken(tokenA);
    expect(
      await usuariosTrpc
        .createCaller(context(user))
        .getUserById({ uuid_usuario: "user-b" }),
    ).toBeUndefined();
    expect((await admin.agentes.getAgentes())[0]).not.toHaveProperty(
      "refresh_token_hash",
    );
  });
  it("protects HTTP status and disables public bootstrap", async () => {
    const first = await pair(tokenA);
    const other = await pair(tokenB);
    await connect(first.data.token);
    await connect(other.data.token);
    expect((await fetch(`${baseUrl}/api/rpa/live-status`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/rpa/live-status`, {
          headers: { authorization: `Bearer ${first.data.token}` },
        })
      ).status,
    ).toBe(401);
    const result = await (
      await fetch(`${baseUrl}/api/rpa/live-status`, {
        headers: { authorization: `Bearer ${tokenA}` },
      })
    ).json();
    expect(Object.keys(result.data)).toEqual([first.data.agente.uuid_agente]);
    expect((await fetch(`${baseUrl}/api/admin/initial`)).status).toBe(410);
    expect(await db.select().from(usuarios)).toHaveLength(2);
  });
  it("uses current user permissions and rejects old or disabled identities", async () => {
    const elevated = await userToken("a", "user-a", 0);
    await expect(
      (await caller(elevated)).root.getEmpresas(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db
      .update(usuarios)
      .set({ activo: 0 })
      .where(eq(usuarios.uuid_usuario, "user-a"));
    await expect(desencriptaToken(tokenA)).rejects.toThrow();
    const old = await new SignJWT({
      uuid_usuario: "user-b",
      uuid_empresa: "b",
      role: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("3y")
      .sign(
        new TextEncoder().encode(
          "rpa-integration-tests-only-secret-32-characters",
        ),
      );
    await expect(desencriptaToken(old)).rejects.toThrow();
  });
});

describe("Pairing and session revocation", () => {
  it("consumes a pairing code once under concurrent requests", async () => {
    const created = await (
      await caller(tokenA)
    ).agentes.addAgente({ nombre: "Concurrent" });
    expect(created.data.uuid_agente).toMatch(/^[a-f0-9-]{36}$/);
    const results = await Promise.allSettled(
      [publicCaller(), publicCaller()].map((client) =>
        client.agentes.vincularAgente({
          codigo_vinculacion: created.data.codigo_vinculacion,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [agent] = await db
      .select()
      .from(agentes)
      .where(eq(agentes.uuid_agente, created.data.uuid_agente));
    expect(agent!.codigo_vinculacion).toBeNull();
    expect(agent!.refresh_token_hash).toHaveLength(64);
    await expect(
      publicCaller().agentes.vincularAgente({
        codigo_vinculacion: created.data.codigo_vinculacion,
      }),
    ).rejects.toThrow();
  });
  it("rejects expired codes and permits a new code for a pending device", async () => {
    const admin = await caller(tokenA);
    const created = await admin.agentes.addAgente({ nombre: "Expired" });
    await db
      .update(agentes)
      .set({ codigo_vinculacion_expira: new Date(Date.now() - 60_000) })
      .where(eq(agentes.uuid_agente, created.data.uuid_agente));
    await expect(
      publicCaller().agentes.vincularAgente({
        codigo_vinculacion: created.data.codigo_vinculacion,
      }),
    ).rejects.toThrow();
    const renewed = await admin.agentes.regenerarCodigoVinculacion({
      uuid_agente: created.data.uuid_agente,
    });
    await expect(
      publicCaller().agentes.vincularAgente({
        codigo_vinculacion: renewed.data.codigo_vinculacion,
      }),
    ).resolves.toMatchObject({ status: "ok" });
  });
  it("renews access and rejects revoked credentials on HTTP and existing sockets", async () => {
    const linked = await pair(tokenA);
    const peer = await connect(linked.data.token);
    const input = {
      uuid_agente: linked.data.agente.uuid_agente,
      refresh_token: linked.data.refresh_token,
    };
    const renewed = await publicCaller().agentes.refreshAgente(input);
    const principal = await desencriptaToken(renewed.token);
    expect(principal.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      3600,
    );
    await (
      await caller(linked.data.token)
    ).agentes.desvincularAgenteCliente({});
    await expect(desencriptaToken(linked.data.token)).rejects.toThrow();
    await expect(
      publicCaller().agentes.refreshAgente(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(peer.close).toHaveBeenCalledWith(4003, expect.any(String));
    const rejected = await connect(linked.data.token);
    expect(rejected.close).toHaveBeenCalled();
  });
});

describe("Socket tickets and administrative revocation", () => {
  it("accepts a socket ticket only once", async () => {
    const linked = await pair(tokenA);
    const { ticket } = await (
      await caller(linked.data.token)
    ).agentes.createSocketTicket();
    const makePeer = () => ({
      request: { url: `http://localhost/api/rpa/ws?ticket=${ticket}` },
      send: vi.fn(),
      close: vi.fn(),
    });
    const first = makePeer();
    const replay = makePeer();
    peers.push(first, replay);
    await ws.open(first);
    await ws.open(replay);
    expect(first.close).not.toHaveBeenCalled();
    expect(replay.close).toHaveBeenCalledWith(4003, expect.any(String));
  });
  it("scopes administrative revocation and invalidates both access and renewal", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    const peer = await connect(linked.data.token);
    await expect(
      (await caller(tokenB)).agentes.revocarAgente({ uuid_agente: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await (await caller(tokenA)).agentes.revocarAgente({ uuid_agente: id });
    await expect(desencriptaToken(linked.data.token)).rejects.toThrow();
    await expect(
      publicCaller().agentes.refreshAgente({
        uuid_agente: id,
        refresh_token: linked.data.refresh_token,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(peer.close).toHaveBeenCalledWith(4003, expect.any(String));
  });
});

describe("Cancellation and dispatch", () => {
  it("clears the entire agent queue beyond the page limit and preserves other states and agents", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    const other = await pair(tokenA, "other-agent");
    await seedFlow(id);
    await db.insert(flowRuns).values(Array.from({ length: 225 }, (_, index) => ({
      uuid_flow_run: `queued-${index}`, uuid_empresa: "a", uuid_agente: id,
      uuid_flujo: "flow-a", uuid_flow_version: "version-a", trigger_type: "manual",
      status: "queued" as const,
    })));
    for (const status of ["running", "cancelling", "success", "failed", "cancelled"] as const) {
      await db.insert(flowRuns).values({
        uuid_flow_run: status, uuid_empresa: "a", uuid_agente: id,
        uuid_flujo: "flow-a", uuid_flow_version: "version-a", trigger_type: "manual", status,
      });
    }
    await seedRun("other-agent-queued", other.data.agente.uuid_agente);
    const admin = await caller(tokenA);
    expect(await admin.agentes.clearAgenteFlowQueue({ uuid_agente: id })).toEqual({ cancelled_count: 225 });
    const rows = await db.select().from(flowRuns);
    const cleared = rows.filter((row) => row.uuid_flow_run.startsWith("queued-"));
    expect(cleared).toHaveLength(225);
    expect(cleared.every((row) => row.status === "cancelled" && row.finished_at && !row.started_at)).toBe(true);
    for (const status of ["running", "cancelling", "success", "failed", "cancelled"])
      expect((await runStatus(status)).status).toBe(status);
    expect((await runStatus("other-agent-queued")).status).toBe("queued");
    expect(await admin.agentes.clearAgenteFlowQueue({ uuid_agente: id })).toEqual({ cancelled_count: 0 });
    expect((await db.select().from(executionAudit)).find((row) => row.action === "queue.cleared" && (row.details as { cancelled_count?: number })?.cancelled_count === 225))
      .toMatchObject({ actor_type: "user", resource_id: id, details: { cancelled_count: 225 } });
    expect(await db.select().from(agentCommands)).toEqual([]);
  });
  it("restricts queue clearing to users in the same company and keeps an uncertain reservation blocked", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("uncertain", id);
    const peer = await connect(linked.data.token);
    await report(peer, "uncertain", "failed", { requires_reconciliation: true });
    await seedRun("pending", id);
    await expect((await caller(tokenB)).agentes.clearAgenteFlowQueue({ uuid_agente: id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect((await caller(linked.data.token)).agentes.clearAgenteFlowQueue({ uuid_agente: id }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await runStatus("pending")).status).toBe("queued");
    const before = (await db.select().from(agentReservations))[0];
    await (await caller(tokenA)).agentes.clearAgenteFlowQueue({ uuid_agente: id });
    expect((await runStatus("pending")).status).toBe("cancelled");
    expect((await db.select().from(agentReservations))[0]).toEqual(before);
  });
  it("serializes queue clearing with dispatch so cancelled work is never sent to the robot", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    const peer = await connect(linked.data.token);
    for (let index = 0; index < 10; index++) await seedRun(`race-${index}`, id);
    const admin = await caller(tokenA);
    const [cleared] = await Promise.all([
      admin.agentes.clearAgenteFlowQueue({ uuid_agente: id }),
      dispatchNextQueuedFlowRunForAgent("a", id),
    ]);
    const rows = await db.select().from(flowRuns);
    expect(rows.filter((row) => row.status === "queued")).toHaveLength(0);
    expect(rows.filter((row) => row.status === "cancelled")).toHaveLength(cleared.cancelled_count);
    for (const command of messages(peer).filter((message) => message.command === "run_flow"))
      expect((await runStatus(command.data.uuid_flow_run)).status).toBe("running");
    expect(rows.filter((row) => row.status === "running").length + cleared.cancelled_count).toBe(10);
  });
  it("cancels queued runs without dispatching them", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("queued", id);
    const result = await (
      await caller(tokenA)
    ).agentes.cancelAgenteFlowRun({ uuid_flow_run: "queued" });
    expect(result.data).toMatchObject({
      cancelled: true,
      current_status: "cancelled",
    });
    const peer = await connect(linked.data.token);
    expect(messages(peer).filter((m) => m.command === "run_flow")).toHaveLength(
      0,
    );
  });
  it("holds the queue until the robot confirms cancellation and ignores late events", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("active", id, "running");
    await seedRun("next", id);
    const peer = await connect(linked.data.token);
    const result = await (
      await caller(tokenA)
    ).agentes.cancelAgenteFlowRun({ uuid_flow_run: "active" });
    expect(result.data).toMatchObject({
      cancelled: false,
      current_status: "cancelling",
    });
    expect((await runStatus("active")).finished_at).toBeNull();
    await dispatchNextQueuedFlowRunForAgent("a", id);
    expect((await runStatus("next")).status).toBe("queued");
    await report(peer, "active", "running");
    expect((await runStatus("active")).status).toBe("cancelling");
    await report(peer, "active", "cancelled");
    expect((await runStatus("active")).status).toBe("cancelled");
    expect((await runStatus("next")).status).toBe("running");
    await report(peer, "active", "success");
    expect((await runStatus("active")).status).toBe("cancelled");
    expect(
      new Set(
        messages(peer)
          .filter(
            (m) => m.command === "run_flow" && m.data.uuid_flow_run === "next",
          )
          .map((m) => m.data.command_id),
      ).size,
    ).toBe(1);
  });
  it("resends offline cancellations on reconnect and accepts a racing completion as stopped", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("active", id, "running");
    await (
      await caller(tokenA)
    ).agentes.cancelAgenteFlowRun({ uuid_flow_run: "active" });
    const peer = await connect(linked.data.token);
    expect(messages(peer).some((m) => m.command === "cancel_flow")).toBe(true);
    await report(peer, "active", "success");
    expect((await runStatus("active")).status).toBe("cancelled");
  });
  it("rejects cancellation and status reports for other devices and companies", async () => {
    const linked = await pair(tokenA);
    const other = await pair(tokenB);
    const sibling = await pair(tokenA);
    await seedFlow(linked.data.agente.uuid_agente);
    await seedRun("active", linked.data.agente.uuid_agente, "running");
    await expect(
      (await caller(tokenB)).agentes.cancelAgenteFlowRun({
        uuid_flow_run: "active",
      }),
    ).rejects.toThrow();
    await expect(
      (await caller(sibling.data.token)).agentes.cancelAgenteFlowRun({
        uuid_flow_run: "active",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const peer = await connect(other.data.token);
    await report(peer, "active", "success");
    expect((await runStatus("active")).status).toBe("running");
  });
  it("does not let a stale socket remove a replacement connection", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    const old = await connect(linked.data.token);
    const current = await connect(linked.data.token);
    await ws.close(old);
    await seedFlow(id);
    await seedRun("next", id);
    expect((await dispatchNextQueuedFlowRunForAgent("a", id)).dispatched).toBe(
      true,
    );
    expect(messages(current).some((m) => m.command === "run_flow")).toBe(true);
  });
});

describe("Durable delivery, fencing and recovery", () => {
  it("reserves one run under concurrent dispatch and keeps a stable command id on reconnect", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("first", id);
    await seedRun("second", id);
    const peer = await connect(linked.data.token);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        dispatchNextQueuedFlowRunForAgent("a", id),
      ),
    );
    const commands = await db.select().from(agentCommands);
    expect(commands).toHaveLength(1);
    expect((await db.select().from(agentReservations))[0]?.uuid_flow_run).toBe(
      commands[0]!.uuid_flow_run,
    );
    expect(
      (await db.select().from(flowRuns)).filter((r) => r.status === "running"),
    ).toHaveLength(1);
    await ws.close(peer);
    const replacement = await connect(linked.data.token);
    expect(
      messages(replacement).find((m) => m.command === "run_flow")?.data
        .command_id,
    ).toBe(commands[0]!.command_id);
  });
  it("persists acknowledgements and rejects stale fences on reports and renewals", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("active", id);
    const peer = await connect(linked.data.token);
    const [command] = await db.select().from(agentCommands);
    const stale = crypto.randomUUID();
    await ws.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "command_ack",
          command_id: command!.command_id,
          lease_token: stale,
        }),
    });
    expect((await db.select().from(agentCommands))[0]?.status).toBe("pending");
    expect(messages(peer).some((m) => m.type === "command_accepted")).toBe(
      false,
    );
    await ws.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "command_ack",
          command_id: command!.command_id,
          lease_token: command!.lease_token,
        }),
    });
    expect((await db.select().from(agentCommands))[0]?.status).toBe("accepted");
    expect(
      messages(peer).find((m) => m.type === "command_accepted")?.data,
    ).toMatchObject({
      command_id: command!.command_id,
      lease_token: command!.lease_token,
    });
    await report(peer, "active", "success", { lease_token: stale });
    expect((await runStatus("active")).status).toBe("running");
    await ws.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "heartbeat",
          lease: { uuid_flow_run: "active", lease_token: command!.lease_token },
        }),
    });
    expect(messages(peer).some((m) => m.type === "lease_renewed")).toBe(true);
    const result = {
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outputs: { vars: {}, nodeOutputs: { verified: true } },
    };
    await report(peer, "active", "success", { result });
    expect((await runStatus("active")).output_json).toEqual(result);
    expect(
      (await db.select().from(agentReservations))[0]?.uuid_flow_run,
    ).toBeNull();
    expect((await db.select().from(agentCommands))[0]?.status).toBe(
      "completed",
    );
    await report(peer, "active", "success");
    expect(
      messages(peer).filter((m) => m.type === "flow_run_receipt"),
    ).toHaveLength(2);
  });
  it("continues the queue automatically after an ordinary flow failure", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("failed-run", id);
    const peer = await connect(linked.data.token);
    await seedRun("next", id);
    await report(peer, "failed-run", "failed", { error_message: "APP_NOT_INSTALLED", requires_reconciliation: false });
    expect((await runStatus("failed-run")).status).toBe("failed");
    expect((await runStatus("next")).status).toBe("running");
    expect((await db.select().from(agentReservations))[0]).toMatchObject({ uuid_flow_run: "next", requires_reconciliation: 0 });
  });
  it.each(["usuario", "agente"])("does not replay ambiguous work and allows reviewed recovery from %s", async (actor) => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("active", id);
    const peer = await connect(linked.data.token);
    await seedRun("next", id);
    await db
      .update(agentReservations)
      .set({ lease_expires_at: new Date(Date.now() - 120000) })
      .where(eq(agentReservations.uuid_agente, id));
    await dispatchNextQueuedFlowRunForAgent("a", id);
    expect((await runStatus("next")).status).toBe("queued");
    await report(peer, "active", "failed", {
      requires_reconciliation: true,
      error_message: "Proceso interrumpido.",
    });
    const admin = await caller(tokenA);
    expect(
      await admin.agentes.getAgenteExecutionState({ uuid_agente: id }),
    ).toMatchObject({ requires_reconciliation: 1, uuid_flow_run: "active" });
    await dispatchNextQueuedFlowRunForAgent("a", id);
    expect((await runStatus("next")).status).toBe("queued");
    await expect(
      (await caller(tokenB)).agentes.releaseAgenteReservation({
        uuid_agente: id,
        uuid_flow_run: "active",
        confirmed_stopped_and_reviewed: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const anotherRobot = await pair(tokenA, "another-robot");
    await expect((await caller(anotherRobot.data.token)).agentes.releaseAgenteReservation({
      uuid_agente: id, uuid_flow_run: "active", confirmed_stopped_and_reviewed: true,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(agentReservations).set({ lease_expires_at: new Date(Date.now() + 60000) }).where(eq(agentReservations.uuid_agente, id));
    const recovery = actor === "agente" ? await caller(linked.data.token) : admin;
    await expect(recovery.agentes.releaseAgenteReservation({
      uuid_agente: id, uuid_flow_run: "active", confirmed_stopped_and_reviewed: true,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    // A delivery may have renewed an unacknowledged deadline. Wait is simulated in the database.
    await db
      .update(agentReservations)
      .set({ lease_expires_at: new Date(Date.now() - 120000) })
      .where(eq(agentReservations.uuid_agente, id));
    await recovery.agentes.releaseAgenteReservation({
      uuid_agente: id,
      uuid_flow_run: "active",
      confirmed_stopped_and_reviewed: true,
    });
    expect((await runStatus("next")).status).toBe("running");
    expect((await db.select().from(executionAudit)).find((entry) => entry.action === "reservation.released")).toMatchObject({
      actor_type: actor === "agente" ? "agent" : "user", resource_id: "active",
    });
  });
  it("retains commands when socket send fails and redelivers instead of creating a new execution", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    const peer = await connect(linked.data.token);
    await seedRun("active", id);
    peer.send.mockImplementation(() => {
      throw new Error("transport lost");
    });
    expect((await dispatchNextQueuedFlowRunForAgent("a", id)).dispatched).toBe(
      false,
    );
    const [command] = await db.select().from(agentCommands);
    expect(command?.status).toBe("pending");
    const recovered = await connect(linked.data.token);
    expect(
      messages(recovered).find((m) => m.command === "run_flow")?.data
        .command_id,
    ).toBe(command!.command_id);
    expect(await db.select().from(agentCommands)).toHaveLength(1);
  });
  it("validates, publishes and hashes exactly the same v2 document as Electron", async () => {
    const admin = await caller(tokenA);
    const document = createWorkflow("Shared workflow", "shared");
    expect((await admin.flows.validateSchema({ document })).normalized).toEqual(
      document,
    );
    const draft = await admin.flows.createDraft({
      nombre: "Shared workflow",
      document,
    });
    const [stored] = await db
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.uuid_flow_version, draft.data.uuid_flow_version));
    expect(stored?.checksum).toBe(await computeFlowChecksum(document));
    await admin.flows.publishVersion({
      uuid_flujo: draft.data.uuid_flujo,
      uuid_flow_version: draft.data.uuid_flow_version,
    });
    expect(
      (
        await db
          .select()
          .from(flowVersions)
          .where(
            eq(flowVersions.uuid_flow_version, draft.data.uuid_flow_version),
          )
      )[0]?.estado,
    ).toBe("published");
  });
  it("loads and edits tenant-owned flows while preserving published versions", async () => {
    const admin = await caller(tokenA);
    const other = await caller(tokenB);
    const document = createWorkflow("Original", "editor-test");
    const first = await admin.flows.createDraft({ nombre: "Original", document });
    await admin.flows.publishVersion({ uuid_flujo: first.data.uuid_flujo, uuid_flow_version: first.data.uuid_flow_version });
    const opened = await admin.flows.getFlow({ uuid_flujo: first.data.uuid_flujo });
    expect(opened.latestVersion.definition_json).toEqual(document);
    expect(opened.publishedVersionId).toBe(first.data.uuid_flow_version);
    await expect(other.flows.getFlow({ uuid_flujo: first.data.uuid_flujo })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.flows.createDraft({ uuid_flujo: first.data.uuid_flujo, nombre: "Forbidden", document })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const second = await admin.flows.createDraft({ uuid_flujo: first.data.uuid_flujo, nombre: "Renombrado", document });
    expect(second.data.version_number).toBe(2);
    const edited = await admin.flows.getFlow({ uuid_flujo: first.data.uuid_flujo });
    expect(edited.nombre).toBe("Renombrado");
    expect((edited.latestVersion.definition_json as typeof document).workflow.name).toBe("Renombrado");
    expect(edited.publishedVersionId).toBe(first.data.uuid_flow_version);
    expect((await admin.flows.getFlowVersions({ uuid_flujo: first.data.uuid_flujo }))).toHaveLength(2);
    expect((await other.flows.getFlowVersions({ uuid_flujo: first.data.uuid_flujo }))).toHaveLength(0);
  });
  it("serializes simultaneous saves into distinct immutable versions", async () => {
    const admin = await caller(tokenA);
    const document = createWorkflow("Concurrent", "concurrent-editor");
    const first = await admin.flows.createDraft({ nombre: "Concurrent", document });
    const saved = await Promise.all([1, 2].map(index => admin.flows.createDraft({ uuid_flujo: first.data.uuid_flujo, nombre: `Edit ${index}`, document })));
    expect(saved.map(v => v.data.version_number).sort()).toEqual([2, 3]);
    expect(await admin.flows.getFlowVersions({ uuid_flujo: first.data.uuid_flujo })).toHaveLength(3);
  });
  it("rejects previous documents on save and publication without a compatibility path", async () => {
    const admin = await caller(tokenA);
    const previous = { kind: "rpa.flow", schemaVersion: "1.0.0", flow: {} };
    expect((await admin.flows.validateSchema({ document: previous })).ok).toBe(
      false,
    );
    await expect(
      admin.flows.createDraft({ nombre: "Previous", document: previous }),
    ).rejects.toThrow();
    const linked = await pair(tokenA);
    await seedFlow(linked.data.agente.uuid_agente);
    await db
      .update(flowVersions)
      .set({ definition_json: previous })
      .where(eq(flowVersions.uuid_flow_version, "version-a"));
    await expect(
      admin.flows.publishVersion({
        uuid_flujo: "flow-a",
        uuid_flow_version: "version-a",
      }),
    ).rejects.toThrow("v2");
  });
  it("emits commands that pass the same wire validator used in the renderer", async () => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("wire", id);
    const peer = await connect(linked.data.token);
    const sent = messages(peer);
    for (const message of sent)
      expect(serverMessageSchema.safeParse(message).success).toBe(true);
    const command = sent.find((message) => message.command === "run_flow");
    expect(
      agentMessageSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        type: "command_ack",
        command_id: command.data.command_id,
        lease_token: command.data.lease_token,
      }).success,
    ).toBe(true);
    expect(agentMessageSchema.safeParse({ type: "heartbeat" }).success).toBe(
      false,
    );
  });
});

describe("Operational evidence, telemetry and retention", () => {
  const setup = async (input: Record<string, unknown> = {}) => {
    const linked = await pair(tokenA);
    const id = linked.data.agente.uuid_agente;
    await seedFlow(id);
    await seedRun("observed", id);
    await db
      .update(flowRuns)
      .set({ input_json: input })
      .where(eq(flowRuns.uuid_flow_run, "observed"));
    const peer = await connect(linked.data.token);
    const [command] = await db
      .select()
      .from(agentCommands)
      .where(eq(agentCommands.uuid_flow_run, "observed"));
    await ws.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "command_ack",
          command_id: command!.command_id,
          lease_token: command!.lease_token,
        }),
    });
    const packet = (
      payload: unknown,
      overrides: Record<string, unknown> = {},
    ) => ({
      event_id: crypto.randomUUID(),
      uuid_flow_run: "observed",
      command_id: command!.command_id,
      lease_token: command!.lease_token,
      payload,
      ...overrides,
    });
    const send = async (data: ReturnType<typeof packet>, target = peer) =>
      ws.message(target, {
        text: () =>
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: "run_telemetry",
            data,
          }),
      });
    return { linked, id, peer, command: command!, packet, send };
  };
  const node = () => ({
    nodeId: "start",
    nodeName: "Inicio",
    type: "rpa.manualTrigger",
    startedAt: new Date().toISOString(),
  });
  const artifact = () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6r0AAAAASUVORK5CYII=",
      "base64",
    );
    return {
      artifact_id: crypto.randomUUID(),
      content_type: "image/png",
      byte_length: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_base64: bytes.toString("base64"),
    };
  };
  it("reports schema failures as internal errors and accepts pending telemetry after repair", async () => {
    const { linked, packet, send, peer } = await setup();
    const pending = packet({ kind: "node", event: { phase: "started", executionIndex: 1, node: node() } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await pool.query("ALTER TABLE node_runs DROP COLUMN error_json");
    try {
      await send(pending);
      expect(peer.close).toHaveBeenCalledWith(1011, "Error interno del servidor al procesar el mensaje");
      expect(peer.close).not.toHaveBeenCalledWith(4003, expect.any(String));
      expect(log).toHaveBeenCalledWith("Error interno al procesar mensaje del robot", expect.objectContaining({
        type: "run_telemetry", code: "ER_BAD_FIELD_ERROR",
      }));
      expect(messages(peer).some((message) => message.type === "telemetry_receipt")).toBe(false);
    } finally {
      await pool.query("ALTER TABLE node_runs ADD COLUMN error_json JSON NULL");
      log.mockRestore();
    }
    const recovered = await connect(linked.data.token);
    await send(pending, recovered);
    expect(messages(recovered)).toContainEqual(expect.objectContaining({ type: "telemetry_receipt", data: { event_id: pending.event_id } }));
    expect(await db.select().from(flowNodeRuns)).toHaveLength(1);
  });
  it("persists progress before completion, deduplicates retries and prevents start-after-finish regression", async () => {
    const { packet, send, peer } = await setup();
    const started = node();
    const start = packet({
      kind: "node",
      event: { phase: "started", executionIndex: 1, node: started },
    });
    await send(start);
    expect((await db.select().from(flowNodeRuns))[0]?.status).toBe("running");
    expect((await runStatus("observed")).status).toBe("running");
    const finish = packet({
      kind: "node",
      event: {
        phase: "finished",
        executionIndex: 1,
        node: {
          ...started,
          finishedAt: new Date().toISOString(),
          status: "success",
          outputIndex: 0,
          output: { answer: 42, password: "never-save-me" },
        },
      },
    });
    await send(finish);
    await send(finish);
    await send(packet(start.payload));
    const rows = await db.select().from(flowNodeRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "success",
      uuid_empresa: "a",
      execution_index: 1,
      output_json: { answer: 42, password: "[REDACTED]" },
    });
    expect(
      messages(peer).filter(
        (m) =>
          m.type === "telemetry_receipt" && m.data.event_id === finish.event_id,
      ),
    ).toHaveLength(2);
    const admin = await caller(tokenA);
    expect(
      (await admin.agentes.getFlowRunDetail({ uuid_flow_run: "observed" }))
        .nodes,
    ).toHaveLength(1);
    expect((await admin.agentes.getExecutionMetrics({})).nodes).toMatchObject({
      count: 1,
      failed: 0,
    });
  });
  it("rejects other companies, sibling devices, stale fences and nodes outside the frozen document", async () => {
    const { packet, send, peer } = await setup();
    const foreign = await pair(tokenB);
    const sibling = await pair(tokenA);
    const event = {
      kind: "node",
      event: { phase: "started", executionIndex: 1, node: node() },
    };
    await send(packet(event), await connect(foreign.data.token));
    await send(packet(event), await connect(sibling.data.token));
    await send(packet(event, { lease_token: crypto.randomUUID() }));
    await send(
      packet({
        kind: "node",
        event: {
          phase: "started",
          executionIndex: 1,
          node: { ...node(), nodeId: "invented" },
        },
      }),
    );
    expect(await db.select().from(flowNodeRuns)).toHaveLength(0);
    expect(
      messages(peer).filter((m) => m.type === "telemetry_receipt"),
    ).toHaveLength(0);
    await expect(
      (await caller(tokenB)).agentes.getFlowRunDetail({
        uuid_flow_run: "observed",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      (await caller(sibling.data.token)).agentes.getFlowRunDetail({
        uuid_flow_run: "observed",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("persists artifacts once, validates their contents, scopes access and audits reads", async () => {
    const { packet, send } = await setup();
    const image = artifact();
    const valid = packet({ kind: "artifact", artifact: image });
    await send(valid);
    await send(valid);
    await send(packet({ kind: "artifact", artifact: image }));
    await send(
      packet({
        kind: "artifact",
        artifact: {
          ...image,
          artifact_id: crypto.randomUUID(),
          sha256: "0".repeat(64),
        },
      }),
    );
    expect(await db.select().from(runArtifacts)).toHaveLength(1);
    const admin = await caller(tokenA);
    expect(
      (await admin.agentes.getRunArtifact({ artifact_id: image.artifact_id }))
        .image_data_url,
    ).toContain(image.content_base64);
    await expect(
      (await caller(tokenB)).agentes.getRunArtifact({
        artifact_id: image.artifact_id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await admin.agentes.getExecutionAudit({})).map((entry) => entry.action),
    ).toContain("artifact.read");
    expect((await admin.agentes.getExecutionMetrics({})).artifacts).toEqual({
      count: 1,
      bytes: image.byte_length,
    });
  });
  it("stores full sanitized summaries and accepts lost node events after a terminal receipt", async () => {
    const { packet, send, peer } = await setup({
      password: "never-save-me",
      api_key: "success",
    });
    const admin = await caller(tokenA);
    const result = {
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outputs: {
        vars: { api_key: "never-save-me", copied: "echo never-save-me" },
        nodeOutputs: { start: { answer: 42 } },
      },
    };
    await report(peer, "observed", "success", { result });
    expect((await runStatus("observed")).output_json).toMatchObject({
      status: "success",
      outputs: {
        vars: { api_key: "[REDACTED]", copied: "echo [REDACTED]" },
        nodeOutputs: { start: { answer: 42 } },
      },
    });
    await send(
      packet({
        kind: "node",
        event: {
          phase: "finished",
          executionIndex: 1,
          node: {
            ...node(),
            finishedAt: new Date().toISOString(),
            status: "success",
            outputIndex: 0,
            output: { answer: 42 },
          },
        },
      }),
    );
    expect(
      (await admin.agentes.getFlowRunDetail({ uuid_flow_run: "observed" }))
        .nodes,
    ).toHaveLength(1);
    expect(
      (await admin.agentes.getExecutionAudit({})).filter(
        (entry) => entry.action === "run.completed",
      ),
    ).toHaveLength(1);
  });
  it("erases expired evidence without restoring it on a delayed retry and isolates retention policies", async () => {
    const { packet, send, peer, command } = await setup();
    const image = artifact();
    const delivery = packet({ kind: "artifact", artifact: image });
    await send(delivery);
    await report(peer, "observed", "success", {
      result: {
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outputs: { vars: {}, nodeOutputs: {} },
      },
    });
    const admin = await caller(tokenA);
    await admin.agentes.setEvidenceRetention({
      evidenceDays: 1,
      auditDays: 30,
    });
    expect(await (await caller(tokenB)).agentes.getEvidenceRetention()).toEqual(
      { evidenceDays: 30, auditDays: 90 },
    );
    await db
      .update(flowRuns)
      .set({ finished_at: new Date(Date.now() - 2 * 86400000) })
      .where(eq(flowRuns.uuid_flow_run, "observed"));
    expect(await admin.agentes.purgeEvidenceRetention()).toMatchObject({
      deleted: 1,
    });
    expect(await db.select().from(runArtifacts)).toHaveLength(0);
    expect((await runStatus("observed")).output_json).toBeNull();
    expect((await runStatus("observed")).telemetry_deleted_at).toBeInstanceOf(
      Date,
    );
    expect(
      (await db.select().from(agentCommands)).find(
        (row) => row.command_id === command.command_id,
      )?.payload,
    ).toEqual({});
    await send(delivery);
    expect(await db.select().from(runArtifacts)).toHaveLength(0);
    expect(
      messages(peer).filter(
        (m) =>
          m.type === "telemetry_receipt" &&
          m.data.event_id === delivery.event_id,
      ),
    ).toHaveLength(2);
    await expect(
      admin.agentes.getRunArtifact({ artifact_id: image.artifact_id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await admin.agentes.purgeEvidenceRetention()).toMatchObject({
      deleted: 0,
    });
  });
  it("refuses erasure of active or uncertain runs and restricts administrative evidence operations", async () => {
    const { peer } = await setup();
    const admin = await caller(tokenA);
    await expect(
      admin.agentes.eraseFlowRunEvidence({ uuid_flow_run: "observed" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await report(peer, "observed", "failed", { requires_reconciliation: true });
    await expect(
      admin.agentes.eraseFlowRunEvidence({ uuid_flow_run: "observed" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      (await caller(tokenB)).agentes.eraseFlowRunEvidence({
        uuid_flow_run: "observed",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(usuarios)
      .set({ role: 2 })
      .where(eq(usuarios.uuid_usuario, "user-a"));
    await expect(
      (await caller(tokenA)).agentes.setEvidenceRetention({
        evidenceDays: 1,
        auditDays: 30,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      (await caller(tokenA)).agentes.getExecutionAudit({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});


describe("Excel plugin publication and tenant-scoped inventory", () => {
  const excelDocument = () => {
    const document = createWorkflow("Excel", "excel-test");
    document.workflow.nodes.push({ id: "open", name: "Excel", type: "rpa.action", typeVersion: 1, position: [10, 10], parameters: { actionId: "excel.workbook.open", input: { path: "/tmp/template.xlsx" } } });
    document.workflow.connections.Inicio = { main: [[{ node: "Excel", type: "main", index: 0 }]] };
    return document;
  };
  it("pins action versions before hashing and preserves the published definition across incompatible drafts", async () => {
    const admin = await caller(tokenA), document = excelDocument();
    const draft = await admin.flows.createDraft({ nombre: "Excel", document });
    const [stored] = await db.select().from(flowVersions).where(eq(flowVersions.uuid_flow_version, draft.data.uuid_flow_version));
    const pinned = pinBuiltinPluginRequirements(document);
    expect(stored!.definition_json).toEqual(pinned);
    expect(stored!.checksum).toBe(await computeFlowChecksum(pinned));
    await admin.flows.publishVersion({ uuid_flujo: draft.data.uuid_flujo, uuid_flow_version: draft.data.uuid_flow_version });
    const incompatible = structuredClone(pinned); incompatible.pluginRequirements![0]!.actions["excel.workbook.open"] = "2.0.0";
    const next = await admin.flows.createDraft({ uuid_flujo: draft.data.uuid_flujo, nombre: "Excel", document: incompatible });
    await expect(admin.flows.publishVersion({ uuid_flujo: draft.data.uuid_flujo, uuid_flow_version: next.data.uuid_flow_version })).rejects.toThrow(/incompatibles/);
    const [published] = await db.select().from(flowVersions).where(eq(flowVersions.uuid_flow_version, draft.data.uuid_flow_version));
    expect(published!.estado).toBe("published"); expect(published!.definition_json).toEqual(pinned);
  });
  it("requires compatible inventory to assign Excel and persists heartbeats without crossing companies", async () => {
    const linked = await pair(tokenA), id = linked.data.agente.uuid_agente;
    const admin = await caller(tokenA), foreign = await caller(tokenB);
    const draft = await admin.flows.createDraft({ nombre: "Excel", document: excelDocument() });
    await admin.flows.publishVersion({ uuid_flujo: draft.data.uuid_flujo, uuid_flow_version: draft.data.uuid_flow_version });
    await expect(admin.agentes.assignFlowToAgente({ uuid_agente: id, uuid_flujo: draft.data.uuid_flujo })).rejects.toThrow(/Inventario/);
    const peer = await connect(linked.data.token);
    const inventory = { sampledAt: new Date().toISOString(), plugins: [{ ...excelPluginRequirement(["excel.workbook.open"]), available: true, platform: "darwin", capabilities: ["xlsx"], permissions: ["apple-events:com.microsoft.Excel"], verified: false }] };
    await ws.message(peer, { text: () => JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "heartbeat", plugins: inventory }) });
    expect((await admin.agentes.getAgentePlugins({ uuid_agente: id }))?.plugins[0]?.pluginId).toBe("excel");
    expect((await db.select().from(agentes).where(eq(agentes.uuid_agente, id)))[0]!.plugin_inventory_json?.plugins[0]?.pluginId).toBe("excel");
    await expect(foreign.agentes.getAgentePlugins({ uuid_agente: id })).rejects.toThrow(/no encontrado/);
    await expect(admin.agentes.assignFlowToAgente({ uuid_agente: id, uuid_flujo: draft.data.uuid_flujo })).resolves.toMatchObject({ status: "ok" });
  });
});

describe("server-managed SDK authorization", () => {
  it("persists grants per tenant and robot, audits changes and revokes on the next call", async () => {
    const linked = await pair(tokenA), other = await pair(tokenA, "other"), foreign = await caller(tokenB);
    const admin = await caller(tokenA), device = await caller(linked.data.token), otherDevice = await caller(other.data.token);
    const uuid_agente = linked.data.agente.uuid_agente;
    const actionId = "playwright.browser.openTab";
    expect(await device.agentes.authorizeScriptAction({actionId})).toEqual({allowed: false});
    await admin.agentes.updateAgenteScriptPolicy({uuid_agente, allowedActions: [actionId]});
    expect(await device.agentes.authorizeScriptAction({actionId})).toEqual({allowed: true});
    expect(await otherDevice.agentes.authorizeScriptAction({actionId})).toEqual({allowed: false});
    await expect(foreign.agentes.getAgenteScriptPolicy({uuid_agente})).rejects.toMatchObject({code: "NOT_FOUND"});
    await expect(foreign.agentes.updateAgenteScriptPolicy({uuid_agente, allowedActions: [actionId]})).rejects.toMatchObject({code: "NOT_FOUND"});
    await expect(device.agentes.updateAgenteScriptPolicy({uuid_agente, allowedActions: []})).rejects.toMatchObject({code: "UNAUTHORIZED"});
    await admin.agentes.updateAgenteScriptPolicy({uuid_agente, allowedActions: []});
    expect(await device.agentes.authorizeScriptAction({actionId})).toEqual({allowed: false});
    expect((await db.select().from(agentes).where(eq(agentes.uuid_agente, uuid_agente)))[0]!.script_allowed_actions_json).toEqual([]);
    expect((await db.select().from(executionAudit)).filter(row => row.action === "script.policy.updated")).toHaveLength(2);
    await db.update(usuarios).set({role: 2}).where(eq(usuarios.uuid_usuario, "user-a"));
    await expect((await caller(tokenA)).agentes.updateAgenteScriptPolicy({uuid_agente, allowedActions: [actionId]})).rejects.toMatchObject({code: "FORBIDDEN"});
  });
});
