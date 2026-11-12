import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { hasLivePeer, sendCommandToLiveAgent } from "~~/server/rpa/realtime-state";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
      source: z.string().min(1).max(80).optional(),
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

    if (!hasLivePeer(input.uuid_agente)) {
      throw new Error("El agente no está sincronizado en tiempo real.");
    }

    const sent = sendCommandToLiveAgent(input.uuid_agente, {
      command: "capture_screenshot",
      data: {
        source: input.source || "admin-agente-detail",
        requested_at: new Date().toISOString(),
      },
    });

    if (!sent) {
      throw new Error("No fue posible solicitar el screenshot al agente.");
    }

    return {
      status: "ok" as const,
      data: {
        requested: true,
      },
    };
  });
