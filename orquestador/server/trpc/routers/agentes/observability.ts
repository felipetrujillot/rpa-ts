import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import {
  artifactInputSchema,
  runDetailInputSchema,
  metricsInputSchema,
  retentionPolicySchema,
  type OperationalMetrics,
} from "@rpa/contracts";
import {
  assertAgentAccess,
  type UserPrincipal,
} from "~~/server/auth/principal";
import { db } from "~~/server/db";
import {
  flowRuns,
  flowNodeRuns,
  runArtifacts,
  executionAudit,
  tenantRetentionPolicies,
} from "~~/server/db/schema/schema";
import {
  deleteRunEvidence,
  getRetentionPolicy,
  purgeExpiredEvidence,
} from "~~/server/rpa-flow/retention";
import { deviceOrUserProcedure, protectedProcedure } from "../../trpc";
const requireAdmin = (user: UserPrincipal) => {
  if (user.role !== 0 && user.role !== 1)
    throw new TRPCError({ code: "FORBIDDEN" });
};
export const getFlowRunDetail = deviceOrUserProcedure
  .input(runDetailInputSchema)
  .query(async ({ ctx, input }) => {
    const [run] = await db
      .select()
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, ctx.user.uuid_empresa),
          eq(flowRuns.uuid_flow_run, input.uuid_flow_run),
        ),
      );
    if (!run) throw new TRPCError({ code: "NOT_FOUND" });
    if (ctx.user.tipo === "agente")
      assertAgentAccess(ctx.user, run.uuid_agente ?? "");
    const nodes = await db
      .select()
      .from(flowNodeRuns)
      .where(
        and(
          eq(flowNodeRuns.uuid_empresa, ctx.user.uuid_empresa),
          eq(flowNodeRuns.uuid_flow_run, run.uuid_flow_run),
          gt(flowNodeRuns.execution_index, input.after),
        ),
      )
      .orderBy(flowNodeRuns.execution_index)
      .limit(input.limit);
    const artifacts = await db
      .select({
        artifact_id: runArtifacts.artifact_id,
        content_type: runArtifacts.content_type,
        byte_length: runArtifacts.byte_length,
        sha256: runArtifacts.sha256,
        created_at: runArtifacts.created_at,
      })
      .from(runArtifacts)
      .where(
        and(
          eq(runArtifacts.uuid_empresa, ctx.user.uuid_empresa),
          eq(runArtifacts.uuid_flow_run, run.uuid_flow_run),
        ),
      )
      .limit(200);
    // Runtime input is execution data, not an operational log. Do not expose it here.
    const { input_json, ...metadata } = run;
    return {
      run: metadata,
      nodes,
      artifacts,
      nextAfter: nodes.at(-1)?.execution_index ?? input.after,
    };
  });
export const getRunArtifact = protectedProcedure
  .input(artifactInputSchema)
  .query(async ({ ctx, input }) =>
    db.transaction(async (tx) => {
      const [artifact] = await tx
        .select()
        .from(runArtifacts)
        .where(
          and(
            eq(runArtifacts.uuid_empresa, ctx.user.uuid_empresa),
            eq(runArtifacts.artifact_id, input.artifact_id),
          ),
        );
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });
      await tx
        .insert(executionAudit)
        .values({
          audit_id: randomUUID(),
          uuid_empresa: ctx.user.uuid_empresa,
          actor_type: "user",
          actor_id: ctx.user.uuid_usuario,
          action: "artifact.read",
          resource_id: artifact.artifact_id,
        });
      return {
        artifact_id: artifact.artifact_id,
        content_type: artifact.content_type,
        byte_length: artifact.byte_length,
        image_data_url: `data:${artifact.content_type};base64,${artifact.content_base64}`,
      };
    }),
  );
export const getExecutionMetrics = protectedProcedure
  .input(metricsInputSchema)
  .query(async ({ ctx, input }): Promise<OperationalMetrics> => {
    const company = ctx.user.uuid_empresa;
    const cutoff = new Date(Date.now() - input.days * 86400000);
    const runs = await db
      .select({
        status: flowRuns.status,
        count: sql<number>`count(*)`.mapWith(Number),
        averageDurationMs: sql<
          number | null
        >`avg(timestampdiff(microsecond, ${flowRuns.started_at}, ${flowRuns.finished_at}) / 1000)`.mapWith(
          (value) => (value == null ? null : Number(value)),
        ),
      })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, company),
          gte(flowRuns.created_at, cutoff),
        ),
      )
      .groupBy(flowRuns.status);
    const [nodes] = await db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        failed:
          sql<number>`coalesce(sum(${flowNodeRuns.status} = 'failed'), 0)`.mapWith(
            Number,
          ),
        averageDurationMs: sql<
          number | null
        >`avg(timestampdiff(microsecond, ${flowNodeRuns.started_at}, ${flowNodeRuns.finished_at}) / 1000)`.mapWith(
          (value) => (value == null ? null : Number(value)),
        ),
      })
      .from(flowNodeRuns)
      .where(
        and(
          eq(flowNodeRuns.uuid_empresa, company),
          gte(flowNodeRuns.created_at, cutoff),
        ),
      );
    const [artifacts] = await db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        bytes:
          sql<number>`coalesce(sum(${runArtifacts.byte_length}), 0)`.mapWith(
            Number,
          ),
      })
      .from(runArtifacts)
      .where(eq(runArtifacts.uuid_empresa, company));
    return { days: input.days, runs, nodes: nodes!, artifacts: artifacts! };
  });
export const getExecutionAudit = protectedProcedure
  .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }))
  .query(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    return db
      .select()
      .from(executionAudit)
      .where(eq(executionAudit.uuid_empresa, ctx.user.uuid_empresa))
      .orderBy(desc(executionAudit.created_at))
      .limit(input.limit);
  });
export const getEvidenceRetention = protectedProcedure.query(({ ctx }) =>
  getRetentionPolicy(ctx.user.uuid_empresa),
);
export const setEvidenceRetention = protectedProcedure
  .input(retentionPolicySchema)
  .mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    await db.transaction(async (tx) => {
      await tx
        .insert(tenantRetentionPolicies)
        .values({
          uuid_empresa: ctx.user.uuid_empresa,
          evidence_days: input.evidenceDays,
          audit_days: input.auditDays,
        })
        .onDuplicateKeyUpdate({
          set: {
            evidence_days: input.evidenceDays,
            audit_days: input.auditDays,
            updated_at: new Date(),
          },
        });
      await tx
        .insert(executionAudit)
        .values({
          audit_id: randomUUID(),
          uuid_empresa: ctx.user.uuid_empresa,
          actor_type: "user",
          actor_id: ctx.user.uuid_usuario,
          action: "retention.updated",
          resource_id: ctx.user.uuid_empresa,
          details: input,
        });
    });
    return input;
  });
export const purgeEvidenceRetention = protectedProcedure.mutation(({ ctx }) => {
  requireAdmin(ctx.user);
  return purgeExpiredEvidence(ctx.user.uuid_empresa);
});
export const eraseFlowRunEvidence = protectedProcedure
  .input(runDetailInputSchema.pick({ uuid_flow_run: true }))
  .mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    const [run] = await db
      .select({ id: flowRuns.uuid_flow_run })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, ctx.user.uuid_empresa),
          eq(flowRuns.uuid_flow_run, input.uuid_flow_run),
        ),
      );
    if (!run) throw new TRPCError({ code: "NOT_FOUND" });
    if (
      !(await deleteRunEvidence(ctx.user.uuid_empresa, input.uuid_flow_run, {
        type: "user",
        id: ctx.user.uuid_usuario,
      }))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "La ejecución sigue activa o requiere reconciliación.",
      });
    return { erased: true as const };
  });
