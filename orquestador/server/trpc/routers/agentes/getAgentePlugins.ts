import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { pluginInventorySchema } from "@rpa/contracts";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { getPluginInventory } from "~~/server/rpa/plugin-inventory";
import { protectedProcedure } from "../../trpc";

export default protectedProcedure
  .input(
    z.object({
      uuid_agente: z.string().min(1),
    }),
  )
  .query(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const foundAgent = await db
      .select({ uuid_agente: agentes.uuid_agente, inventory: agentes.plugin_inventory_json })
      .from(agentes)
      .where(
        and(
          eq(agentes.uuid_agente, input.uuid_agente),
          eq(agentes.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);

    if (!foundAgent[0]) {
      throw new Error("Agente no encontrado.");
    }

    return getPluginInventory(uuid_empresa, input.uuid_agente) ?? pluginInventorySchema.safeParse(foundAgent[0].inventory).data ?? null;
  });
