import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
} from "drizzle-orm";
import { DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "@rpa/contracts";
import { db } from "~~/server/db";
import {
  agentes,
  empresas,
  flowRuns,
  flowNodeRuns,
  runArtifacts,
  runTelemetryReceipts,
  agentCommands,
  agentReservations,
  executionAudit,
  tenantRetentionPolicies,
} from "~~/server/db/schema/schema";
import { isTerminal } from "./run-state";
export const getRetentionPolicy = async (
  company: string,
): Promise<RetentionPolicy> => {
  const [policy] = await db
    .select()
    .from(tenantRetentionPolicies)
    .where(eq(tenantRetentionPolicies.uuid_empresa, company));
  return policy
    ? { evidenceDays: policy.evidence_days, auditDays: policy.audit_days }
    : { ...DEFAULT_RETENTION_POLICY };
};
// Keep the run's operational identity and an erasure tombstone. Late robot retries cannot recreate its evidence.
export const deleteRunEvidence = async (
  company: string,
  runId: string,
  actor: { type: "user" | "system"; id: string },
  cutoff?: Date,
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, company),
          eq(flowRuns.uuid_flow_run, runId),
        ),
      );
    if (!candidate) return false;
    if (candidate.uuid_agente)
      await tx
        .select({ id: agentes.uuid_agente })
        .from(agentes)
        .where(
          and(
            eq(agentes.uuid_empresa, company),
            eq(agentes.uuid_agente, candidate.uuid_agente),
          ),
        )
        .for("update");
    const [run] = await tx
      .select()
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, company),
          eq(flowRuns.uuid_flow_run, runId),
        ),
      )
      .for("update");
    if (
      !run ||
      !isTerminal(run.status) ||
      (cutoff && (!run.finished_at || run.finished_at >= cutoff))
    )
      return false;
    if (run.telemetry_deleted_at) return true;
    const [occupied] = await tx
      .select()
      .from(agentReservations)
      .where(
        and(
          eq(agentReservations.uuid_empresa, company),
          eq(agentReservations.uuid_flow_run, runId),
        ),
      );
    if (occupied) return false; // Evidence needed to reconcile uncertain native side effects.
    await tx
      .delete(flowNodeRuns)
      .where(
        and(
          eq(flowNodeRuns.uuid_empresa, company),
          eq(flowNodeRuns.uuid_flow_run, runId),
        ),
      );
    await tx
      .delete(runArtifacts)
      .where(
        and(
          eq(runArtifacts.uuid_empresa, company),
          eq(runArtifacts.uuid_flow_run, runId),
        ),
      );
    await tx
      .delete(runTelemetryReceipts)
      .where(
        and(
          eq(runTelemetryReceipts.uuid_empresa, company),
          eq(runTelemetryReceipts.uuid_flow_run, runId),
        ),
      );
    await tx
      .update(flowRuns)
      .set({
        telemetry_deleted_at: new Date(),
        input_json: null,
        output_json: null,
        error_summary: null,
      })
      .where(
        and(
          eq(flowRuns.uuid_empresa, company),
          eq(flowRuns.uuid_flow_run, runId),
        ),
      );
    await tx
      .update(agentCommands)
      .set({ payload: {} })
      .where(
        and(
          eq(agentCommands.uuid_empresa, company),
          eq(agentCommands.uuid_flow_run, runId),
          eq(agentCommands.status, "completed"),
        ),
      );
    await tx
      .insert(executionAudit)
      .values({
        audit_id: randomUUID(),
        uuid_empresa: company,
        actor_type: actor.type,
        actor_id: actor.id,
        action: "run.evidence_deleted",
        resource_id: runId,
        details: { reason: cutoff ? "retention" : "manual" },
      });
    return true;
  });
export const purgeExpiredEvidence = async (
  company: string,
  now = new Date(),
) => {
  const policy = await getRetentionPolicy(company);
  const cutoff = new Date(now.getTime() - policy.evidenceDays * 86400000);
  const expired = await db
    .select({ id: flowRuns.uuid_flow_run })
    .from(flowRuns)
    .where(
      and(
        eq(flowRuns.uuid_empresa, company),
        inArray(flowRuns.status, ["success", "failed", "cancelled"]),
        isNull(flowRuns.telemetry_deleted_at),
        isNotNull(flowRuns.finished_at),
        lt(flowRuns.finished_at, cutoff),
        notExists(
          db
            .select({ id: agentReservations.uuid_agente })
            .from(agentReservations)
            .where(
              and(
                eq(agentReservations.uuid_empresa, company),
                eq(agentReservations.uuid_flow_run, flowRuns.uuid_flow_run),
              ),
            ),
        ),
      ),
    )
    .orderBy(flowRuns.finished_at, flowRuns.uuid_flow_run)
    .limit(100);
  let deleted = 0;
  for (const { id } of expired)
    if (
      await deleteRunEvidence(
        company,
        id,
        { type: "system", id: "retention" },
        cutoff,
      )
    )
      deleted++;
  await db
    .delete(executionAudit)
    .where(
      and(
        eq(executionAudit.uuid_empresa, company),
        lt(
          executionAudit.created_at,
          new Date(now.getTime() - policy.auditDays * 86400000),
        ),
      ),
    );
  return { deleted, scanned: expired.length };
};
export const purgeAllExpiredEvidence = async () => {
  let deleted = 0;
  for (const { id } of await db
    .select({ id: empresas.uuid_empresa })
    .from(empresas))
    deleted += (await purgeExpiredEvidence(id)).deleted;
  return { deleted };
};
