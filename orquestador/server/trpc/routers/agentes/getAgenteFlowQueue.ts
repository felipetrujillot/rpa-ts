import { getAgenteFlowQueueInputSchema } from "@rpa/contracts";
import { assertAgentAccess } from "~~/server/auth/principal";
import { and, asc, eq } from "drizzle-orm";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { flowRuns, flujos } from "~~/server/db/schema/schema_flujos";
import { deviceOrUserProcedure } from "../../trpc";

export default deviceOrUserProcedure
  .input(getAgenteFlowQueueInputSchema)
  .query(async ({ ctx, input }) => {
    assertAgentAccess(ctx.user, input.uuid_agente);
    const uuid_empresa = ctx.user.uuid_empresa;
    const limit = input.limit ?? 80;

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

    const queuedRuns = await db
      .select({
        uuid_flow_run: flowRuns.uuid_flow_run,
        uuid_agente: flowRuns.uuid_agente,
        uuid_agente_flujo: flowRuns.uuid_agente_flujo,
        uuid_flujo: flowRuns.uuid_flujo,
        uuid_flow_version: flowRuns.uuid_flow_version,
        nombre_flujo: flujos.nombre,
        status: flowRuns.status,
        trigger_type: flowRuns.trigger_type,
        created_at: flowRuns.created_at,
        queued_at: flowRuns.created_at,
        started_at: flowRuns.started_at,
        finished_at: flowRuns.finished_at,
        error_message: flowRuns.error_summary,
      })
      .from(flowRuns)
      .innerJoin(flujos, eq(flujos.uuid_flujo, flowRuns.uuid_flujo))
      .where(
        and(
          eq(flujos.uuid_empresa, uuid_empresa),
          eq(flowRuns.uuid_empresa, uuid_empresa),
          eq(flowRuns.uuid_agente, input.uuid_agente),
          eq(flowRuns.status, "queued"),
        ),
      )
      .orderBy(asc(flowRuns.created_at))
      .limit(limit);

    return queuedRuns.map((run, index) => ({
      ...run,
      queue_position: index + 1,
    }));
  });
