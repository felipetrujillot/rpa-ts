import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { disconnectLiveAgent } from "~~/server/rpa/realtime-state";
import { protectedProcedure } from "../../trpc";
export default protectedProcedure
  .input(z.object({ uuid_agente: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const result = await db
      .update(agentes)
      .set({
        estado: "revocado",
        session_id: null,
        refresh_token_hash: null,
        refresh_token_expira: null,
        codigo_vinculacion: null,
        codigo_vinculacion_expira: null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
          eq(agentes.uuid_agente, input.uuid_agente),
        ),
      );
    if (!result[0].affectedRows)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agente no encontrado.",
      });
    disconnectLiveAgent(input.uuid_agente);
    return { status: "ok" as const };
  });
