import { protectedProcedure, router } from "../../trpc";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { db } from "~~/server/db";
import { eq } from "drizzle-orm";

/**
 *
 */
export default protectedProcedure.query(async ({ ctx }) => {
  const { uuid_empresa } = ctx.user!;

  const findAgentes = await db
    .select()
    .from(agentes)
    .where(eq(agentes.uuid_empresa, uuid_empresa));

  return findAgentes.map(
    ({ session_id, refresh_token_hash, refresh_token_expira, ...agent }) =>
      agent,
  );
});
