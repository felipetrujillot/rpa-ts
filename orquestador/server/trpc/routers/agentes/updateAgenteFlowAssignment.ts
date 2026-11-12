import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agenteFlujos } from "~~/server/db/schema/schema_flujos";
import { protectedProcedure } from "../../trpc";
import { scheduleSettings, scheduleTimezoneSchema } from "~~/server/rpa-flow/schedule-settings";

export default protectedProcedure
  .input(
    z.object({
      uuid_agente_flujo: z.string().min(1),
      cron_expression: z.string().trim().max(120),
      schedule_timezone: scheduleTimezoneSchema.optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;
    const existing = await db
      .select({ uuid_agente_flujo: agenteFlujos.uuid_agente_flujo, schedule_timezone: agenteFlujos.schedule_timezone })
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
      .set({
        ...scheduleSettings(input.cron_expression, input.schedule_timezone ?? existing[0].schedule_timezone),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(agenteFlujos.uuid_agente_flujo, input.uuid_agente_flujo),
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
        ),
      );

    return { status: "ok" as const };
  });
