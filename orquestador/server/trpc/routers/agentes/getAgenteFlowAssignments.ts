import { assertAgentAccess } from "~~/server/auth/principal";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { agenteFlujos, flujos } from "~~/server/db/schema/schema_flujos";
import { deviceOrUserProcedure } from "../../trpc";

export default deviceOrUserProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
    }),
  )
  .query(async ({ ctx, input }) => {
    assertAgentAccess(ctx.user, input.uuid_agente);
    const uuid_empresa = ctx.user.uuid_empresa;

    const foundAgent = await db
      .select({ uuid_agente: agentes.uuid_agente })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, input.uuid_agente),
          eq(agentes.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);

    if (!foundAgent[0]) {
      throw new Error("Agente no encontrado.");
    }

    return db
      .select({
        uuid_agente_flujo: agenteFlujos.uuid_agente_flujo,
        uuid_agente: agenteFlujos.uuid_agente,
        uuid_flujo: agenteFlujos.uuid_flujo,
        uuid_flow_version: agenteFlujos.uuid_flow_version,
        cron_expression: agenteFlujos.cron_expression,
        schedule_timezone: agenteFlujos.schedule_timezone,
        next_scheduled_at: agenteFlujos.next_scheduled_at,
        scheduling_error: agenteFlujos.scheduling_error,
        activo: agenteFlujos.activo,
        created_at: agenteFlujos.created_at,
        updated_at: agenteFlujos.updated_at,
        nombre_flujo: flujos.nombre,
        estado_publicacion: flujos.estado_publicacion,
        version_publicada: flujos.version_publicada,
      })
      .from(agenteFlujos)
      .innerJoin(flujos, eq(flujos.uuid_flujo, agenteFlujos.uuid_flujo))
      .where(
        and(
          eq(flujos.uuid_empresa, uuid_empresa),
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
          eq(agenteFlujos.uuid_agente, input.uuid_agente),
        ),
      )
      .orderBy(desc(agenteFlujos.updated_at));
  });
