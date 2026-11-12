import { db } from "~~/server/db";
import { desc } from "drizzle-orm";
import { empresas } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

export default rootProcedure.query(async () => {
  return db
    .select({
      uuid_empresa: empresas.uuid_empresa,
      nombre: empresas.nombre,
      created_at: empresas.created_at,
      updated_at: empresas.updated_at,
    })
    .from(empresas)
    .orderBy(desc(empresas.created_at));
});
