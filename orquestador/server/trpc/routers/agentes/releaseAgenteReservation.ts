import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '~~/server/db';
import { agentes, agentReservations, executionAudit } from '~~/server/db/schema/schema';
import { randomUUID } from 'node:crypto';
import { assertAgentAccess } from '~~/server/auth/principal';
import { dispatchNextQueuedFlowRunForAgent } from '~~/server/rpa-flow/queue-dispatch';
import { deviceOrUserProcedure } from '../../trpc';
export default deviceOrUserProcedure.input(z.object({ uuid_agente: z.string().min(1), uuid_flow_run: z.string().min(1), confirmed_stopped_and_reviewed: z.literal(true) })).mutation(async ({ctx, input}) => {
  assertAgentAccess(ctx.user, input.uuid_agente);
  await db.transaction(async (tx) => {
    const [agent] = await tx.select({ id: agentes.uuid_agente }).from(agentes).where(and(eq(agentes.uuid_empresa, ctx.user.uuid_empresa), eq(agentes.uuid_agente, input.uuid_agente))).for('update');
    if (!agent) throw new TRPCError({code:'NOT_FOUND'});
    const [reservation] = await tx.select().from(agentReservations).where(and(eq(agentReservations.uuid_empresa, ctx.user.uuid_empresa), eq(agentReservations.uuid_agente, input.uuid_agente), eq(agentReservations.uuid_flow_run, input.uuid_flow_run)));
    if (!reservation || !reservation.requires_reconciliation || !reservation.lease_expires_at || reservation.lease_expires_at.getTime() + 30_000 > Date.now()) throw new TRPCError({code:'CONFLICT', message:'La reserva aún no puede liberarse: esperar el vencimiento y revisar los efectos.'});
    await tx.update(agentReservations).set({ uuid_flow_run:null, lease_token:null, lease_expires_at:null, requires_reconciliation:0 }).where(eq(agentReservations.uuid_agente, input.uuid_agente));
    await tx.insert(executionAudit).values({
      audit_id: randomUUID(), uuid_empresa: ctx.user.uuid_empresa,
      actor_type: ctx.user.tipo === 'agente' ? 'agent' : 'user',
      actor_id: ctx.user.tipo === 'agente' ? ctx.user.uuid_agente : ctx.user.uuid_usuario,
      action: 'reservation.released', resource_id: input.uuid_flow_run,
      details: { confirmed_stopped_and_reviewed: true },
    });
  });
  await dispatchNextQueuedFlowRunForAgent(ctx.user.uuid_empresa, input.uuid_agente);
  return {status:'ok' as const};
});
