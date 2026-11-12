import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalAssetStorage,
  createAssetStorage,
} from "../server/assets/storage";
import { inspectImage } from "../server/assets/images";
import { MAX_IMAGE_ASSET_BYTES } from "@rpa/contracts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("almacenamiento de imágenes", () => {
  it("persiste bytes en una carpeta privada y no permite sobrescribir claves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rpa-assets-"));
    directories.push(directory);
    const storage = new LocalAssetStorage(join(directory, "nested"));
    const id = randomUUID();
    await storage.put(id, Buffer.from("original"), "image/png");
    await expect(
      storage.put(id, Buffer.from("replacement"), "image/png"),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await storage.get(id)).toEqual(Buffer.from("original"));
    expect(await readFile(join(directory, "nested", id), "utf8")).toBe(
      "original",
    );
    await storage.delete(id);
    await storage.delete(id);
    await expect(storage.get(id)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      createAssetStorage({ provider: "local", localDirectory: directory })
        .provider,
    ).toBe("local");
    expect(() =>
      createAssetStorage({ provider: "unknown", localDirectory: directory }),
    ).toThrow(/Proveedor/);
  });
  it("rechaza rutas, nombres originales y claves arbitrarias", async () => {
    const storage = new LocalAssetStorage(tmpdir());
    for (const key of [
      "../secret",
      "/etc/passwd",
      "button.png",
      "",
      `${randomUUID()}/../escape`,
    ]) {
      await expect(
        storage.put(key, Buffer.from("x"), "image/png"),
      ).rejects.toThrow(/Clave/);
      expect(() => storage.get(key)).toThrow(/Clave/);
    }
  });
  it.each(["png", "jpeg", "webp"] as const)(
    "valida y decodifica %s",
    async (format) => {
      const data = await sharp({
        create: { width: 10, height: 20, channels: 3, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      expect(await inspectImage(data, `image/${format}`)).toEqual({
        contentType: `image/${format}`,
        width: 10,
        height: 20,
      });
      await expect(inspectImage(data, "image/gif")).rejects.toMatchObject({
        statusCode: 415,
      });
    },
  );
  it("rechaza archivos falsos, truncados, vacíos y demasiado grandes", async () => {
    await expect(
      inspectImage(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        "image/png",
      ),
    ).rejects.toMatchObject({ statusCode: 415 });
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(
      inspectImage(png.subarray(0, 40), "image/png"),
    ).rejects.toMatchObject({ statusCode: 415 });
    await expect(
      inspectImage(Buffer.alloc(0), "image/png"),
    ).rejects.toMatchObject({ statusCode: 413 });
    await expect(
      inspectImage(Buffer.alloc(MAX_IMAGE_ASSET_BYTES + 1), "image/png"),
    ).rejects.toMatchObject({ statusCode: 413 });
  });
});

describe("proveedor azure", () => {
  it("se selecciona y exige configuración", async () => {
    const { AzureBlobAssetStorage } = await import("../server/assets/storage");
    expect(() =>
      createAssetStorage({ provider: "azure", localDirectory: "x" }),
    ).toThrow(/NUXT_ASSETS_AZURE/);
    const storage = createAssetStorage({
      provider: "azure",
      localDirectory: "x",
      azureConnectionString:
        "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=Zm9v;EndpointSuffix=core.windows.net",
      azureContainer: "c",
    });
    expect(storage).toBeInstanceOf(AzureBlobAssetStorage);
    expect(storage.provider).toBe("azure");
    expect(() => storage.get("../x")).toThrow(/Clave/);
  });
});
