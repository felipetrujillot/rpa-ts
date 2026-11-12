import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import { createError } from "h3";
import type { ImageAsset, ImageAssetPage } from "@rpa/contracts";
import { db } from "../db";
import { assets } from "../db/schema/schema_assets";
import type { UserPrincipal } from "../auth/principal";
import { createAssetStorage } from "./storage";
import { inspectImage } from "./images";

const storage = (provider?: string) => {
  const config = useRuntimeConfig().assets;
  return createAssetStorage({
    provider: provider ?? config.provider,
    localDirectory: config.localDirectory,
    azureConnectionString: config.azureConnectionString,
    azureContainer: config.azureContainer,
  });
};
type AssetRow = typeof assets.$inferSelect;
const publicAsset = (row: AssetRow): ImageAsset => ({
  id: row.id,
  originalName: row.original_name,
  contentType: row.content_type as ImageAsset["contentType"],
  byteLength: row.byte_length,
  sha256: row.sha256,
  width: row.width,
  height: row.height,
  createdAt: row.created_at.toISOString(),
});

export async function uploadImageAsset(
  user: UserPrincipal,
  data: Buffer,
  name: string,
  declaredType: string,
): Promise<ImageAsset> {
  const originalName = name
    .trim()
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\x00-\x1f\x7f]/g, "");
  if (!originalName || originalName.length > 255)
    throw createError({
      statusCode: 400,
      message: "Nombre de imagen inválido (máximo 255 caracteres).",
    });
  const image = await inspectImage(data, declaredType);
  const store = storage();
  const row: AssetRow = {
    id: randomUUID(),
    uuid_empresa: user.uuid_empresa,
    original_name: originalName,
    content_type: image.contentType,
    byte_length: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    width: image.width,
    height: image.height,
    storage_provider: store.provider,
    storage_key: randomUUID(),
    created_by: user.uuid_usuario,
    created_at: new Date(),
  };
  await store.put(row.storage_key, data, row.content_type);
  try {
    await db.insert(assets).values(row);
  } catch (error) {
    await store.delete(row.storage_key);
    throw error;
  }
  return publicAsset(row);
}

export async function listImageAssets(
  company: string,
  cursor?: string,
): Promise<ImageAssetPage> {
  const rows = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.uuid_empresa, company),
        cursor ? lt(assets.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(assets.id))
    .limit(51);
  const page = rows.slice(0, 50);
  return {
    items: page.map(publicAsset),
    nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
  };
}

export async function getImageAsset(company: string, id: string) {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.uuid_empresa, company), eq(assets.id, id)))
    .limit(1);
  if (!row)
    throw createError({ statusCode: 404, message: "Imagen no encontrada." });
  return row;
}

export async function getImageAssetMetadata(
  company: string,
  id: string,
): Promise<ImageAsset> {
  return publicAsset(await getImageAsset(company, id));
}

export async function readImageAsset(company: string, id: string) {
  const row = await getImageAsset(company, id);
  const data = await storage(row.storage_provider).get(row.storage_key);
  if (
    data.length !== row.byte_length ||
    createHash("sha256").update(data).digest("hex") !== row.sha256
  )
    throw createError({
      statusCode: 500,
      message: "La imagen almacenada no coincide con sus metadatos.",
    });
  return { asset: publicAsset(row), data };
}
