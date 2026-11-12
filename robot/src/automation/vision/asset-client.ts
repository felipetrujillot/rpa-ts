import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageAssetSchema, MAX_IMAGE_ASSET_BYTES } from "@rpa/contracts";
import type { ImageAssets } from "./types";

const hash = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
async function boundedBody(response: Response, limit: number) {
  if (!response.body)
    throw new Error("El orquestador devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("La respuesta de imagen supera el tamaño permitido.");
      }
      parts.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

/** Server authorization is checked before every cache read. No token reaches a worker or a workflow. */
export class OrquestadorImageAssets implements ImageAssets {
  private endpoint: URL;
  private cacheScope: string;
  constructor(
    private options: {
      trpcUrl: string;
      cacheDirectory: string;
      authenticate: () => Promise<string>;
      fetch?: typeof fetch;
    },
  ) {
    const url = new URL(options.trpcUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error(
        "El servidor de imágenes debe usar HTTPS (HTTP solo en localhost).",
      );
    if (!/\/trpc\/?$/.test(url.pathname))
      throw new Error("Endpoint del orquestador inválido.");
    url.pathname = url.pathname.replace(/\/trpc\/?$/, "/assets/");
    url.search = "";
    url.hash = "";
    this.endpoint = url;
    this.cacheScope = hash(url.href);
  }
  async load(id: string, signal?: AbortSignal): Promise<Buffer> {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw new Error("Selecciona una imagen de referencia válida.");
    signal?.throwIfAborted();
    const token = await this.options.authenticate();
    signal?.throwIfAborted();
    const request = async (path: string) => {
      const response = await (this.options.fetch ?? fetch)(
        new URL(path, this.endpoint),
        {
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `No se pudo acceder a la imagen (HTTP ${response.status}).`,
        );
      }
      return response;
    };
    const metadataResponse = await request(id);
    const metadata = imageAssetSchema.parse(
      JSON.parse((await boundedBody(metadataResponse, 4096)).toString("utf8")),
    );
    if (metadata.id !== id)
      throw new Error("El ID de imagen recibido no coincide.");
    const directory = join(this.options.cacheDirectory, this.cacheScope);
    const path = join(directory, `${id}-${metadata.sha256}`);
    try {
      const cached = await readFile(path);
      signal?.throwIfAborted();
      if (
        cached.length === metadata.byteLength &&
        hash(cached) === metadata.sha256
      )
        return cached;
      await rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const response = await request(`${id}/content`);
    const data = await boundedBody(response, MAX_IMAGE_ASSET_BYTES);
    if (
      data.length !== metadata.byteLength ||
      hash(data) !== metadata.sha256 ||
      response.headers.get("content-type")?.split(";")[0] !==
        metadata.contentType
    )
      throw new Error("La imagen descargada no coincide con sus metadatos.");
    signal?.throwIfAborted();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return data;
  }
}
