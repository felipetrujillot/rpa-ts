import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { disconnectLiveAgent } from "~~/server/rpa/realtime-state";
import { agentProcedure } from "../../trpc";

export default agentProcedure
  .input(z.object({}).optional())
  .mutation(async ({ ctx }) => {
    if (ctx.user?.tipo !== "agente" || !ctx.user.uuid_agente) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Solo un agente autenticado puede desvincularse.",
      });
    }

    const result = await db
      .update(agentes)
      .set({
        estado: "desvinculado",
        session_id: null,
        refresh_token_hash: null,
        refresh_token_expira: null,
        codigo_vinculacion: null,
        codigo_vinculacion_expira: null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(agentes.uuid_agente, ctx.user.uuid_agente),
          eq(agentes.uuid_empresa, ctx.user.uuid_empresa),
          eq(agentes.session_id, ctx.user.session_id),
        ),
      );

    if (!result || result[0].affectedRows === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No se encontró el agente para desvincular.",
      });
    }

    disconnectLiveAgent(ctx.user.uuid_agente);
    return {
      status: "ok" as const,
      data: {
        uuid_agente: ctx.user.uuid_agente,
        estado: "desvinculado" as const,
      },
    };
  });
