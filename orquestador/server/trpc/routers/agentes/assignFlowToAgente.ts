import { validateFlowDocument } from "@rpa/contracts";
import { assertPluginCompatibility } from "~~/server/rpa/plugin-inventory";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { agenteFlujos, flujos, flowVersions } from "~~/server/db/schema/schema_flujos";
import { newUuid } from "~~/server/utils/uuid";
import { protectedProcedure } from "../../trpc";
import { scheduleSettings, scheduleTimezoneSchema } from "~~/server/rpa-flow/schedule-settings";

export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
      uuid_flujo: z.string().min(1),
      cron_expression: z.string().trim().max(120).optional(),
      schedule_timezone: scheduleTimezoneSchema.optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

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

    const foundFlow = await db
      .select({ uuid_flujo: flujos.uuid_flujo })
      .from(flujos)
      .where(
        and(
          eq(flujos.uuid_flujo, input.uuid_flujo),
          eq(flujos.uuid_empresa, uuid_empresa),
        //  eq(flujos.estado_publicacion, "published"),
        ),
      )
      .limit(1);

    if (!foundFlow[0]) {
      throw new Error("Flujo publicado no encontrado.");
    }

    const [published] = await db.select({ definition: flowVersions.definition_json }).from(flowVersions)
      .where(and(eq(flowVersions.uuid_empresa, uuid_empresa), eq(flowVersions.uuid_flujo, input.uuid_flujo), eq(flowVersions.estado, "published")))
      .orderBy(desc(flowVersions.version_number)).limit(1);
    if (published) {
      const checked = validateFlowDocument(published.definition);
      if (!checked.ok || !checked.normalized) throw new Error("Versión publicada inválida.");
      assertPluginCompatibility(uuid_empresa, input.uuid_agente, checked.normalized);
    }
    const existing = await db
      .select({ uuid_agente_flujo: agenteFlujos.uuid_agente_flujo, schedule_timezone: agenteFlujos.schedule_timezone })
      .from(agenteFlujos)
      .where(
        and(
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
          eq(agenteFlujos.uuid_agente, input.uuid_agente),
          eq(agenteFlujos.uuid_flujo, input.uuid_flujo),
        ),
      )
      .limit(1);

    const schedule = scheduleSettings(input.cron_expression, input.schedule_timezone ?? existing[0]?.schedule_timezone);

    if (existing[0]) {
      await db
        .update(agenteFlujos)
        .set({
          ...schedule,
          activo: 1,
          updated_at: new Date(),
        })
        .where(eq(agenteFlujos.uuid_agente_flujo, existing[0].uuid_agente_flujo));

      return {
        status: "ok" as const,
        data: {
          uuid_agente_flujo: existing[0].uuid_agente_flujo,
          uuid_agente: input.uuid_agente,
          uuid_flujo: input.uuid_flujo,
          upserted: "updated" as const,
        },
      };
    }

    const uuid_agente_flujo = newUuid();

    await db.insert(agenteFlujos).values({
      uuid_agente_flujo,
      uuid_empresa,
      uuid_agente: input.uuid_agente,
      uuid_flujo: input.uuid_flujo,
      ...schedule,
      activo: 1,
      created_by: ctx.user?.uuid_usuario,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return {
      status: "ok" as const,
      data: {
        uuid_agente_flujo,
        uuid_agente: input.uuid_agente,
        uuid_flujo: input.uuid_flujo,
        upserted: "created" as const,
      },
    };
  });
