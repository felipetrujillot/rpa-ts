import sharp from "sharp";
import { createError } from "h3";
import {
  MAX_IMAGE_ASSET_BYTES,
  type ImageAssetContentType,
} from "@rpa/contracts";

export async function inspectImage(data: Buffer, declaredType: string) {
  if (!data.length || data.length > MAX_IMAGE_ASSET_BYTES)
    throw createError({
      statusCode: 413,
      message: "La imagen debe pesar entre 1 byte y 10 MiB.",
    });
  try {
    const image = sharp(data, {
      limitInputPixels: 25_000_000,
      failOn: "warning",
      animated: true,
    });
    const metadata = await image.metadata();
    const types: Record<string, ImageAssetContentType> = {
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    const contentType = types[metadata.format ?? ""];
    if (
      !contentType ||
      contentType !== declaredType ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error("Formato no permitido.");
    // Decode as well as checking the header: truncated/corrupt images are rejected.
    await image.stats();
    return { contentType, width: metadata.width!, height: metadata.height! };
  } catch {
    throw createError({
      statusCode: 415,
      message:
        "Sube una imagen PNG, JPEG o WebP válida, estática y de hasta 25 megapíxeles.",
    });
  }
}
