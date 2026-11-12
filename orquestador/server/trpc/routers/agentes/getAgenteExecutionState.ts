import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '~~/server/db';
import { agentReservations } from '~~/server/db/schema/schema_execution';
import { assertAgentAccess } from '~~/server/auth/principal';
import { deviceOrUserProcedure } from '../../trpc';
export default deviceOrUserProcedure.input(z.object({ uuid_agente: z.string().min(1) })).query(async ({ctx, input}) => {
  assertAgentAccess(ctx.user, input.uuid_agente);
  const [reservation] = await db.select({ uuid_flow_run: agentReservations.uuid_flow_run, lease_expires_at: agentReservations.lease_expires_at, requires_reconciliation: agentReservations.requires_reconciliation }).from(agentReservations).where(and(eq(agentReservations.uuid_empresa, ctx.user.uuid_empresa), eq(agentReservations.uuid_agente, input.uuid_agente)));
  return reservation || null;
});
