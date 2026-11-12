import { createError, defineEventHandler, getQuery, setHeader } from "h3";
import { authEvent } from "../../auth/authEvent";
import { listImageAssets } from "../../assets/service";

export default defineEventHandler(async (event) => {
  const user = await authEvent(event);
  const cursor = getQuery(event).cursor;
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || !/^[a-f0-9-]{36}$/.test(cursor))
  )
    throw createError({ statusCode: 400, message: "Cursor inválido." });
  setHeader(event, "Cache-Control", "private, no-store");
  return listImageAssets(user.uuid_empresa, cursor);
});
