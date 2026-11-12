import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";

/** Implement this interface for an object bucket; callers only see opaque keys. */
export interface AssetStorage {
  readonly provider: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalAssetStorage implements AssetStorage {
  readonly provider = "local";
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  private path(key: string) {
    // Only generated keys, never original filenames or client-supplied paths.
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        key,
      )
    )
      throw new Error("Clave de almacenamiento inválida.");
    return join(this.directory, key);
  }
  async put(key: string, data: Buffer, _contentType: string) {
    const path = this.path(key);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Immutable keys: never overwrite an existing asset.
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

const KEY_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Azure Blob Storage adapter. The container must stay private; access is only via the server. */
export class AzureBlobAssetStorage implements AssetStorage {
  readonly provider = "azure";
  private readonly container;
  private ensured?: Promise<unknown>;
  constructor(connectionString: string, containerName: string) {
    if (!connectionString || !containerName)
      throw new Error(
        "Azure Blob requiere NUXT_ASSETS_AZURE_CONNECTION_STRING y NUXT_ASSETS_AZURE_CONTAINER.",
      );
    this.container = BlobServiceClient.fromConnectionString(
      connectionString,
    ).getContainerClient(containerName);
  }
  private blob(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error("Clave de almacenamiento inválida.");
    return this.container.getBlockBlobClient(key);
  }
  async put(key: string, data: Buffer, contentType: string) {
    const blob = this.blob(key);
    // Private container (no public access) created on first use.
    this.ensured ??= this.container.createIfNotExists().catch((error) => {
      this.ensured = undefined;
      throw error;
    });
    await this.ensured;
    // Immutable keys: never overwrite an existing asset.
    await blob.upload(data, data.length, {
      blobHTTPHeaders: { blobContentType: contentType },
      conditions: { ifNoneMatch: "*" },
    });
  }
  get(key: string) {
    return this.blob(key).downloadToBuffer();
  }
  async delete(key: string) {
    await this.blob(key).deleteIfExists();
  }
}

export function createAssetStorage(config: {
  provider: string;
  localDirectory: string;
  azureConnectionString?: string;
  azureContainer?: string;
}): AssetStorage {
  switch (config.provider) {
    case "local":
      return new LocalAssetStorage(config.localDirectory);
    case "azure":
      return new AzureBlobAssetStorage(
        config.azureConnectionString ?? "",
        config.azureContainer ?? "",
      );
    default:
      throw new Error(`Proveedor de assets no disponible: ${config.provider}`);
  }
}
