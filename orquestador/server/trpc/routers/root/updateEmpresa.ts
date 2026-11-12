import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { empresas } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

function cleanUndefined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export default rootProcedure
  .input(
    z.object({
      logo_empresa: z.string().url().optional(),
      firma_empresa_png: z.string().url().optional(),
      publickey: z.string().optional(),
      accesstoken: z.string().optional(),
      uuid_empresa: z.string(),
      nombre_empresa: z.string().min(2).optional(),
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
      .update(empresas)
      .set(
        cleanUndefined({
          nombre: input.nombre_empresa?.trim(),
          logo_empresa: input.logo_empresa?.trim(),
          firma_empresa_png: input.firma_empresa_png?.trim(),
          tipo_pasarela: "mercadopago",
          publickey: input.publickey?.trim(),
          accesstoken: input.accesstoken?.trim(),
          updated_at: new Date(),
        }),
      )
      .where(eq(empresas.uuid_empresa, input.uuid_empresa));

    return {
      status: "ok" as const,
      uuid_empresa: input.uuid_empresa,
    };
  });
