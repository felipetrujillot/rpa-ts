import { hasLivePeer } from '~~/server/rpa/realtime-state';
import { deliverPendingCommands, reserveNextRun } from './durable-execution';

export const dispatchNextQueuedFlowRunForAgent = async (uuid_empresa: string, uuid_agente: string) => {
  if (!uuid_empresa || !uuid_agente) return { dispatched: false as const, reason: 'missing-context' as const };
  if (!hasLivePeer(uuid_agente)) return { dispatched: false as const, reason: 'agent-offline' as const };
  const identity = { uuid_empresa, uuid_agente };
  const reservation = await reserveNextRun(identity);
  if (!reservation) return { dispatched: false as const, reason: 'empty-queue' as const };
  const sent = await deliverPendingCommands(identity);
  return { dispatched: sent, reason: sent ? undefined : 'send-failed' as const, uuid_flow_run: reservation.uuid_flow_run || undefined };
};
