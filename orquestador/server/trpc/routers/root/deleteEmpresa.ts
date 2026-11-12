import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { empresas, usuarios } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

export default rootProcedure
  .input(
    z.object({
      uuid_empresa: z.string(),
    }),
  )
  .mutation(async ({ input }) => {
    const found = await db
      .select({ uuid_empresa: empresas.uuid_empresa })
      .from(empresas)
      .where(eq(empresas.uuid_empresa, input.uuid_empresa))
      .limit(1);

    if (!found[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Empresa no encontrada",
      });
    }

    await db
      .delete(usuarios)
      .where(eq(usuarios.uuid_empresa, input.uuid_empresa));

    await db
      .delete(empresas)
      .where(eq(empresas.uuid_empresa, input.uuid_empresa));

    return {
      status: "ok" as const,
      uuid_empresa: input.uuid_empresa,
    };
  });
