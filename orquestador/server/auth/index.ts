import { SignJWT, jwtVerify } from "jose";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agentes, usuarios } from "../db/schema/schema";
import {
  principalSchema,
  type Principal,
  type AgentPrincipal,
} from "./principal";

const jwtSecret = () => {
  const secret = useRuntimeConfig().jwtSecret;
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("NUXT_JWT_SECRET debe tener al menos 32 caracteres.");
  return new TextEncoder().encode(secret);
};
// Every transport rechecks the current database identity, including open sockets.
export const validatePrincipal = async (
  principal: Principal,
): Promise<Principal> => {
  if (principal.exp <= Math.floor(Date.now() / 1000))
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión expirada." });
  if (principal.tipo === "agente") {
    const [agent] = await db
      .select()
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, principal.uuid_agente),
          eq(agentes.uuid_empresa, principal.uuid_empresa),
          eq(agentes.session_id, principal.session_id),
        ),
      )
      .limit(1);
    if (
      !agent ||
      !["online", "offline", "ejecutando", "desconectado"].includes(
        agent.estado,
      )
    )
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión de agente revocada." });
    return { ...principal, nombre: agent.nombre };
  }
  const [user] = await db
    .select()
    .from(usuarios)
    .where(
      and(
        eq(usuarios.uuid_usuario, principal.uuid_usuario),
        eq(usuarios.uuid_empresa, principal.uuid_empresa),
        eq(usuarios.activo, 1),
      ),
    )
    .limit(1);
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sesión de usuario revocada." });
  return {
    ...principal,
    role: user.role,
    nombre: user.nombre,
    email: user.email,
  };
};
export const desencriptaToken = async (
  bearerToken: string,
): Promise<Principal> => {
  const { payload } = await jwtVerify(
    bearerToken.replace(/^Bearer\s+/i, ""),
    jwtSecret(),
    {
      algorithms: ["HS256"],
      issuer: "rpa",
      audience: "rpa",
    },
  );
  return validatePrincipal(principalSchema.parse(payload));
};
export const signAgentToken = (agent: Omit<AgentPrincipal, "tipo" | "exp">) =>
  new SignJWT({ ...agent, tipo: "agente" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("rpa")
    .setAudience("rpa")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtSecret());
export const hashPasswordBcrypt = (password: string) =>
  bcrypt.hash(password, 10);
export type BcryptUsuario = {
  activo: number;
  uuid_usuario: string;
  role: number;
  uuid_empresa: string;
  logo_empresa: string | null;
  nombre: string;
  email: string;
  created_at: Date;
  updated_at?: Date | null;
};
export const signUserToken = (user: BcryptUsuario) =>
  new SignJWT({
    tipo: "usuario",
    activo: user.activo,
    uuid_usuario: user.uuid_usuario,
    uuid_empresa: user.uuid_empresa,
    role: user.role,
    nombre: user.nombre,
    email: user.email,
    logo_empresa: user.logo_empresa,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("rpa")
    .setAudience("rpa")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(jwtSecret());
export const bcryptToken = async (
  user: BcryptUsuario,
  password: string,
  hash: string,
) => {
  if (!(await bcrypt.compare(password, hash)))
    return { status: "err" as const, data: "Credenciales inválidas." };
  return {
    status: "ok" as const,
    data: "Login correcto",
    usuario_db: user,
    token: await signUserToken(user),
  };
};
