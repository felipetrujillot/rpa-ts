import { defineEventHandler, setHeader } from "h3";
import { authPrincipalEvent } from "../../../auth/authEvent";
import { getImageAssetMetadata } from "../../../assets/service";
import { assetId } from "../../../assets/http";

export default defineEventHandler(async (event) => {
  const principal = await authPrincipalEvent(event);
  setHeader(event, "Cache-Control", "private, no-store");
  return getImageAssetMetadata(principal.uuid_empresa, assetId(event));
});
