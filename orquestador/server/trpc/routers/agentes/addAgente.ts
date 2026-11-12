import { z } from "zod";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { newUuid } from "~~/server/utils/uuid";
import { db } from "~~/server/db";
import { generatePairingCode, PAIRING_TTL_MS } from "~~/server/auth/pairing";
import { protectedProcedure } from "../../trpc";
export default protectedProcedure
  .input(z.object({ nombre: z.string().trim().min(1).max(255) }))
  .mutation(async ({ ctx, input }) => {
    const uuid_agente = newUuid();
    const codigo_vinculacion = generatePairingCode();
    const codigo_vinculacion_expira = new Date(Date.now() + PAIRING_TTL_MS);
    await db
      .insert(agentes)
      .values({
        uuid_empresa: ctx.user.uuid_empresa,
        uuid_agente,
        nombre: input.nombre,
        estado: "pendiente",
        codigo_vinculacion,
        codigo_vinculacion_expira,
      });
    return {
      status: "ok" as const,
      data: {
        uuid_agente,
        nombre: input.nombre,
        codigo_vinculacion,
        codigo_vinculacion_expira,
      },
    };
  });
