import { getLiveStatusSnapshot } from "~~/server/rpa/realtime-state";
import { authEvent } from "~~/server/auth/authEvent";
import { db } from "~~/server/db";
import { agentes } from "~~/server/db/schema/schema_agentes";
import { eq } from "drizzle-orm";
export default defineEventHandler(async (event) => {
  const user = await authEvent(event);
  const owned = await db
    .select({ id: agentes.uuid_agente })
    .from(agentes)
    .where(eq(agentes.uuid_empresa, user.uuid_empresa));
  const snapshot = getLiveStatusSnapshot();
  const state = Object.fromEntries(
    owned.filter(({ id }) => snapshot[id]).map(({ id }) => [id, snapshot[id]]),
  );
  return { status: "ok", data: state, timestamp: new Date().toISOString() };
});
