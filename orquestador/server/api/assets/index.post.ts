import {
  createError,
  defineEventHandler,
  getHeader,
  getQuery,
  setHeader,
  setResponseStatus,
} from "h3";
import { IMAGE_ASSET_CONTENT_TYPES } from "@rpa/contracts";
import { authEvent } from "../../auth/authEvent";
import { readImageUpload } from "../../assets/http";
import { uploadImageAsset } from "../../assets/service";

export default defineEventHandler(async (event) => {
  const user = await authEvent(event);
  const type =
    getHeader(event, "content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!IMAGE_ASSET_CONTENT_TYPES.some((value) => value === type))
    throw createError({
      statusCode: 415,
      message: "Formatos permitidos: PNG, JPEG y WebP.",
    });
  const name = getQuery(event).name;
  if (typeof name !== "string")
    throw createError({
      statusCode: 400,
      message: "Falta el nombre de la imagen.",
    });
  const data = await readImageUpload(event);
  const asset = await uploadImageAsset(user, data, name, type);
  setHeader(event, "Cache-Control", "private, no-store");
  setResponseStatus(event, 201);
  return asset;
});
