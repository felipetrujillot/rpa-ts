import { protectedProcedure, router } from "../../trpc";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { db } from "~~/server/db";
import { and, eq } from "drizzle-orm";
import z from "zod";

/**
 *
 */
export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const { uuid_empresa } = ctx.user!;
    const { uuid_agente } = input;

    const findAgentes = await db
      .select()
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_empresa, uuid_empresa),
          eq(agentes.uuid_agente, uuid_agente),
        ),
      );

    return findAgentes.map(
      ({ session_id, refresh_token_hash, refresh_token_expira, ...agent }) =>
        agent,
    );
  });
