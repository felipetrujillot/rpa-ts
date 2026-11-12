import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes, executionAudit, flowRuns } from "~~/server/db/schema/schema";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure
  .input(z.object({ uuid_agente: z.string().min(1) }))
  .mutation(({ ctx, input }) =>
    db.transaction(async (tx) => {
      // Use the dispatcher's mutex so a queued run cannot start while clearing.
      const [agent] = await tx
        .select({ id: agentes.uuid_agente })
        .from(agentes)
        .where(and(
          eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
          eq(agentes.uuid_agente, input.uuid_agente),
        ))
        .for("update");
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agente no encontrado." });

      const now = new Date();
      const [result] = await tx
        .update(flowRuns)
        .set({
          status: "cancelled", finished_at: now, updated_at: now,
          error_summary: "Cancelado al vaciar la cola desde el administrador.",
        })
        .where(and(
          eq(flowRuns.uuid_empresa, ctx.user.uuid_empresa),
          eq(flowRuns.uuid_agente, input.uuid_agente),
          eq(flowRuns.status, "queued"),
        ));
      await tx.insert(executionAudit).values({
        audit_id: randomUUID(), uuid_empresa: ctx.user.uuid_empresa,
        actor_type: "user", actor_id: ctx.user.uuid_usuario,
        action: "queue.cleared", resource_id: input.uuid_agente,
        details: { cancelled_count: result.affectedRows },
      });
      return { cancelled_count: result.affectedRows };
    }),
  );
