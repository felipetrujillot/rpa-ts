// Isolated Electron renderer harness: never starts the automation driver or a real session.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
app.setPath("userData", process.env.RPA_UI_USER_DATA);
const date = "2026-11-03T12:00:00.000Z";
const assignments = [
  {
    uuid_agente_flujo: "assignment-invoices",
    uuid_flujo: "invoices",
    nombre_flujo: "Descargar facturas",
    activo: 1,
    cron_expression: null,
    version_publicada: 3,
  },
  {
    uuid_agente_flujo: "assignment-payments",
    uuid_flujo: "payments",
    nombre_flujo: "Conciliar pagos",
    activo: 0,
    cron_expression: "0 9 * * *",
    version_publicada: 1,
  },
].map((item) => ({
  ...item,
  uuid_agente: "test-agent",
  estado_publicacion: "published",
  updated_at: date,
  created_at: date,
}));
const runs = [
  {
    uuid_flow_run: "completed-run",
    uuid_agente_flujo: "assignment-invoices",
    uuid_flujo: "invoices",
    nombre_flujo: "Descargar facturas",
    status: "success",
    started_at: date,
    finished_at: date,
    duration_ms: 3500,
    logs: [
      {
        level: "info",
        message: "Facturas descargadas correctamente.",
        created_at: date,
      },
    ],
  },
];
globalThis.uiCalls = [];
globalThis.uiReservation = null;
ipcMain.handle("ui:stop", () => { globalThis.uiCalls.push("stopAllFlows"); });
ipcMain.handle("ui:snapshot", () => ({ records: [] }));
ipcMain.handle("ui:trpc", (_event, request) => {
  const url = new URL(request.url);
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1],
  ).split(",");
  const inputs = JSON.parse(
    request.body || url.searchParams.get("input") || "{}",
  );
  const result = procedures.map((name, index) => {
    globalThis.uiCalls.push(name);
    const input = inputs[index] || {};
    let data;
    switch (name) {
      case "agentes.vincularAgente":
        data = {
          status: "ok",
          data: {
            token: "ui-test-token",
            refresh_token: "ui-test-refresh",
            agente: {
              uuid_agente: "test-agent",
              uuid_empresa: "test-company",
              nombre: "Robot de prueba",
            },
          },
        };
        break;
      case "agentes.getAgenteFlowAssignments":
        data = assignments;
        break;
      case "agentes.getAgenteFlowRuns":
        data = runs;
        break;
      case "agentes.getAgenteFlowQueue":
        data = runs.filter((run) => run.status === "queued");
        break;
      case "agentes.getAgenteExecutionState":
        data = globalThis.uiReservation;
        break;
      case "agentes.releaseAgenteReservation":
        if (!input.confirmed_stopped_and_reviewed || input.uuid_flow_run !== globalThis.uiReservation?.uuid_flow_run)
          throw new Error("Recovery requires confirmation of the blocked run.");
        globalThis.uiReservation = null;
        data = { status: "ok" };
        break;
      case "agentes.executeAgenteFlowAssignment": {
        const item = assignments.find(
          (item) => item.uuid_agente_flujo === input.uuid_agente_flujo,
        );
        if (!item || item.activo !== 1)
          throw new Error("An inactive assignment must not be executed.");
        runs.unshift({
          uuid_flow_run: "queued-run",
          uuid_agente_flujo: item.uuid_agente_flujo,
          uuid_flujo: item.uuid_flujo,
          nombre_flujo: item.nombre_flujo,
          status: "queued",
          created_at: date,
          queued_at: date,
          queue_position: 1,
          logs: [],
        });
        data = {
          status: "ok",
          data: {
            uuid_flow_run: "queued-run",
            uuid_agente_flujo: item.uuid_agente_flujo,
            uuid_flujo: item.uuid_flujo,
            execution: { queueStatus: "queued" },
          },
        };
        break;
      }
      case "agentes.cancelAgenteFlowRun":
        runs.find((run) => run.uuid_flow_run === input.uuid_flow_run).status =
          "canceled";
        data = {
          status: "ok",
          data: {
            uuid_flow_run: input.uuid_flow_run,
            cancelled: true,
            current_status: "cancelled",
          },
        };
        break;
      case "agentes.desvincularAgenteCliente":
        data = {
          status: "ok",
          data: { uuid_agente: "test-agent", estado: "desvinculado" },
        };
        break;
      default:
        throw new Error(`Unexpected request: ${name}`);
    }
    return { result: { data } };
  });
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  };
});
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 670,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "../../../out/renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());
