import { setPluginInventory } from "~~/server/rpa/plugin-inventory";
import { persistTelemetry } from "~~/server/rpa-flow/telemetry";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentMessageSchema as incomingSchema,
  PROTOCOL_VERSION,
  MAX_WIRE_MESSAGE_LENGTH,
} from "@rpa/contracts";
import { validatePrincipal } from "~~/server/auth";
import { consumeSocketTicket } from "~~/server/auth/socket-tickets";
import { requireAgent, type AgentPrincipal } from "~~/server/auth/principal";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { flowRuns } from "~~/server/db/schema/schema_flujos";
import { dispatchNextQueuedFlowRunForAgent } from "~~/server/rpa-flow/queue-dispatch";
import { isTerminal } from "~~/server/rpa-flow/run-state";
import {
  acknowledgeCommand,
  persistRunReport,
  renewReservation,
} from "~~/server/rpa-flow/durable-execution";
import {
  isCurrentPeer,
  removeLivePeer,
  removeLiveStatus,
  setAgentLatestScreenshot,
  setAgentSystemMetrics,
  setLivePeer,
  setLiveStatus,
  getLiveStatusByAgent,
} from "~~/server/rpa/realtime-state";

type PeerMeta = {
  principal: AgentPrincipal;
  expiryTimer: ReturnType<typeof setTimeout>;
  pending: Promise<void>;
};
const metadata = new WeakMap<object, PeerMeta>();

export default defineWebSocketHandler({
  async open(peer) {
    try {
      const url = new URL(peer.request.url, "http://localhost");
      const principal = requireAgent(
        await validatePrincipal(
          consumeSocketTicket(url.searchParams.get("ticket") || ""),
        ),
      );
      const expiryTimer = setTimeout(
        () => peer.close(4003, "Sesión expirada"),
        Math.max(1, principal.exp * 1000 - Date.now()),
      );
      expiryTimer.unref?.();
      metadata.set(peer, {
        principal,
        expiryTimer,
        pending: Promise.resolve(),
      });
      setLivePeer(principal.uuid_agente, peer);
      const now = new Date();
      setLiveStatus(principal.uuid_agente, {
        connectedAt: now.toISOString(),
        lastHeartbeatAt: now.toISOString(),
        status: "online",
      });
      const connected = await db
        .update(agentes)
        .set({ estado: "online", ultimo_ping: now, updated_at: now })
        .where(
          and(
            eq(agentes.uuid_agente, principal.uuid_agente),
            eq(agentes.uuid_empresa, principal.uuid_empresa),
            eq(agentes.session_id, principal.session_id),
          ),
        );
      if (
        connected[0].affectedRows !== 1 ||
        !isCurrentPeer(principal.uuid_agente, peer)
      )
        throw new Error("Sesión reemplazada o revocada.");
      peer.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: "connected",
          data: { uuid_agente: principal.uuid_agente },
        }),
      );
      await dispatchNextQueuedFlowRunForAgent(
        principal.uuid_empresa,
        principal.uuid_agente,
      );
    } catch {
      peer.close(4003, "Sesión inválida o revocada");
    }
  },
  async message(peer, message) {
    const meta = metadata.get(peer);
    if (!meta || !isCurrentPeer(meta.principal.uuid_agente, peer)) {
      peer.close(4003);
      return;
    }
    // Serialize messages from one device so terminal reports cannot overtake each other.
    let messageType = "unknown";
    meta.pending = meta.pending
      .then(async () => {
        const principal = requireAgent(await validatePrincipal(meta.principal));
        const raw = message.text();
        if (raw.length > MAX_WIRE_MESSAGE_LENGTH) {
          peer.close(1009);
          return;
        }
        const parsed = incomingSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          peer.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: "error",
              message: "Mensaje inválido",
            }),
          );
          return;
        }
        const payload = parsed.data;
        messageType = payload.type;
        const now = new Date();
        if (payload.type === "heartbeat" && payload.plugins) {
          const inventory = { ...payload.plugins, sampledAt: now.toISOString() };
          await db.update(agentes).set({ plugin_inventory_json: inventory }).where(and(eq(agentes.uuid_empresa, principal.uuid_empresa), eq(agentes.uuid_agente, principal.uuid_agente)));
          setPluginInventory(principal.uuid_empresa, principal.uuid_agente, inventory);
        }
        if (payload.type === "heartbeat" && payload.system_metrics) {
          setAgentSystemMetrics(principal.uuid_agente, payload.system_metrics);
        } else if (payload.type === "command_ack") {
          if (
            await acknowledgeCommand(
              principal,
              payload.command_id,
              payload.lease_token,
            )
          ) {
            peer.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: "command_accepted",
                data: {
                  command_id: payload.command_id,
                  lease_token: payload.lease_token,
                },
              }),
            );
          }
        } else if (payload.type === "event") {
          const accepted = await persistRunReport(principal, payload.data);
          if (accepted && isTerminal(payload.data.status)) {
            peer.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: "flow_run_receipt",
                data: {
                  uuid_flow_run: payload.data.uuid_flow_run,
                  command_id: payload.data.command_id,
                },
              }),
            );
            await dispatchNextQueuedFlowRunForAgent(
              principal.uuid_empresa,
              principal.uuid_agente,
            );
          }
        } else if (payload.type === "run_telemetry") {
          if (await persistTelemetry(principal, payload.data))
            peer.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: "telemetry_receipt",
                data: { event_id: payload.data.event_id },
              }),
            );
        } else if (payload.type === "agent_screenshot") {
          setAgentLatestScreenshot(principal.uuid_agente, {
            ...payload.data,
            received_at: now.toISOString(),
            source: payload.data.source || "agent-window",
          });
        }
        const status =
          payload.type === "heartbeat"
            ? payload.status || "online"
            : getLiveStatusByAgent(principal.uuid_agente)?.status || "online";
        const connectedAt =
          getLiveStatusByAgent(principal.uuid_agente)?.connectedAt ||
          now.toISOString();
        setLiveStatus(principal.uuid_agente, {
          connectedAt,
          lastHeartbeatAt: now.toISOString(),
          status,
        });
        await db
          .update(agentes)
          .set({
            estado: status === "ejecutando" ? "ejecutando" : "online",
            ultimo_ping: now,
            updated_at: now,
          })
          .where(
            and(
              eq(agentes.uuid_agente, principal.uuid_agente),
              eq(agentes.uuid_empresa, principal.uuid_empresa),
              eq(agentes.session_id, principal.session_id),
              inArray(agentes.estado, [
                "online",
                "offline",
                "ejecutando",
                "desconectado",
              ]),
            ),
          );
        if (payload.type === "heartbeat") {
          if (payload.lease) {
            const expires = await renewReservation(
              principal,
              payload.lease.uuid_flow_run,
              payload.lease.lease_token,
            );
            if (expires)
              peer.send(
                JSON.stringify({
                  protocolVersion: PROTOCOL_VERSION,
                  type: "lease_renewed",
                  data: { ...payload.lease, lease_expires_at: expires },
                }),
              );
          }
          await dispatchNextQueuedFlowRunForAgent(
            principal.uuid_empresa,
            principal.uuid_agente,
          );
        }
        peer.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: "ack",
            data: { status, timestamp: now.toISOString() },
          }),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof TRPCError && error.code === "UNAUTHORIZED") {
          peer.close(4003, "Sesión expirada o revocada");
          return;
        }
        if (error instanceof SyntaxError) {
          peer.close(1007, "Mensaje JSON inválido");
          return;
        }
        const failure = error as { code?: string; cause?: { code?: string } };
        // Log identifiers and error codes, never payloads, SQL parameters or tokens.
        console.error("Error interno al procesar mensaje del robot", {
          uuid_agente: meta.principal.uuid_agente,
          type: messageType,
          code: failure?.cause?.code || failure?.code || "INTERNAL_ERROR",
        });
        peer.close(1011, "Error interno del servidor al procesar el mensaje");
      });
    await meta.pending;
  },
  async close(peer) {
    const meta = metadata.get(peer);
    if (!meta) return;
    clearTimeout(meta.expiryTimer);
    metadata.delete(peer);
    if (!removeLivePeer(meta.principal.uuid_agente, peer)) return;
    removeLiveStatus(meta.principal.uuid_agente);
    await db
      .update(agentes)
      .set({ estado: "offline", updated_at: new Date() })
      .where(
        and(
          eq(agentes.uuid_agente, meta.principal.uuid_agente),
          eq(agentes.uuid_empresa, meta.principal.uuid_empresa),
          eq(agentes.session_id, meta.principal.session_id),
          inArray(agentes.estado, ["online", "ejecutando"]),
        ),
      );
  },
});
