import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { usuarios } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

export default rootProcedure
  .input(
    z.object({
      uuid_usuario: z.string(),
      uuid_empresa: z.string(),
    }),
  )
  .mutation(async ({ input }) => {
    const found = await db
      .select({ uuid_usuario: usuarios.uuid_usuario })
      .from(usuarios)
      .where(
        and(
          eq(usuarios.uuid_usuario, input.uuid_usuario),
          eq(usuarios.uuid_empresa, input.uuid_empresa),
        ),
      )
      .limit(1);

    if (!found[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Usuario no encontrado",
      });
    }

    await db
      .delete(usuarios)
      .where(
        and(
          eq(usuarios.uuid_usuario, input.uuid_usuario),
          eq(usuarios.uuid_empresa, input.uuid_empresa),
        ),
      );

    return {
      status: "ok" as const,
      uuid_usuario: input.uuid_usuario,
    };
  });
