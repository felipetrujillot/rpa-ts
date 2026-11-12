import { assertPluginCompatibility } from "~~/server/rpa/plugin-inventory";
import {
  PROTOCOL_VERSION,
  collectSecretValues,
  redactTelemetry,
  validateFlowDocument,
  type RunReport,
  type FlowDocument,
  type RunResult,
} from "@rpa/contracts";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~~/server/db";
import {
  agentes,
  agentCommands,
  agentReservations,
  flowRuns,
  flowVersions,
  flujos,
  executionAudit,
} from "~~/server/db/schema/schema";
import { sendCommandToLiveAgent } from "~~/server/rpa/realtime-state";
import {
  isTerminal,
  resolveRunTransition,
  type RobotRunStatus,
} from "./run-state";

export const LEASE_MS = 60_000;
type Identity = { uuid_empresa: string; uuid_agente: string };
const scope = (identity: Identity) =>
  and(
    eq(agentCommands.uuid_empresa, identity.uuid_empresa),
    eq(agentCommands.uuid_agente, identity.uuid_agente),
  );

// The agent row is the database mutex: every reservation change locks the same row.
// Expiration never releases an occupied desktop; only a durable terminal report does.
export const reserveNextRun = async (identity: Identity) =>
  db.transaction(async (tx) => {
    const [agent] = await tx
      .select()
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, identity.uuid_agente),
          eq(agentes.uuid_empresa, identity.uuid_empresa),
        ),
      )
      .for("update");
    if (
      !agent ||
      !agent.session_id ||
      !["online", "offline", "ejecutando", "desconectado"].includes(
        agent.estado,
      )
    )
      return null;
    await tx
      .insert(agentReservations)
      .values(identity)
      .onDuplicateKeyUpdate({ set: { uuid_agente: identity.uuid_agente } });
    const [reservation] = await tx
      .select()
      .from(agentReservations)
      .where(eq(agentReservations.uuid_agente, identity.uuid_agente));
    if (reservation?.uuid_flow_run) return reservation;
    const [next] = await tx
      .select({
        run: flowRuns,
        definition: flowVersions.definition_json,
        nombre: flujos.nombre,
      })
      .from(flowRuns)
      .innerJoin(
        flowVersions,
        and(
          eq(flowVersions.uuid_flow_version, flowRuns.uuid_flow_version),
          eq(flowVersions.uuid_empresa, identity.uuid_empresa),
        ),
      )
      .innerJoin(
        flujos,
        and(
          eq(flujos.uuid_flujo, flowRuns.uuid_flujo),
          eq(flujos.uuid_empresa, identity.uuid_empresa),
        ),
      )
      .where(
        and(
          eq(flowRuns.uuid_empresa, identity.uuid_empresa),
          eq(flowRuns.uuid_agente, identity.uuid_agente),
          inArray(flowRuns.status, ["queued", "running", "cancelling"]),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${flowRuns.status} = 'queued' THEN 1 ELSE 0 END`,
        asc(flowRuns.created_at),
        asc(flowRuns.uuid_flow_run),
      )
      .limit(1)
      .for("update");
    if (!next) return null;
    const validation = validateFlowDocument(next.definition);
    if (!validation.ok || !validation.normalized) {
      await tx
        .update(flowRuns)
        .set({
          status: "failed",
          finished_at: new Date(),
          error_summary: "La definición no es un workflow v2 válido.",
        })
        .where(eq(flowRuns.uuid_flow_run, next.run.uuid_flow_run));
      return null;
    }
    try { assertPluginCompatibility(identity.uuid_empresa, identity.uuid_agente, validation.normalized); }
    catch (error) {
      await tx.update(flowRuns).set({ status: "failed", finished_at: new Date(), error_summary: String(error).slice(0, 500) }).where(eq(flowRuns.uuid_flow_run, next.run.uuid_flow_run));
      return null;
    }
    const lease_token = randomUUID();
    const lease_expires_at = new Date(Date.now() + LEASE_MS);
    const value = {
      ...identity,
      uuid_flow_run: next.run.uuid_flow_run,
      lease_token,
      lease_expires_at,
    };
    await tx
      .update(agentReservations)
      .set(value)
      .where(eq(agentReservations.uuid_agente, identity.uuid_agente));
    await tx
      .update(flowRuns)
      .set({
        status: next.run.status === "queued" ? "running" : next.run.status,
        updated_at: new Date(),
        started_at: next.run.started_at || new Date(),
      })
      .where(eq(flowRuns.uuid_flow_run, next.run.uuid_flow_run));
    await tx.insert(executionAudit).values({
      audit_id: randomUUID(),
      uuid_empresa: identity.uuid_empresa,
      actor_type: "system",
      actor_id: "dispatcher",
      action: "run.dispatched",
      resource_id: next.run.uuid_flow_run,
      details: { uuid_agente: identity.uuid_agente },
    });
    await tx.insert(agentCommands).values({
      ...identity,
      command_id: randomUUID(),
      uuid_flow_run: next.run.uuid_flow_run,
      lease_token,
      kind: "run_flow",
      payload: {
        uuid_flow_run: next.run.uuid_flow_run,
        uuid_agente_flujo: next.run.uuid_agente_flujo || "",
        uuid_flujo: next.run.uuid_flujo,
        nombre_flujo: next.nombre,
        document: validation.normalized,
        runtime: { input: next.run.input_json || {} },
      },
    });
    return value;
  });

export const ensureCancellationCommand = async (
  identity: Identity,
  runId: string,
) =>
  db.transaction(async (tx) => {
    await tx
      .select({ id: agentes.uuid_agente })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, identity.uuid_agente),
          eq(agentes.uuid_empresa, identity.uuid_empresa),
        ),
      )
      .for("update");
    const [reservation] = await tx
      .select()
      .from(agentReservations)
      .where(
        and(
          eq(agentReservations.uuid_agente, identity.uuid_agente),
          eq(agentReservations.uuid_empresa, identity.uuid_empresa),
          eq(agentReservations.uuid_flow_run, runId),
        ),
      );
    if (!reservation?.lease_token) return;
    const [run] = await tx
      .select()
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_flow_run, runId),
          eq(flowRuns.uuid_empresa, identity.uuid_empresa),
          eq(flowRuns.status, "cancelling"),
        ),
      );
    if (!run) return;
    await tx
      .insert(agentCommands)
      .values({
        ...identity,
        command_id: randomUUID(),
        uuid_flow_run: runId,
        kind: "cancel_flow",
        lease_token: reservation.lease_token,
        payload: { uuid_flow_run: runId },
      })
      .onDuplicateKeyUpdate({ set: { uuid_flow_run: runId } });
  });

export const deliverPendingCommands = async (identity: Identity) => {
  const [reservation] = await db
    .select()
    .from(agentReservations)
    .where(
      and(
        eq(agentReservations.uuid_agente, identity.uuid_agente),
        eq(agentReservations.uuid_empresa, identity.uuid_empresa),
      ),
    );
  if (!reservation?.uuid_flow_run) return false;
  const [run] = await db
    .select()
    .from(flowRuns)
    .where(
      and(
        eq(flowRuns.uuid_flow_run, reservation.uuid_flow_run),
        eq(flowRuns.uuid_empresa, identity.uuid_empresa),
      ),
    );
  if (!run || isTerminal(run.status)) return false;
  if (run.status === "cancelling")
    await ensureCancellationCommand(identity, run.uuid_flow_run);
  const commands = await db
    .select()
    .from(agentCommands)
    .where(
      and(
        scope(identity),
        eq(agentCommands.uuid_flow_run, run.uuid_flow_run),
        inArray(agentCommands.status, ["pending", "accepted"]),
      ),
    );
  // A never-acknowledged command can receive a fresh admission deadline; its ID and fence stay stable.
  if (
    commands.every((c) => c.status === "pending") &&
    (!reservation.lease_expires_at ||
      reservation.lease_expires_at.getTime() < Date.now())
  ) {
    reservation.lease_expires_at = new Date(Date.now() + LEASE_MS);
    await db
      .update(agentReservations)
      .set({ lease_expires_at: reservation.lease_expires_at })
      .where(
        and(
          eq(agentReservations.uuid_agente, identity.uuid_agente),
          eq(agentReservations.lease_token, reservation.lease_token!),
        ),
      );
  }
  let sent = false;
  // Never send an execution after cancellation was requested, even if its first delivery was lost.
  for (const command of commands.filter(
    (c) => run.status !== "cancelling" || c.kind === "cancel_flow",
  )) {
    const delivered = sendCommandToLiveAgent(identity.uuid_agente, {
      command: command.kind,
      data: {
        ...(command.payload as Record<string, unknown>),
        protocolVersion: PROTOCOL_VERSION,
        uuid_agente: identity.uuid_agente,
        command_id: command.command_id,
        lease_token: command.lease_token,
        lease_expires_at: reservation.lease_expires_at?.toISOString(),
        may_have_started: command.status !== "pending",
      },
    });
    if (delivered) {
      sent = true;
      await db
        .update(agentCommands)
        .set({ attempts: sql`${agentCommands.attempts} + 1` })
        .where(eq(agentCommands.command_id, command.command_id));
    }
  }
  return sent;
};

export const acknowledgeCommand = async (
  identity: Identity,
  commandId: string,
  leaseToken: string,
) => {
  await db
    .update(agentCommands)
    .set({ status: "accepted", accepted_at: new Date() })
    .where(
      and(
        scope(identity),
        eq(agentCommands.command_id, commandId),
        eq(agentCommands.lease_token, leaseToken),
        eq(agentCommands.status, "pending"),
      ),
    );
  const [command] = await db
    .select({ status: agentCommands.status })
    .from(agentCommands)
    .where(
      and(
        scope(identity),
        eq(agentCommands.command_id, commandId),
        eq(agentCommands.lease_token, leaseToken),
      ),
    );
  return command?.status === "accepted" || command?.status === "completed";
};

export const renewReservation = async (
  identity: Identity,
  runId: string,
  leaseToken: string,
) => {
  const lease_expires_at = new Date(Date.now() + LEASE_MS);
  const result = await db
    .update(agentReservations)
    .set({ lease_expires_at })
    .where(
      and(
        eq(agentReservations.uuid_agente, identity.uuid_agente),
        eq(agentReservations.uuid_empresa, identity.uuid_empresa),
        eq(agentReservations.uuid_flow_run, runId),
        eq(agentReservations.lease_token, leaseToken),
        eq(agentReservations.requires_reconciliation, 0),
      ),
    );
  return result[0].affectedRows ? lease_expires_at.toISOString() : null;
};

export const persistRunReport = async (identity: Identity, report: RunReport) =>
  db.transaction(async (tx) => {
    await tx
      .select({ id: agentes.uuid_agente })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, identity.uuid_agente),
          eq(agentes.uuid_empresa, identity.uuid_empresa),
        ),
      )
      .for("update");
    const [command] = await tx
      .select()
      .from(agentCommands)
      .where(
        and(
          scope(identity),
          eq(agentCommands.command_id, report.command_id),
          eq(agentCommands.uuid_flow_run, report.uuid_flow_run),
          eq(agentCommands.lease_token, report.lease_token),
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
          eq(flowRuns.uuid_flow_run, report.uuid_flow_run),
        ),
      )
      .for("update");
    if (!run) return false;
    if (isTerminal(run.status)) return true;
    const [reservation] = await tx
      .select()
      .from(agentReservations)
      .where(
        and(
          eq(agentReservations.uuid_agente, identity.uuid_agente),
          eq(agentReservations.uuid_flow_run, run.uuid_flow_run),
          eq(agentReservations.lease_token, report.lease_token),
        ),
      );
    if (!reservation) return false;
    const nextStatus = report.requires_reconciliation
      ? "failed"
      : resolveRunTransition(run.status, report.status);
    if (!nextStatus) return false;
    const secrets = collectSecretValues(command.payload);
    const privateNodes = (
      (command.payload as { document?: FlowDocument }).document?.workflow
        .nodes ?? []
    ).filter((node) => node.sensitiveOutput);
    for (const node of privateNodes)
      secrets.push(
        ...collectSecretValues({
          secret: report.result?.outputs.nodeOutputs[node.id],
        }),
      );
    const safeResult = report.result
      ? {
          ...report.result,
          outputs: redactTelemetry(
            report.result.outputs,
            secrets,
          ) as RunResult["outputs"],
          error: report.result.error
            ? {
                ...report.result.error,
                message: String(
                  redactTelemetry(report.result.error.message, secrets),
                ),
              }
            : undefined,
        }
      : undefined;
    if (safeResult)
      for (const node of privateNodes) {
        if (Object.hasOwn(safeResult.outputs.nodeOutputs, node.id))
          safeResult.outputs.nodeOutputs[node.id] = "[REDACTED]";
      }
    await tx
      .update(flowRuns)
      .set({
        status: nextStatus,
        updated_at: new Date(),
        started_at: run.started_at || new Date(),
        finished_at: isTerminal(nextStatus) ? new Date() : undefined,
        error_summary: report.error_message
          ? String(redactTelemetry(report.error_message, secrets)).slice(0, 500)
          : undefined,
        output_json: isTerminal(nextStatus) ? safeResult : undefined,
      })
      .where(eq(flowRuns.uuid_flow_run, run.uuid_flow_run));
    if (isTerminal(nextStatus)) {
      await tx.insert(executionAudit).values({
        audit_id: randomUUID(),
        uuid_empresa: identity.uuid_empresa,
        actor_type: "agent",
        actor_id: identity.uuid_agente,
        action: "run.completed",
        resource_id: run.uuid_flow_run,
        details: {
          status: nextStatus,
          requires_reconciliation: report.requires_reconciliation === true,
        },
      });
      await tx
        .update(agentCommands)
        .set({ status: "completed", completed_at: new Date() })
        .where(
          and(
            scope(identity),
            eq(agentCommands.uuid_flow_run, run.uuid_flow_run),
          ),
        );
      await tx
        .update(agentReservations)
        .set(
          report.requires_reconciliation
            ? { requires_reconciliation: 1 }
            : {
                uuid_flow_run: null,
                lease_token: null,
                lease_expires_at: null,
                requires_reconciliation: 0,
              },
        )
        .where(eq(agentReservations.uuid_agente, identity.uuid_agente));
    }
    return true;
  });
