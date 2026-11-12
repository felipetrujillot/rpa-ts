import { and, desc, eq } from "drizzle-orm";
import { db } from "~~/server/db";
import { flujos } from "~~/server/db/schema/schema_flujos";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure.query(async ({ ctx }) => {
  const uuid_empresa = ctx.user!.uuid_empresa;

  return db
    .select({
      uuid_flujo: flujos.uuid_flujo,
      nombre: flujos.nombre,
      estado_publicacion: flujos.estado_publicacion,
      version_publicada: flujos.version_publicada,
      updated_at: flujos.updated_at,
    })
    .from(flujos)
    .where(
      and(
        eq(flujos.uuid_empresa, uuid_empresa),
      //  eq(flujos.estado_publicacion, "published"),
      ),
    )
    .orderBy(desc(flujos.updated_at));
});