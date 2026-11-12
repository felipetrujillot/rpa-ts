import { randomBytes } from "node:crypto";
import type { AgentPrincipal } from "./principal";

const tickets = new Map<
  string,
  { principal: AgentPrincipal; expiresAt: number }
>();
export const issueSocketTicket = (principal: AgentPrincipal) => {
  for (const [ticket, value] of tickets)
    if (value.expiresAt <= Date.now()) tickets.delete(ticket);
  if (tickets.size >= 10_000)
    throw new Error("No hay capacidad para nuevas conexiones.");
  const ticket = randomBytes(32).toString("hex");
  tickets.set(ticket, {
    principal,
    expiresAt: Math.min(Date.now() + 30_000, principal.exp * 1000),
  });
  return { ticket };
};
export const consumeSocketTicket = (ticket: string): AgentPrincipal => {
  const value = tickets.get(ticket);
  tickets.delete(ticket);
  if (!value || value.expiresAt <= Date.now())
    throw new Error("Ticket de conexión inválido o expirado.");
  return value.principal;
};
