import { z } from "zod";
// Assets are immutable. Workflows keep this ID, never a disk path or bucket URL.
export const MAX_IMAGE_ASSET_BYTES = 10 * 1024 * 1024;
export const IMAGE_ASSET_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type ImageAssetContentType = (typeof IMAGE_ASSET_CONTENT_TYPES)[number];
export type ImageAsset = {
  id: string;
  originalName: string;
  contentType: ImageAssetContentType;
  byteLength: number;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
};
export type ImageAssetPage = { items: ImageAsset[]; nextCursor: string | null };

export const imageAssetSchema = z.object({
  id: z.string().uuid(),
  originalName: z.string().min(1).max(255),
  contentType: z.enum(IMAGE_ASSET_CONTENT_TYPES),
  byteLength: z.number().int().min(1).max(MAX_IMAGE_ASSET_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(25_000_000),
  height: z.number().int().positive().max(25_000_000),
  createdAt: z.string().datetime(),
});
