import { z } from "zod";
import { TRPCError } from "@trpc/server";

const common = {
  uuid_empresa: z.string().min(1),
  nombre: z.string(),
  exp: z.number(),
};
export const principalSchema = z.discriminatedUnion("tipo", [
  z.object({
    ...common,
    tipo: z.literal("usuario"),
    uuid_usuario: z.string().min(1),
    role: z.number().int(),
    activo: z.literal(1),
    email: z.string(),
    logo_empresa: z.string().nullable().optional(),
  }),
  z.object({
    ...common,
    tipo: z.literal("agente"),
    uuid_agente: z.string().min(1),
    session_id: z.string().uuid(),
  }),
]);
export type Principal = z.infer<typeof principalSchema>;
export type UserPrincipal = Extract<Principal, { tipo: "usuario" }>;
export type AgentPrincipal = Extract<Principal, { tipo: "agente" }>;
export const requireUser = (principal: Principal | null): UserPrincipal => {
  if (principal?.tipo !== "usuario")
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Se requiere una sesión de usuario.",
    });
  return principal;
};
export const requireAgent = (principal: Principal | null): AgentPrincipal => {
  if (principal?.tipo !== "agente")
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Se requiere una sesión de agente.",
    });
  return principal;
};
export const assertAgentAccess = (principal: Principal, agentId: string) => {
  if (principal.tipo === "agente" && principal.uuid_agente !== agentId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Agente no encontrado.",
    });
  }
};
