/// <reference types="vite/client" />
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  agentMessageSchema,
} from "@rpa/contracts";
import { CommandAdmissionGate } from "../../../../automation/execution/command-admission";
import {
  AGENTE_TOKEN_STORAGE_KEY,
  createAgentSocketTicket,
} from "./orquestador-trpc";

const ORQUESTADOR_WS_URL =
  process.env.VITE_ORQUESTADOR_WS_URL || "ws://localhost:6543/api/rpa/ws";

type RobotRealtimeState = {
  socket: WebSocket | null;
  heartbeatTimer: number | null;
  connected: boolean;
  lastAckAt: string;
  lastError: string;
};

export type { RobotRealtimeMessage } from "@rpa/contracts";
import type { RobotRealtimeMessage } from "@rpa/contracts";

type RobotRealtimeListener = (message: RobotRealtimeMessage) => void;

const realtimeState: RobotRealtimeState = {
  socket: null,
  heartbeatTimer: null,
  connected: false,
  lastAckAt: "",
  lastError: "",
};

const realtimeListeners = new Set<RobotRealtimeListener>();
const activeFlowRuns = new Set<string>();
const admissions = new CommandAdmissionGate();
let reconnectTimer: number | null = null;
let stopped = true;
let generation = 0;
let reconnectAttempt = 0;
let connecting = false;
let connectionTimer: number | null = null;
const clearConnectionTimer = () => {
  if (connectionTimer !== null) window.clearTimeout(connectionTimer);
  connectionTimer = null;
};
const withConnectionTimeout = async <T>(operation: Promise<T>, step: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tiempo agotado al ${step}. Se reintentará la conexión.`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
};

let telemetryUnsubscribe: (() => void) | null = null;
let telemetryFlushing = false;
let telemetryFlushAgain = false;
const telemetrySent = new Map<string, number>();
const flushTelemetry = async (socket: WebSocket): Promise<void> => {
  if (telemetryFlushing) {
    telemetryFlushAgain = true;
    return;
  }
  telemetryFlushing = true;
  try {
    do {
      telemetryFlushAgain = false;
      const packets = await window.robot.telemetrySnapshot();
      if (
        socket !== realtimeState.socket ||
        socket.readyState !== WebSocket.OPEN
      )
        return;
      for (const packet of packets) {
        if (Date.now() - (telemetrySent.get(packet.event_id) ?? 0) < 9000)
          continue;
        sendRealtimeMessage(socket, { type: "run_telemetry", data: packet });
        telemetrySent.set(packet.event_id, Date.now());
        dispatchRealtimePayload({ type: "run_telemetry", data: packet });
      }
    } while (telemetryFlushAgain);
  } finally {
    telemetryFlushing = false;
  }
};
const flushAvailableTelemetry = () => {
  const socket = realtimeState.socket;
  if (socket?.readyState === WebSocket.OPEN)
    void flushTelemetry(socket).catch((error: unknown) => {
      realtimeState.lastError = String(error);
    });
};

const flushJournal = async (socket: WebSocket) => {
  await flushTelemetry(socket);
  const snapshot = await window.robot.commandSnapshot();
  for (const record of snapshot.records) {
    if (record.state !== "completed" || !record.result) continue;
    const payload = {
      type: "event",
      event: "flow_run_status",
      data: {
        uuid_flow_run: record.command.uuid_flow_run,
        command_id: record.command.command_id,
        lease_token: record.command.lease_token,
        status: record.result.status,
        error_message: record.result.error?.message.slice(0, 500),
        requires_reconciliation:
          record.result.error?.code === "EXECUTION_INTERRUPTED",
        result: {
          status: record.result.status,
          startedAt: record.result.startedAt,
          finishedAt: record.result.finishedAt,
          outputs: record.result.outputs,
          error: record.result.error,
        },
      },
    };
    sendRealtimeMessage(socket, payload);
    dispatchRealtimePayload(payload);
  }
  return snapshot;
};

const clearHeartbeat = (): void => {
  if (realtimeState.heartbeatTimer) {
    window.clearInterval(realtimeState.heartbeatTimer);
    realtimeState.heartbeatTimer = null;
  }
};

const sendRealtimeMessage = (
  socket: WebSocket,
  payload: Record<string, unknown>,
): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify(
      agentMessageSchema.parse({
        ...payload,
        protocolVersion: PROTOCOL_VERSION,
      }),
    ),
  );
};

const dispatchRealtimePayload = (payload: RobotRealtimeMessage): void => {
  realtimeListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // isolate listener failures
    }
  });
};

const executeFlowFromCommand = async (
  socket: WebSocket,
  payload: RobotRealtimeMessage,
): Promise<void> => {
  if (
    payload.type !== "command" ||
    payload.command !== "run_flow" ||
    !payload.data
  )
    return;
  const data = payload.data;
  const command = {
    protocolVersion: PROTOCOL_VERSION,
    command_id: String(data.command_id || ""),
    uuid_agente: String(data.uuid_agente || ""),
    uuid_flow_run: String(data.uuid_flow_run || ""),
    lease_token: String(data.lease_token || ""),
    lease_expires_at: String(data.lease_expires_at || ""),
    may_have_started: data.may_have_started === true,
    kind: "run_flow" as const,
    document: data.document as import("@rpa/contracts").FlowDocument,
    runtime: data.runtime as { input?: Record<string, unknown> },
  };
  let ownsActive = false;
  try {
    await window.robot.acceptCommand(command);
    if (socket !== realtimeState.socket || socket.readyState !== WebSocket.OPEN) return;
    const admitted = admissions.wait(command.command_id, command.lease_token);
    sendRealtimeMessage(socket, {
      type: "command_ack",
      command_id: command.command_id,
      lease_token: command.lease_token,
    });
    await admitted;
    if (activeFlowRuns.has(command.uuid_flow_run)) return;
    activeFlowRuns.add(command.uuid_flow_run);
    ownsActive = true;
    await window.robot.runCommand(command.command_id);
    if (realtimeState.socket) await flushJournal(realtimeState.socket);
  } catch (error) {
    if (socket === realtimeState.socket)
      realtimeState.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    if (ownsActive) activeFlowRuns.delete(command.uuid_flow_run);
  }
};

const sendAgentScreenshot = async (
  socket: WebSocket,
  payload: RobotRealtimeMessage,
): Promise<void> => {
  try {
    const screenshot = await window.robot.captureWindowScreenshot();

    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: "agent_screenshot",
        status: "online",
        data: {
          ...screenshot,
          source:
            typeof payload?.data?.source === "string"
              ? payload.data.source
              : "agent-window",
        },
      }),
    );
  } catch (error) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    sendRealtimeMessage(socket, {
      type: "agent_error",
      operation: "capture_screenshot",
      message: (error instanceof Error
        ? error.message
        : "No se pudo capturar la ventana."
      ).slice(0, 500),
    });
  }
};

export const getRealtimeState = (): RobotRealtimeState => realtimeState;

export const subscribeRobotRealtime = (
  listener: RobotRealtimeListener,
): (() => void) => {
  realtimeListeners.add(listener);

  return () => {
    realtimeListeners.delete(listener);
  };
};

const cancelFlowFromCommand = async (
  socket: WebSocket,
  payload: RobotRealtimeMessage,
) => {
  const data = payload.data;
  if (!data) return;
  const command = {
    protocolVersion: PROTOCOL_VERSION,
    command_id: String(data.command_id || ""),
    uuid_agente: String(data.uuid_agente || ""),
    uuid_flow_run: String(data.uuid_flow_run || ""),
    lease_token: String(data.lease_token || ""),
    lease_expires_at: String(data.lease_expires_at || ""),
    may_have_started: data.may_have_started === true,
    kind: "cancel_flow" as const,
  };
  await window.robot.acceptCommand(command);
  if (socket !== realtimeState.socket || socket.readyState !== WebSocket.OPEN) return;
  const admitted = admissions.wait(command.command_id, command.lease_token);
  sendRealtimeMessage(socket, {
    type: "command_ack",
    command_id: command.command_id,
    lease_token: command.lease_token,
  });
  await admitted;
  await window.robot.cancelCommand(command.command_id);
  if (realtimeState.socket) await flushJournal(realtimeState.socket);
};

export const disconnectRobotRealtime = (): void => {
  stopped = true;
  telemetryUnsubscribe?.();
  telemetryUnsubscribe = null;
  telemetrySent.clear();
  admissions.disconnect();
  generation++;
  connecting = false;
  reconnectAttempt = 0;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearHeartbeat();
  clearConnectionTimer();
  realtimeState.socket?.close();
  realtimeState.socket = null;
  realtimeState.connected = false;
};

export const connectRobotRealtime = (statusProvider?: () => string): void => {
  stopped = false;
  telemetryUnsubscribe ??= window.robot.onTelemetryAvailable(
    flushAvailableTelemetry,
  );
  if (
    connecting ||
    (realtimeState.socket && realtimeState.socket.readyState <= WebSocket.OPEN)
  )
    return;
  const currentGeneration = ++generation;
  const retry = () => {
    if (stopped || generation !== currentGeneration || reconnectTimer) return;
    const delay =
      Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempt++, 5)) *
      (0.75 + Math.random() * 0.5);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectRobotRealtime(statusProvider);
    }, delay);
  };
  connecting = true;
  void (async () => {
    try {
      const { token } = await withConnectionTimeout(window.robot.refreshAgentSession(), "renovar la sesión");
      if (stopped || generation !== currentGeneration) return;
      localStorage.setItem(AGENTE_TOKEN_STORAGE_KEY, token);
      const wsUrl = new URL(ORQUESTADOR_WS_URL);
      if (
        wsUrl.protocol !== "wss:" &&
        !(
          wsUrl.protocol === "ws:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(wsUrl.hostname)
        )
      )
        throw new Error(
          "La conexión al robot debe utilizar WSS fuera de localhost.",
        );
      const { ticket } = await withConnectionTimeout(createAgentSocketTicket(), "autorizar el socket");
      if (stopped || generation !== currentGeneration) return;
      wsUrl.searchParams.set("ticket", ticket);
      const socket = new WebSocket(wsUrl.toString());
      realtimeState.socket = socket;
      const renewAt = Date.now() + 45 * 60 * 1000;
      let lastResponseAt = Date.now();
      let beginHeartbeat: (() => void) | null = null;
      const retireSocket = (message: string) => {
        if (socket !== realtimeState.socket) return;
        realtimeState.lastError = message;
        realtimeState.connected = false;
        realtimeState.socket = null;
        admissions.disconnect();
        clearHeartbeat();
        clearConnectionTimer();
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.onopen = null;
        socket.close();
        retry();
      };
      clearConnectionTimer();
      connectionTimer = window.setTimeout(() => retireSocket("El servidor no confirmó la conexión WebSocket. Se reintentará."), 15_000);
      socket.onopen = () => {
        if (stopped || generation !== currentGeneration || socket !== realtimeState.socket) {
          socket.close();
          return;
        }
        telemetrySent.clear();
        let heartbeatBusy = false;
        const heartbeat = async () => {
          if (socket !== realtimeState.socket) return;
          if (Date.now() - lastResponseAt >= 30_000) {
            retireSocket("El orquestador dejó de responder. Reconectando…");
            return;
          }
          if (heartbeatBusy) return;
          heartbeatBusy = true;
          try {
            if (
              socket !== realtimeState.socket ||
              socket.readyState !== WebSocket.OPEN
            )
              return;
            if (Date.now() >= renewAt) {
              socket.close();
              return;
            }
            const snapshot = await flushJournal(socket);
            const systemMetrics = await window.robot.getSystemMetrics();
            const catalog = await window.robot.listActions();
            sendRealtimeMessage(socket, {
              type: "heartbeat",
              lease: snapshot.lease,
              system_metrics: systemMetrics,
              plugins: catalog.plugins,
              status: activeFlowRuns.size
                ? "ejecutando"
                : statusProvider?.() || "online",
            });
          } catch (error) {
            realtimeState.lastError = String(error);
          } finally {
            heartbeatBusy = false;
          }
        };
        // Wait for application-level authentication before sending work.
        beginHeartbeat = () => {
          clearHeartbeat();
          void heartbeat();
          realtimeState.heartbeatTimer = window.setInterval(heartbeat, 10_000);
        };
      };
      socket.onmessage = (event) => {
        if (socket !== realtimeState.socket) return;
        try {
          const payload = serverMessageSchema.parse(
            JSON.parse(String(event.data)),
          ) as RobotRealtimeMessage;
          lastResponseAt = Date.now();
          if (payload.type === "connected") {
            clearConnectionTimer();
            realtimeState.connected = true;
            realtimeState.lastError = "";
            reconnectAttempt = 0;
            beginHeartbeat?.();
            beginHeartbeat = null;
          }
          if (payload.type === "command_accepted")
            admissions.confirm(
              String(payload.data?.command_id || ""),
              String(payload.data?.lease_token || ""),
            );
          if (payload.type === "telemetry_receipt") {
            const eventId = String(payload.data?.event_id || "");
            void window.robot
              .telemetryReceipt(eventId)
              .then(() => {
                telemetrySent.delete(eventId);
                flushAvailableTelemetry();
              })
              .catch((error: unknown) => {
                realtimeState.lastError = String(error);
              });
          }
          if (payload.type === "flow_run_receipt")
            void window.robot
              .commandReceipt(String(payload.data?.command_id || ""))
              .catch((error: unknown) => {
                realtimeState.lastError = String(error);
              });
          if (payload.type === "lease_renewed")
            void window.robot
              .renewCommandLease(
                String(payload.data?.uuid_flow_run || ""),
                String(payload.data?.lease_token || ""),
                String(payload.data?.lease_expires_at || ""),
              )
              .catch((error: unknown) => {
                realtimeState.lastError = String(error);
              });
          if (
            payload.type === "command" &&
            payload.command === "capture_screenshot"
          )
            void sendAgentScreenshot(socket, payload);
          if (payload.type === "command" && payload.command === "cancel_flow") {
            void cancelFlowFromCommand(socket, payload).catch(
              (error: unknown) => {
                if (socket === realtimeState.socket) realtimeState.lastError = String(error);
              },
            );
          } else void executeFlowFromCommand(socket, payload);
          if (payload.type === "ack")
            realtimeState.lastAckAt = String(payload.data?.timestamp || "");
          dispatchRealtimePayload(payload);
        } catch {
          realtimeState.lastError = "Mensaje del orquestador inválido.";
        }
      };
      socket.onclose = (event) => {
        if (socket !== realtimeState.socket) return;
        if (event.code === 4003)
          void window.robot.stopAllFlows().catch((error: unknown) => {
            realtimeState.lastError = String(error);
          });
        retireSocket(event.code === 4003
          ? `El servidor rechazó la sesión: ${event.reason || "vuelve a vincular el equipo"}.`
          : `Se cerró la conexión WebSocket (${event.code}). Reconectando…`);
      };
      socket.onerror = () => {
        retireSocket("No se pudo conectar con el WebSocket del orquestador. Comprueba que el servidor esté iniciado.");
      };
    } catch (error) {
      if (generation === currentGeneration) {
        realtimeState.lastError = error instanceof Error ? error.message : String(error);
        retry();
      }
    } finally {
      if (generation === currentGeneration) connecting = false;
    }
  })();
};

// Vite replaces this module in dev; dispose its old socket and timers first.
if (import.meta.hot) import.meta.hot.dispose(disconnectRobotRealtime);
