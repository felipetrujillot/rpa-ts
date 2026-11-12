import z from "zod";
import { protectedProcedure } from "../../trpc";

/**
 * Valida un token de autenticación y devuelve la información del usuario asociado.
 * @param token El token de autenticación a validar.
 * @returns La información del usuario asociada al token si es válido.
 * @throws Error si el token no es proporcionado o es inválido.
 */
export default protectedProcedure
  .input(
    z.object({
      token: z.string(),
    }),
  )
  .query(({ ctx }) => ctx.user);
