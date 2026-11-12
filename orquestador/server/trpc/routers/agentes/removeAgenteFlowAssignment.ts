import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agenteFlujos } from "~~/server/db/schema/schema_flujos";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure
  .input(z.object({ uuid_agente_flujo: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;
    const existing = await db
      .select({ uuid_agente_flujo: agenteFlujos.uuid_agente_flujo })
      .from(agenteFlujos)
      .where(
        and(
          eq(agenteFlujos.uuid_agente_flujo, input.uuid_agente_flujo),
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      throw new Error("Asignación no encontrada.");
    }

    await db
      .update(agenteFlujos)
      .set({ activo: 0, updated_at: new Date() })
      .where(
        and(
          eq(agenteFlujos.uuid_agente_flujo, input.uuid_agente_flujo),
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
        ),
      );

    return { status: "ok" as const };
  });
