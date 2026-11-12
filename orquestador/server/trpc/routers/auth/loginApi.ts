import { db } from "~~/server/db";
import { checkPairingRateLimit } from "~~/server/auth/pairing";
import z from "zod";
import { publicProcedure } from "../../trpc";
import { and, eq } from "drizzle-orm";
import { bcryptToken } from "../../../auth/";
import { empresas, usuarios } from "~~/server/db/schema/schema";

/**
 * Login API procedure
 */
export default publicProcedure
  .input(
    z.object({
      email: z.string().email(),
      password: z.string(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    checkPairingRateLimit(`login:${ctx.publicIp || "unknown"}`);
    const { email, password: inputPass } = input;

    /**
     * busca usuario y válida que esté activo
     */
    const [usuario] = await db
      .select({
        activo: usuarios.activo,
        uuid_usuario: usuarios.uuid_usuario,
        uuid_empresa: usuarios.uuid_empresa,
        nombre: usuarios.nombre,
        role: usuarios.role,
        email: usuarios.email,
        password: usuarios.password,
        created_at: usuarios.created_at,
        logo_empresa: empresas.logo_empresa,
      })
      .from(usuarios)
      .innerJoin(empresas, eq(usuarios.uuid_empresa, empresas.uuid_empresa))
      .where(
        and(eq(usuarios.email, email.toLocaleLowerCase().replace(/\s/g, ""))),
      )
      .limit(1);

    if (!usuario) {
      return {
        status: "err" as const,
        data: "No se encontró el usuario",
      } as const;
    }
    if (usuario.activo === 0) {
      return {
        status: "err" as const,
        data: "El usuario no se encuentra activo",
      } as const;
    }

    let dbPass = String(usuario.password.replace(/\s/g, ""));

    dbPass = dbPass.replace(/^\$2y(.+)$/i, "$2a$1");

    const { password, ...usuarioSinPass } = usuario;

    const res = await bcryptToken(usuarioSinPass, inputPass, dbPass);

    return res;
  });
