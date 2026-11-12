import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  scriptSdkAllowedActionsSchema,
  scriptSdkActionIds,
} from "@rpa/contracts";
import { db } from "~~/server/db";
import { agentes, executionAudit } from "~~/server/db/schema/schema";
import { agentProcedure, protectedProcedure } from "../../trpc";

const agentInput = z.strictObject({ uuid_agente: z.string().min(1).max(255) });
export const getAgenteScriptPolicy = protectedProcedure
  .input(agentInput)
  .query(async ({ ctx, input }) => {
    const [agent] = await db
      .select({ actions: agentes.script_allowed_actions_json })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
          eq(agentes.uuid_agente, input.uuid_agente),
        ),
      )
      .limit(1);
    if (!agent)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agente no encontrado.",
      });
    return {
      allowedActions: scriptSdkAllowedActionsSchema.parse(agent.actions ?? []),
      canManage: [0, 1].includes(ctx.user.role),
    };
  });

export const updateAgenteScriptPolicy = protectedProcedure
  .input(agentInput.extend({ allowedActions: scriptSdkAllowedActionsSchema }))
  .mutation(async ({ ctx, input }) => {
    if (![0, 1].includes(ctx.user.role))
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Solo los administradores pueden modificar los permisos del SDK.",
      });
    return db.transaction(async (tx) => {
      const scope = and(
        eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
        eq(agentes.uuid_agente, input.uuid_agente),
      );
      const [agent] = await tx
        .select({ actions: agentes.script_allowed_actions_json })
        .from(agentes)
        .where(scope)
        .limit(1)
        .for("update");
      if (!agent)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agente no encontrado.",
        });
      await tx
        .update(agentes)
        .set({
          script_allowed_actions_json: input.allowedActions,
          updated_at: new Date(),
        })
        .where(scope);
      await tx.insert(executionAudit).values({
        audit_id: randomUUID(),
        uuid_empresa: ctx.user.uuid_empresa,
        actor_type: "user",
        actor_id: ctx.user.uuid_usuario,
        action: "script.policy.updated",
        resource_id: input.uuid_agente,
        details: {
          previous: agent.actions ?? [],
          allowedActions: input.allowedActions,
        },
      });
      return { allowedActions: input.allowedActions };
    });
  });

// Identity comes from the authenticated device session, never from workflow data.
// Read on every SDK call so a permission change takes effect without restarting the robot.
export const authorizeScriptAction = agentProcedure
  .input(
    z.strictObject({
      actionId: z
        .string()
        .refine(
          (id) => scriptSdkActionIds.includes(id),
          "Acción SDK desconocida.",
        ),
    }),
  )
  .query(async ({ ctx, input }) => {
    const [agent] = await db
      .select({
        actions: agentes.script_allowed_actions_json,
        state: agentes.estado,
      })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
          eq(agentes.uuid_agente, ctx.user.uuid_agente),
          eq(agentes.session_id, ctx.user.session_id),
        ),
      )
      .limit(1);
    if (
      !agent ||
      !["online", "offline", "ejecutando", "desconectado"].includes(agent.state)
    )
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sesión del robot no válida.",
      });
    const policy = scriptSdkAllowedActionsSchema.safeParse(agent.actions ?? []);
    return { allowed: policy.success && policy.data.includes(input.actionId) };
  });
