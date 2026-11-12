import z from "zod";
import { rootProcedure } from "../../trpc";
import { usuarios } from "hub:db:schema";
import { eq } from "drizzle-orm";
import { signUserToken } from "~~/server/auth";
import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { empresas } from "~~/server/db/schema/schema";

export default rootProcedure
  .input(
    z.object({
      uuid_usuario: z.string().min(16, "Usuario no encontrado"),
    }),
  )
  .mutation(async ({ input }) => {
    const { uuid_usuario } = input;

    const selectUser = await db
      .select({
        activo: usuarios.activo,
        uuid_usuario: usuarios.uuid_usuario,
        uuid_empresa: usuarios.uuid_empresa,
        nombre: usuarios.nombre,
        role: usuarios.role,
        email: usuarios.email,
        created_at: usuarios.created_at,
        logo_empresa: empresas.logo_empresa,
      })
      .from(usuarios)
      .innerJoin(empresas, eq(usuarios.uuid_empresa, empresas.uuid_empresa))
      .where(eq(usuarios.uuid_usuario, uuid_usuario))
      .limit(1);

    const user = selectUser[0];

    if (!user || user.activo !== 1) throw new TRPCError({ code: "NOT_FOUND" });
    const token = await signUserToken(user);

    return {
      status: "ok" as const,
      data: "Login correcto",
      usuario_db: user,
      token: token,
    };
  });
