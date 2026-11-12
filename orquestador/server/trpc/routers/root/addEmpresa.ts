import { db } from "~~/server/db";
import { z } from "zod";
import { empresas } from "~~/server/db/schema/schema";
import { createUuid } from "~~/server/utils/crypto";
import { rootProcedure } from "../../trpc";

export default rootProcedure
  .input(
    z.object({
      nombre: z.string().min(2, "Nombre requerido"),
      publickey: z.string().optional(),
      accesstoken: z.string().optional(),
    }),
  )
  .mutation(async ({ input }) => {
    const uuid_empresa = createUuid();

    await db.insert(empresas).values({
      uuid_empresa,
      nombre: input.nombre.trim(),
      tipo_pasarela: "mercadopago",
      publickey: input.publickey?.trim(),
      accesstoken: input.accesstoken?.trim(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    return {
      status: "ok" as const,
      uuid_empresa,
    };
  });
