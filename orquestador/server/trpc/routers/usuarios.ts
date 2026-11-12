import { protectedProcedure, router } from "../trpc";
//import { db } from "~~/server/db/db";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "~~/server/db";
import { usuarios } from "~~/server/db/schema/schema";

/**
 *
 */
export const usuariosTrpc = router({
  /**
   *
   */
  getUserById: protectedProcedure
    .input(
      z.object({
        uuid_usuario: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { uuid_usuario } = input;
      const findUser = await db
        .select({
          nombre: usuarios.nombre,
          email: usuarios.email,
          uuid_usuario: usuarios.uuid_usuario,
          activo: usuarios.activo,
        })
        .from(usuarios)
        .where(
          and(
            eq(usuarios.uuid_usuario, uuid_usuario),
            eq(usuarios.uuid_empresa, ctx.user.uuid_empresa),
          ),
        );

      return findUser[0];
    }),
});
