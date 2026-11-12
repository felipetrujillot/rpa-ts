import { createError, getHeader, getRouterParam, type H3Event } from "h3";
import { MAX_IMAGE_ASSET_BYTES } from "@rpa/contracts";

export const assetId = (event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (
    !id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw createError({ statusCode: 404, message: "Imagen no encontrada." });
  return id;
};

export async function readImageUpload(event: H3Event): Promise<Buffer> {
  const tooLarge = () =>
    createError({
      statusCode: 413,
      message: "La imagen supera el máximo de 10 MiB.",
    });
  if (Number(getHeader(event, "content-length")) > MAX_IMAGE_ASSET_BYTES)
    throw tooLarge();
  // Read directly from the Node request to cap memory even without Content-Length.
  // On overflow discard the rest rather than destroying the socket before sending 413.
  return new Promise((resolve, reject) => {
    const request = event.node.req;
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_IMAGE_ASSET_BYTES) {
        cleanup();
        request.resume();
        reject(tooLarge());
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAborted = () =>
      onError(
        createError({
          statusCode: 400,
          message: "Carga de imagen interrumpida.",
        }),
      );
    request
      .on("data", onData)
      .once("end", onEnd)
      .once("error", onError)
      .once("aborted", onAborted);
  });
}
