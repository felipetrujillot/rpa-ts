import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { signAgentToken } from "~~/server/auth";
import {
  checkPairingRateLimit,
  matchesRefreshToken,
} from "~~/server/auth/pairing";
import { publicProcedure } from "../../trpc";
export default publicProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1).max(255),
      refresh_token: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    checkPairingRateLimit(`refresh:${ctx.publicIp || "unknown"}`);
    const [agent] = await db
      .select()
      .from(agentes)
      .where(eq(agentes.uuid_agente, input.uuid_agente))
      .limit(1);
    if (
      !agent ||
      !agent.session_id ||
      !["online", "offline", "ejecutando", "desconectado"].includes(
        agent.estado,
      ) ||
      !agent.refresh_token_expira ||
      agent.refresh_token_expira <= new Date() ||
      !matchesRefreshToken(input.refresh_token, agent.refresh_token_hash)
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Credencial de agente inválida o expirada. Vuelve a vincular el equipo.",
      });
    }
    const token = await signAgentToken({
      uuid_agente: agent.uuid_agente,
      uuid_empresa: agent.uuid_empresa,
      nombre: agent.nombre,
      session_id: agent.session_id,
    });
    return { token };
  });
