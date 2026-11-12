import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { empresas, usuarios } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

export default rootProcedure
  .input(
    z.object({
      uuid_empresa: z.string(),
    }),
  )
  .query(async ({ input }) => {
    const empresa = await db
      .select({
        tipo_pasarela: empresas.tipo_pasarela,
        logo_empresa: empresas.logo_empresa,
        firma_empresa_png: empresas.firma_empresa_png,
        publickey: empresas.publickey,
        accesstoken: empresas.accesstoken,
        uuid_empresa: empresas.uuid_empresa,
        nombre_empresa: empresas.nombre,
        nombre: empresas.nombre,
        created_at: empresas.created_at,
        updated_at: empresas.updated_at,
      })
      .from(empresas)
      .where(eq(empresas.uuid_empresa, input.uuid_empresa))
      .limit(1);

    if (!empresa[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Empresa no encontrada",
      });
    }

    const equipo = await db
      .select({
        uuid_usuario: usuarios.uuid_usuario,
        uuid_empresa: usuarios.uuid_empresa,
        nombre: usuarios.nombre,
        email: usuarios.email,
        role: usuarios.role,
        activo: usuarios.activo,
        created_at: usuarios.created_at,
        updated_at: usuarios.updated_at,
      })
      .from(usuarios)
      .where(eq(usuarios.uuid_empresa, input.uuid_empresa))
      .orderBy(desc(usuarios.created_at));

    return {
      ...empresa[0],
      usuarios: equipo,
    };
  });
