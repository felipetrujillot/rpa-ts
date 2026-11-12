import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { validateFlowDocument } from "@rpa/contracts";
import { db } from "~~/server/db";
import {
  agenteFlujos,
  flowRuns,
  flowVersions,
  flujos,
  agentes,
  executionAudit,
} from "~~/server/db/schema/schema";
import { upcomingSchedule } from "~~/shared/schedule";
import { dispatchNextQueuedFlowRunForAgent } from "./queue-dispatch";

// The assignment row serializes each occurrence across simultaneous task runners.
// Advancing the cursor and enqueueing happen in the same database transaction.
export async function enqueueScheduledAssignment(id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(agenteFlujos)
      .where(eq(agenteFlujos.uuid_agente_flujo, id))
      .for("update");
    if (
      !assignment ||
      assignment.activo !== 1 ||
      !assignment.cron_expression ||
      (assignment.next_scheduled_at && assignment.next_scheduled_at > now)
    )
      return null;

    let next: Date;
    try {
      next = upcomingSchedule(
        assignment.cron_expression,
        assignment.schedule_timezone,
        now,
        1,
      )[0]!;
    } catch (error) {
      await tx
        .update(agenteFlujos)
        .set({
          next_scheduled_at: null,
          scheduling_error: (error as Error).message,
        })
        .where(eq(agenteFlujos.uuid_agente_flujo, id));
      return { state: "invalid" as const };
    }
    const advance = (error: string | null = null) =>
      tx
        .update(agenteFlujos)
        .set({ next_scheduled_at: next, scheduling_error: error })
        .where(eq(agenteFlujos.uuid_agente_flujo, id));
    // Legacy assignments are initialized prospectively; saving also resets the cursor.
    if (!assignment.next_scheduled_at) {
      await advance();
      return { state: "initialized" as const };
    }

    const [agent] = await tx
      .select({ id: agentes.uuid_agente })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, assignment.uuid_agente),
          eq(agentes.uuid_empresa, assignment.uuid_empresa),
        ),
      );
    const [version] = await tx
      .select({
        id: flowVersions.uuid_flow_version,
        definition: flowVersions.definition_json,
      })
      .from(flowVersions)
      .innerJoin(
        flujos,
        and(
          eq(flujos.uuid_flujo, flowVersions.uuid_flujo),
          eq(flujos.uuid_empresa, assignment.uuid_empresa),
          eq(flujos.estado_publicacion, "published"),
        ),
      )
      .where(
        and(
          eq(flowVersions.uuid_empresa, assignment.uuid_empresa),
          eq(flowVersions.uuid_flujo, assignment.uuid_flujo),
          eq(flowVersions.estado, "published"),
          assignment.uuid_flow_version
            ? eq(flowVersions.uuid_flow_version, assignment.uuid_flow_version)
            : undefined,
        ),
      )
      .orderBy(desc(flowVersions.version_number))
      .limit(1);
    if (!agent || !version || !validateFlowDocument(version.definition).ok) {
      await advance(
        "No hay un agente y una versión publicada válida para ejecutar esta asignación.",
      );
      return { state: "unavailable" as const };
    }
    const [pending] = await tx
      .select({ id: flowRuns.uuid_flow_run })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, assignment.uuid_empresa),
          eq(flowRuns.uuid_agente_flujo, id),
          inArray(flowRuns.status, ["queued", "running", "cancelling"]),
        ),
      )
      .limit(1);
    await advance();
    if (pending) return { state: "busy" as const };

    const runId = randomUUID();
    await tx.insert(flowRuns).values({
      uuid_flow_run: runId,
      uuid_empresa: assignment.uuid_empresa,
      uuid_agente: assignment.uuid_agente,
      uuid_flujo: assignment.uuid_flujo,
      uuid_flow_version: version.id,
      uuid_agente_flujo: id,
      trigger_type: "schedule",
      status: "queued",
      input_json: {},
      created_at: now,
      updated_at: now,
    });
    await tx.insert(executionAudit).values({
      audit_id: randomUUID(),
      uuid_empresa: assignment.uuid_empresa,
      actor_type: "system",
      actor_id: "scheduler",
      action: "run.scheduled",
      resource_id: runId,
      details: {
        uuid_agente_flujo: id,
        scheduled_at: assignment.next_scheduled_at.toISOString(),
        timezone: assignment.schedule_timezone,
      },
    });
    return {
      state: "queued" as const,
      uuid_empresa: assignment.uuid_empresa,
      uuid_agente: assignment.uuid_agente,
      runId,
    };
  });
}

export async function runAssignmentSchedules(now = new Date()) {
  const result = { queued: 0, skipped: 0, errors: 0 };
  let cursor = "";
  for (;;) {
    const batch = await db
      .select({ id: agenteFlujos.uuid_agente_flujo })
      .from(agenteFlujos)
      .where(
        and(
          eq(agenteFlujos.activo, 1),
          isNotNull(agenteFlujos.cron_expression),
          gt(agenteFlujos.uuid_agente_flujo, cursor),
          or(
            lte(agenteFlujos.next_scheduled_at, now),
            and(
              isNull(agenteFlujos.next_scheduled_at),
              isNull(agenteFlujos.scheduling_error),
            ),
          ),
        ),
      )
      .orderBy(asc(agenteFlujos.uuid_agente_flujo))
      .limit(100);
    if (!batch.length) break;
    for (const item of batch) {
      try {
        const occurrence = await enqueueScheduledAssignment(item.id, now);
        if (occurrence?.state === "queued") {
          result.queued++;
          await dispatchNextQueuedFlowRunForAgent(
            occurrence.uuid_empresa,
            occurrence.uuid_agente,
          );
        } else if (
          occurrence?.state === "invalid" ||
          occurrence?.state === "unavailable"
        )
          result.errors++;
        else result.skipped++;
      } catch (error) {
        result.errors++;
        console.error("No se pudo procesar la programación", item.id, error);
      }
    }
    cursor = batch.at(-1)!.id;
  }
  return result;
}
