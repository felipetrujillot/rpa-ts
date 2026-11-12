import { vincularAgenteInputSchema } from "@rpa/contracts";
import { publicProcedure } from "../../trpc";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { db } from "~~/server/db";
import { and, eq, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { signAgentToken } from "~~/server/auth";
import {
  checkPairingRateLimit,
  generateRefreshToken,
  hashRefreshToken,
  isPairingAvailable,
  REFRESH_TTL_MS,
} from "~~/server/auth/pairing";

export default publicProcedure
  .input(vincularAgenteInputSchema)
  .mutation(async ({ ctx, input }) => {
    checkPairingRateLimit(`pair:${ctx.publicIp || "unknown"}`);
    const [agent] = await db
      .select()
      .from(agentes)
      .where(eq(agentes.codigo_vinculacion, input.codigo_vinculacion))
      .limit(1);
    const now = new Date();
    if (!agent || !isPairingAvailable(agent, now))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Código inválido, utilizado o expirado.",
      });
    const session_id = randomUUID();
    const refresh_token = generateRefreshToken();
    // Sign before consuming the code: a bad server configuration must not consume it.
    const token = await signAgentToken({
      uuid_agente: agent.uuid_agente,
      uuid_empresa: agent.uuid_empresa,
      nombre: agent.nombre,
      session_id,
    });
    const result = await db
      .update(agentes)
      .set({
        estado: "offline",
        session_id,
        refresh_token_hash: hashRefreshToken(refresh_token),
        refresh_token_expira: new Date(now.getTime() + REFRESH_TTL_MS),
        codigo_vinculacion: null,
        codigo_vinculacion_expira: null,
        hostname: input.hostname || null,
        sistema_operativo: input.sistema_operativo || null,
        sistema_operativo_version: input.sistema_operativo_version || null,
        arquitectura: input.arquitectura || null,
        version_electron: input.version_electron || null,
        updated_at: now,
      })
      .where(
        and(
          eq(agentes.uuid_agente, agent.uuid_agente),
          eq(agentes.uuid_empresa, agent.uuid_empresa),
          eq(agentes.estado, "pendiente"),
          eq(agentes.codigo_vinculacion, input.codigo_vinculacion),
          gt(agentes.codigo_vinculacion_expira, now),
        ),
      );
    if (result[0].affectedRows !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Código ya utilizado o expirado.",
      });
    return {
      status: "ok" as const,
      data: {
        token,
        refresh_token,
        agente: {
          uuid_agente: agent.uuid_agente,
          uuid_empresa: agent.uuid_empresa,
          nombre: agent.nombre,
        },
      },
    };
  });
