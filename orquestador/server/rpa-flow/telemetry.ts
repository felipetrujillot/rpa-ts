import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  collectSecretValues,
  redactTelemetry,
  type TelemetryPacket,
} from "@rpa/contracts";
import { db } from "~~/server/db";
import {
  agentes,
  agentCommands,
  agentReservations,
  flowRuns,
  flowNodeRuns,
  runArtifacts,
  runTelemetryReceipts,
  executionAudit,
} from "~~/server/db/schema/schema";

type Identity = { uuid_empresa: string; uuid_agente: string };
export const persistTelemetry = async (
  identity: Identity,
  packet: TelemetryPacket,
) =>
  db.transaction(async (tx) => {
    // Same mutex as dispatch, cancellation and terminal reports.
    const [agent] = await tx
      .select({ id: agentes.uuid_agente })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_empresa, identity.uuid_empresa),
          eq(agentes.uuid_agente, identity.uuid_agente),
        ),
      )
      .for("update");
    if (!agent) return false;
    const [command] = await tx
      .select()
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.uuid_empresa, identity.uuid_empresa),
          eq(agentCommands.uuid_agente, identity.uuid_agente),
          eq(agentCommands.command_id, packet.command_id),
          eq(agentCommands.uuid_flow_run, packet.uuid_flow_run),
          eq(agentCommands.lease_token, packet.lease_token),
          eq(agentCommands.kind, "run_flow"),
          inArray(agentCommands.status, ["accepted", "completed"]),
        ),
      );
    if (!command) return false;
    const [run] = await tx
      .select()
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, identity.uuid_empresa),
          eq(flowRuns.uuid_agente, identity.uuid_agente),
          eq(flowRuns.uuid_flow_run, packet.uuid_flow_run),
        ),
      )
      .for("update");
    if (!run) return false;
    // Acknowledge late deliveries after erasure without restoring deleted evidence.
    if (run.telemetry_deleted_at) return true;
    if (command.status !== "completed") {
      const [lease] = await tx
        .select()
        .from(agentReservations)
        .where(
          and(
            eq(agentReservations.uuid_empresa, identity.uuid_empresa),
            eq(agentReservations.uuid_agente, identity.uuid_agente),
            eq(agentReservations.uuid_flow_run, packet.uuid_flow_run),
            eq(agentReservations.lease_token, packet.lease_token),
          ),
        );
      if (!lease) return false;
    }
    const [receipt] = await tx
      .select()
      .from(runTelemetryReceipts)
      .where(eq(runTelemetryReceipts.event_id, packet.event_id));
    if (receipt)
      return (
        receipt.uuid_empresa === identity.uuid_empresa &&
        receipt.command_id === packet.command_id
      );
    const payload = command.payload as {
      document?: {
        workflow?: {
          nodes?: Array<{
            id: string;
            name: string;
            type: string;
            sensitiveOutput?: boolean;
          }>;
          settings?: { maxNodeExecutions: number };
        };
      };
    };
    const secrets = collectSecretValues(command.payload);
    if (packet.payload.kind === "node") {
      const event = packet.payload.event;
      const definition = payload.document?.workflow?.nodes?.find(
        (node) => node.id === event.node.nodeId,
      );
      if (
        !definition ||
        definition.name !== event.node.nodeName ||
        definition.type !== event.node.type ||
        event.executionIndex >
          (payload.document?.workflow?.settings?.maxNodeExecutions ?? 1000)
      )
        return false;
      const [previous] = await tx
        .select()
        .from(flowNodeRuns)
        .where(
          and(
            eq(flowNodeRuns.uuid_empresa, identity.uuid_empresa),
            eq(flowNodeRuns.uuid_flow_run, packet.uuid_flow_run),
            eq(flowNodeRuns.execution_index, event.executionIndex),
          ),
        );
      if (
        previous &&
        (previous.command_id !== packet.command_id ||
          previous.node_id !== event.node.nodeId)
      )
        return false;
      const node = event.node;
      const finished = event.phase === "finished" ? event.node : null;
      if (
        finished &&
        Date.parse(finished.finishedAt) < Date.parse(finished.startedAt)
      )
        return false;
      const values = {
        uuid_empresa: identity.uuid_empresa,
        command_id: packet.command_id,
        uuid_flow_run: packet.uuid_flow_run,
        execution_index: event.executionIndex,
        node_id: node.nodeId,
        node_name: node.nodeName,
        node_type: node.type,
        status: finished?.status ?? ("running" as const),
        started_at: new Date(node.startedAt),
        finished_at: finished ? new Date(finished.finishedAt) : null,
        output_index: finished?.outputIndex ?? 0,
        output_json: finished
          ? definition.sensitiveOutput
            ? "[REDACTED]"
            : (redactTelemetry(finished.output, secrets) ?? null)
          : null,
        error_json: finished?.error
          ? {
              ...finished.error,
              message: String(redactTelemetry(finished.error.message, secrets)),
            }
          : null,
        error_message: finished?.error
          ? String(redactTelemetry(finished.error.message, secrets)).slice(
              0,
              500,
            )
          : null,
      };
      if (!previous)
        await tx
          .insert(flowNodeRuns)
          .values({ ...values, uuid_node_run: randomUUID() });
      else if (previous.status === "running" && finished)
        await tx
          .update(flowNodeRuns)
          .set(values)
          .where(eq(flowNodeRuns.uuid_node_run, previous.uuid_node_run));
      // Start-after-finish and repeated terminal events cannot regress or change evidence.
    } else {
      const artifact = packet.payload.artifact;
      const bytes = Buffer.from(artifact.content_base64, "base64");
      const validSignature =
        artifact.content_type === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : artifact.content_type === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP";
      if (
        !validSignature ||
        bytes.length !== artifact.byte_length ||
        createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
      )
        return false;
      const [previous] = await tx
        .select({
          company: runArtifacts.uuid_empresa,
          command: runArtifacts.command_id,
          hash: runArtifacts.sha256,
        })
        .from(runArtifacts)
        .where(eq(runArtifacts.artifact_id, artifact.artifact_id));
      if (
        previous &&
        (previous.company !== identity.uuid_empresa ||
          previous.command !== packet.command_id ||
          previous.hash !== artifact.sha256)
      )
        return false;
      if (!previous) {
        await tx.insert(runArtifacts).values({
          ...artifact,
          uuid_empresa: identity.uuid_empresa,
          uuid_flow_run: packet.uuid_flow_run,
          command_id: packet.command_id,
        });
        await tx.insert(executionAudit).values({
          audit_id: randomUUID(),
          uuid_empresa: identity.uuid_empresa,
          actor_type: "agent",
          actor_id: identity.uuid_agente,
          action: "artifact.created",
          resource_id: artifact.artifact_id,
          details: {
            uuid_flow_run: packet.uuid_flow_run,
            byte_length: artifact.byte_length,
            content_type: artifact.content_type,
          },
        });
      }
    }
    await tx.insert(runTelemetryReceipts).values({
      event_id: packet.event_id,
      uuid_empresa: identity.uuid_empresa,
      uuid_flow_run: packet.uuid_flow_run,
      command_id: packet.command_id,
    });
    return true;
  });
