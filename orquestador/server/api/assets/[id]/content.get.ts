import { defineEventHandler, setHeaders } from "h3";
import { authPrincipalEvent } from "../../../auth/authEvent";
import { readImageAsset } from "../../../assets/service";
import { assetId } from "../../../assets/http";

export default defineEventHandler(async (event) => {
  const principal = await authPrincipalEvent(event);
  const { asset, data } = await readImageAsset(
    principal.uuid_empresa,
    assetId(event),
  );
  setHeaders(event, {
    "Content-Type": asset.contentType,
    "Content-Length": String(asset.byteLength),
    "Content-Disposition": `inline; filename="${asset.id}"`,
    "X-Content-Type-Options": "nosniff",
    // Revalidate identity on every request, including after logout/session revocation.
    "Cache-Control": "private, no-store",
  });
  return data;
});
