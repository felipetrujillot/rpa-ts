import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { getAgentLatestScreenshot } from "~~/server/rpa/realtime-state";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
    }),
  )
  .query(async ({ ctx, input }) => {
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

    return getAgentLatestScreenshot(input.uuid_agente);
  });
