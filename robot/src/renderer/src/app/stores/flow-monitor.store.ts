import { defineStore } from "pinia";
import {
  cancelAgenteFlowRun,
  getAgenteFlowQueue,
  getAgenteFlowRuns,
  getAgenteExecutionState,
  releaseAgenteReservation,
  type AgenteExecutionState,
  type AgenteFlowRunLog,
  type AgenteFlowRunTrace,
  type FlowRunTraceStatus,
} from "@/app/services/orquestador-trpc";
import {
  subscribeRobotRealtime,
  type RobotRealtimeMessage,
} from "@/app/services/robot-realtime";

type TraceableFlowRun = {
  uuid_flow_run: string;
  uuid_agente_flujo: string;
  uuid_flujo: string;
  nombre_flujo: string;
  status: FlowRunTraceStatus;
  queue_position: number | null;
  created_at: string;
  queued_at: string;
  started_at: string;
  finished_at: string;
  duration_ms: number | null;
  error_message: string;
  logs: AgenteFlowRunLog[];
  source: "poll" | "realtime";
  flow_document?: unknown;
  runtime_input?: Record<string, unknown>;
};

export type { TraceableFlowRun };

type MonitorSummary = {
  queued: number;
  running: number;
  success: number;
  failed: number;
  avgDurationMs: number | null;
};

const POLL_INTERVAL_MS = 8000;
const MAX_LOG_LINES = 100;
const MAX_RUNS_IN_MEMORY = 150;

const normalizeEventType = (payload: RobotRealtimeMessage): string => {
  const eventType =
    payload.type || payload.event || payload.name || payload.kind || "";

  return String(eventType).toLowerCase();
};

const extractData = (
  payload: RobotRealtimeMessage,
): Record<string, unknown> => {
  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }

  return payload;
};

const parseStatus = (
  rawStatus: unknown,
  fallbackEventType: string,
): FlowRunTraceStatus => {
  const status = String(rawStatus || "").toLowerCase();

  if (["queued", "enqueued", "pending"].includes(status)) {
    return "queued";
  }

  if (status === "cancelling") return "cancelling";

  if (["running", "processing", "in_progress", "started"].includes(status)) {
    return "running";
  }

  if (["success", "completed", "done", "ok", "succeeded"].includes(status)) {
    return "success";
  }

  if (["failed", "error", "errored", "timeout"].includes(status)) {
    return "failed";
  }

  if (["cancelled", "cancelled", "aborted"].includes(status)) {
    return "cancelled";
  }

  if (
    fallbackEventType.includes("queue") ||
    fallbackEventType.includes("queued")
  ) {
    return "queued";
  }

  if (
    fallbackEventType.includes("start") ||
    fallbackEventType.includes("running")
  ) {
    return "running";
  }

  if (
    fallbackEventType.includes("success") ||
    fallbackEventType.includes("completed")
  ) {
    return "success";
  }

  if (
    fallbackEventType.includes("fail") ||
    fallbackEventType.includes("error")
  ) {
    return "failed";
  }

  return "unknown";
};

const toIsoString = (value: unknown): string => {
  if (!value) {
    return "";
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString();
};

const deriveDurationMs = (run: Partial<TraceableFlowRun>): number | null => {
  if (typeof run.duration_ms === "number") {
    return run.duration_ms;
  }

  if (!run.started_at || !run.finished_at) {
    return null;
  }

  const start = new Date(run.started_at).getTime();
  const end = new Date(run.finished_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }

  return end - start;
};

const normalizeRunTrace = (
  run: Partial<AgenteFlowRunTrace> & Record<string, unknown>,
  source: "poll" | "realtime",
): TraceableFlowRun | null => {
  const uuidFlowRun = String(run.uuid_flow_run || run.flow_run_id || "");

  if (!uuidFlowRun) {
    return null;
  }

  const status = parseStatus(run.status, "");

  return {
    uuid_flow_run: uuidFlowRun,
    uuid_agente_flujo: String(run.uuid_agente_flujo || ""),
    uuid_flujo: String(run.uuid_flujo || ""),
    nombre_flujo: String(run.nombre_flujo || run.flow_name || ""),
    status,
    queue_position:
      typeof run.queue_position === "number" ? run.queue_position : null,
    created_at: toIsoString(run.created_at),
    queued_at: toIsoString(run.queued_at || run.created_at),
    started_at: toIsoString(run.started_at),
    finished_at: toIsoString(run.finished_at),
    duration_ms:
      typeof run.duration_ms === "number"
        ? run.duration_ms
        : typeof run.durationMs === "number"
          ? run.durationMs
          : null,
    error_message: String(run.error_message || run.error || ""),
    logs: Array.isArray(run.logs) ? (run.logs as AgenteFlowRunLog[]) : [],
    flow_document: pickFlowDocument(run),
    runtime_input: pickRuntimeInput(run),
    source,
  };
};

const mapToLog = (
  payload: Record<string, unknown>,
  fallbackMessage: string,
): AgenteFlowRunLog => {
  const message =
    String(payload.message || payload.log || payload.text || fallbackMessage) ||
    "log";

  return {
    id: payload.id ? String(payload.id) : undefined,
    level: payload.level ? String(payload.level) : "info",
    message,
    created_at: payload.created_at
      ? String(payload.created_at)
      : new Date().toISOString(),
    node_id: payload.node_id ? String(payload.node_id) : undefined,
    meta:
      payload.meta && typeof payload.meta === "object"
        ? (payload.meta as Record<string, unknown>)
        : undefined,
  };
};

const pickFlowDocument = (payload: Record<string, unknown>): unknown => {
  const direct =
    payload.document || payload.flow_document || payload.flowDocument;
  if (direct && typeof direct === "object") {
    return direct;
  }

  if (payload.flow && typeof payload.flow === "object") {
    const nested = (payload.flow as Record<string, unknown>).document;
    if (nested && typeof nested === "object") {
      return nested;
    }
  }

  return undefined;
};

const pickRuntimeInput = (
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const runtime = payload.runtime;
  if (runtime && typeof runtime === "object") {
    return runtime as Record<string, unknown>;
  }

  const runtimeInput =
    payload.runtimeInput || payload.runtime_input || payload.input;
  if (runtimeInput && typeof runtimeInput === "object") {
    return { input: runtimeInput as Record<string, unknown> };
  }

  return undefined;
};

export const useFlowMonitorStore = defineStore("flow-monitor", {
  state: () => ({
    loading: false,
    status: "Sin datos de cola aun.",
    monitorAgentId: "",
    queue: [] as TraceableFlowRun[],
    executionState: null as AgenteExecutionState | null,
    runs: [] as TraceableFlowRun[],
    lastSyncedAt: "",
    realtimeEvents: 0,
    pollError: "",
    realtimeError: "",
    unsubscribeRealtime: null as null | (() => void),
    pollTimer: null as number | null,
  }),
  getters: {
    summary(state): MonitorSummary {
      const all = state.runs;
      const completed = all.filter(
        (run) => run.status === "success" || run.status === "failed",
      );
      const durationCandidates = completed
        .map((run) => deriveDurationMs(run))
        .filter((value): value is number => typeof value === "number");

      const avgDurationMs =
        durationCandidates.length > 0
          ? Math.round(
              durationCandidates.reduce((acc, value) => acc + value, 0) /
                durationCandidates.length,
            )
          : null;

      return {
        queued: all.filter((run) => run.status === "queued").length,
        running: all.filter((run) => run.status === "running").length,
        success: all.filter((run) => run.status === "success").length,
        failed: all.filter((run) => run.status === "failed").length,
        avgDurationMs,
      };
    },
  },
  actions: {
    async resumeQueueAfterReview(runId: string) {
      const agentId = this.monitorAgentId;
      if (!agentId || this.executionState?.uuid_flow_run !== runId || !this.executionState.requires_reconciliation)
        throw new Error("Actualiza el estado de la cola antes de continuar.");
      await window.robot.stopAllFlows();
      const snapshot = await window.robot.commandSnapshot();
      if (snapshot.lease) throw new Error("El robot todavía está deteniendo la ejecución. Espera y vuelve a intentarlo.");
      if (agentId !== this.monitorAgentId) throw new Error("El agente vinculado cambió.");
      await releaseAgenteReservation(agentId, runId);
      await this.refreshFromServer({ quiet: true });
    },
    getRunById(uuidFlowRun: string) {
      if (!uuidFlowRun) {
        return null;
      }

      return (
        this.runs.find((item) => item.uuid_flow_run === uuidFlowRun) ||
        this.queue.find((item) => item.uuid_flow_run === uuidFlowRun) ||
        null
      );
    },

    upsertRun(run: TraceableFlowRun) {
      const index = this.runs.findIndex(
        (item) => item.uuid_flow_run === run.uuid_flow_run,
      );

      if (index >= 0) {
        const mergedLogs = [
          ...(this.runs[index].logs || []),
          ...(run.logs || []),
        ].slice(-MAX_LOG_LINES);

        const merged: TraceableFlowRun = {
          ...this.runs[index],
          ...run,
          logs: mergedLogs,
          duration_ms: deriveDurationMs({ ...this.runs[index], ...run }),
        };

        this.runs.splice(index, 1, merged);
      } else {
        this.runs.unshift({
          ...run,
          duration_ms: deriveDurationMs(run),
          logs: (run.logs || []).slice(-MAX_LOG_LINES),
        });
      }

      this.runs = this.runs
        .slice()
        .sort((a, b) => {
          const aTime =
            new Date(
              a.started_at || a.queued_at || a.created_at || 0,
            ).getTime() || 0;
          const bTime =
            new Date(
              b.started_at || b.queued_at || b.created_at || 0,
            ).getTime() || 0;

          return bTime - aTime;
        })
        .slice(0, MAX_RUNS_IN_MEMORY);
    },

    replaceQueue(queueRuns: TraceableFlowRun[]) {
      this.queue = queueRuns.slice().sort((a, b) => {
        const aPos = a.queue_position ?? Number.MAX_SAFE_INTEGER;
        const bPos = b.queue_position ?? Number.MAX_SAFE_INTEGER;
        return aPos - bPos;
      });
    },

    pushRealtimeLog(uuidFlowRun: string, log: AgenteFlowRunLog) {
      const index = this.runs.findIndex(
        (item) => item.uuid_flow_run === uuidFlowRun,
      );
      if (index < 0) {
        return;
      }

      const logs = [...this.runs[index].logs, log].slice(-MAX_LOG_LINES);
      this.runs.splice(index, 1, {
        ...this.runs[index],
        logs,
      });
    },

    ingestRealtimeMessage(message: RobotRealtimeMessage) {
      const eventType = normalizeEventType(message);
      if (!eventType || eventType === "ack") {
        return;
      }

      const payload = extractData(message);
      const uuidFlowRun = String(
        payload.uuid_flow_run || payload.flow_run_id || "",
      );

      if (!uuidFlowRun) {
        return;
      }

      this.realtimeEvents += 1;

      if (eventType.includes("log")) {
        this.pushRealtimeLog(
          uuidFlowRun,
          mapToLog(payload, `Evento ${eventType}`),
        );
        return;
      }

      const status = parseStatus(payload.status, eventType);

      const run: TraceableFlowRun = {
        uuid_flow_run: uuidFlowRun,
        uuid_agente_flujo: String(payload.uuid_agente_flujo || ""),
        uuid_flujo: String(payload.uuid_flujo || ""),
        nombre_flujo: String(payload.nombre_flujo || payload.flow_name || ""),
        status,
        queue_position:
          typeof payload.queue_position === "number"
            ? payload.queue_position
            : null,
        created_at: toIsoString(payload.created_at),
        queued_at: toIsoString(payload.queued_at || payload.created_at),
        started_at: toIsoString(payload.started_at),
        finished_at: toIsoString(payload.finished_at),
        duration_ms:
          typeof payload.duration_ms === "number"
            ? payload.duration_ms
            : typeof payload.durationMs === "number"
              ? payload.durationMs
              : null,
        error_message: String(payload.error_message || payload.error || ""),
        logs: eventType.includes("log")
          ? [mapToLog(payload, `Evento ${eventType}`)]
          : [],
        flow_document: pickFlowDocument(payload),
        runtime_input: pickRuntimeInput(payload),
        source: "realtime",
      };

      this.upsertRun(run);

      if (status === "queued") {
        const queueIndex = this.queue.findIndex(
          (item) => item.uuid_flow_run === uuidFlowRun,
        );
        if (queueIndex < 0) {
          this.queue.push(run);
        }
      }

      if (["running", "success", "failed", "cancelled"].includes(status)) {
        this.queue = this.queue.filter(
          (item) => item.uuid_flow_run !== uuidFlowRun,
        );
      }

      this.lastSyncedAt = new Date().toISOString();
    },

    rememberQueuedRun(run: {
      uuid_flow_run: string;
      uuid_agente_flujo: string;
      uuid_flujo: string;
      nombre_flujo: string;
    }) {
      const trace: TraceableFlowRun = {
        ...run,
        status: "queued",
        queue_position: null,
        created_at: new Date().toISOString(),
        queued_at: new Date().toISOString(),
        started_at: "",
        finished_at: "",
        duration_ms: null,
        error_message: "",
        logs: [
          {
            level: "info",
            message: "Run agregado a la cola manualmente.",
            created_at: new Date().toISOString(),
          },
        ],
        source: "realtime",
      };

      this.upsertRun(trace);
      this.queue = [
        trace,
        ...this.queue.filter(
          (item) => item.uuid_flow_run !== trace.uuid_flow_run,
        ),
      ];
      this.status = `Run ${trace.uuid_flow_run} en cola.`;
    },

    async cancelRun(uuidFlowRun: string) {
      const run = this.getRunById(uuidFlowRun);

      if (!run) {
        throw new Error("No se encontro el run para cancelar.");
      }

      if (!["queued", "running"].includes(run.status)) {
        throw new Error("Solo se pueden cancelar runs en cola o en ejecucion.");
      }

      const response = await cancelAgenteFlowRun({
        uuid_flow_run: uuidFlowRun,
      });
      const latest = this.getRunById(uuidFlowRun) || run;
      if (["success", "failed", "cancelled"].includes(latest.status)) return;
      this.upsertRun({
        ...latest,
        status: parseStatus(response.data.current_status, ""),
        finished_at: response.data.cancelled
          ? new Date().toISOString()
          : run.finished_at,
      });
      if (response.data.cancelled)
        this.queue = this.queue.filter(
          (item) => item.uuid_flow_run !== uuidFlowRun,
        );
      this.status = response.data.cancelled
        ? "Ejecución cancelada."
        : "Cancelación solicitada; esperando al robot.";
    },

    async refreshFromServer(options?: { quiet?: boolean }) {
      if (!this.monitorAgentId) {
        this.runs = [];
        this.queue = [];
        this.executionState = null;
        this.status = "Vincula un agente para monitorear flujos.";
        return;
      }

      this.loading = !options?.quiet;
      this.pollError = "";
      const agentId = this.monitorAgentId;

      try {
        const [queueData, runsData, executionState] = await Promise.all([
          getAgenteFlowQueue({ uuid_agente: agentId }),
          getAgenteFlowRuns({ uuid_agente: agentId, limit: 80 }),
          getAgenteExecutionState(agentId),
        ]);
        if (agentId !== this.monitorAgentId) return;
        this.executionState = executionState;

        const normalizedQueue = (queueData || [])
          .map((run) => normalizeRunTrace(run, "poll"))
          .filter((run): run is TraceableFlowRun => Boolean(run));

        const normalizedRuns = (runsData || [])
          .map((run) => normalizeRunTrace(run, "poll"))
          .filter((run): run is TraceableFlowRun => Boolean(run));

        this.replaceQueue(normalizedQueue);
        normalizedRuns.forEach((run) => this.upsertRun(run));

        this.lastSyncedAt = new Date().toISOString();
        this.status = `Cola: ${this.queue.length} | Historial: ${this.runs.length}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pollError = message;
        this.status = `No se pudo actualizar la trazabilidad: ${message}`;
      } finally {
        this.loading = false;
      }
    },

    start(agentId: string) {
      this.monitorAgentId = agentId;

      if (!this.unsubscribeRealtime) {
        this.unsubscribeRealtime = subscribeRobotRealtime((payload) => {
          try {
            this.ingestRealtimeMessage(payload);
          } catch (error) {
            this.realtimeError =
              error instanceof Error ? error.message : String(error);
          }
        });
      }

      this.refreshFromServer();

      if (this.pollTimer) {
        window.clearInterval(this.pollTimer);
      }

      this.pollTimer = window.setInterval(() => {
        this.refreshFromServer({ quiet: true });
      }, POLL_INTERVAL_MS);
    },

    stop() {
      if (this.pollTimer) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }

      if (this.unsubscribeRealtime) {
        this.unsubscribeRealtime();
        this.unsubscribeRealtime = null;
      }
    },
  },
});
