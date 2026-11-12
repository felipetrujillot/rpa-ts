import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { PAIRING_TTL_MS } from "~~/server/auth/pairing";
import { generarCodigoVinculacion } from "~~/server/utils/uuid";
import { protectedProcedure } from "../../trpc";

const buildCodigoUnico = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const codigo = generarCodigoVinculacion();
    const existing = await db
      .select({ uuid_agente: agentes.uuid_agente })
      .from(agentes)
      .where(eq(agentes.codigo_vinculacion, codigo))
      .limit(1);

    if (!existing[0]) {
      return codigo;
    }
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "No se pudo generar un código único. Intenta nuevamente.",
  });
};

export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { uuid_empresa } = ctx.user!;

    const [agente] = await db
      .select({
        uuid_agente: agentes.uuid_agente,
        estado: agentes.estado,
      })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_empresa, uuid_empresa),
          eq(agentes.uuid_agente, input.uuid_agente),
        ),
      )
      .limit(1);

    if (!agente) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No se encontró el agente.",
      });
    }

    if (!["desvinculado", "pendiente", "revocado"].includes(agente.estado)) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Solo puedes regenerar el código de un agente pendiente o desvinculado.",
      });
    }

    const codigo_vinculacion = await buildCodigoUnico();

    const updated = await db
      .update(agentes)
      .set({
        codigo_vinculacion,
        codigo_vinculacion_expira: new Date(Date.now() + PAIRING_TTL_MS),
        session_id: null,
        refresh_token_hash: null,
        refresh_token_expira: null,
        estado: "pendiente",
        ultimo_ping: null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(agentes.uuid_agente, input.uuid_agente),
          eq(agentes.uuid_empresa, uuid_empresa),
          eq(agentes.estado, agente.estado),
        ),
      );

    if (updated[0].affectedRows !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "El agente cambió de estado. Actualiza el panel.",
      });

    return {
      status: "ok" as const,
      data: {
        uuid_agente: input.uuid_agente,
        codigo_vinculacion,
        codigo_vinculacion_expira: new Date(Date.now() + PAIRING_TTL_MS),
        estado: "pendiente" as const,
      },
    };
  });
