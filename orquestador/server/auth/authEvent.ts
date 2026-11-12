import { createError, getCookie, getHeader, type H3Event } from "h3";
import { desencriptaToken } from "./index";
import { requireUser } from "./principal";
export const authPrincipalEvent = async (event: H3Event) => {
  const token = getHeader(event, "authorization") || getCookie(event, "token");
  if (!token)
    throw createError({
      statusCode: 401,
      message: "Se requiere autenticación.",
    });
  try {
    return await desencriptaToken(token);
  } catch {
    throw createError({
      statusCode: 401,
      message: "Sesión inválida o expirada.",
    });
  }
};
export const authEvent = async (event: H3Event) => {
  const principal = await authPrincipalEvent(event);
  if (principal.tipo !== "usuario")
    throw createError({
      statusCode: 401,
      message: "Se requiere una sesión de usuario.",
    });
  return requireUser(principal);
};
