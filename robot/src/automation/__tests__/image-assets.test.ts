import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrquestadorImageAssets } from "../vision/asset-client";
const id = "10000000-0000-4000-8000-000000000001";
const data = Buffer.from("original-bytes");
const metadata = {
  id,
  originalName: "button.png",
  contentType: "image/png",
  byteLength: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
  width: 32,
  height: 20,
  createdAt: new Date().toISOString(),
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "rpa-image-cache-"));
  dirs.push(directory);
  const authenticate = vi.fn(async () => "test-token");
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    new URL(String(url)).pathname.endsWith("/content")
      ? new Response(data, { headers: { "content-type": "image/png" } })
      : Response.json(metadata),
  );
  return {
    directory,
    authenticate,
    fetcher,
    client: new OrquestadorImageAssets({
      trpcUrl: "http://localhost:6543/api/trpc",
      cacheDirectory: directory,
      authenticate,
      fetch: fetcher,
    }),
  };
}
describe("image asset download and cache", () => {
  it("downloads authenticated bytes, verifies hashes and authorizes before reusing a cache", async () => {
    const { client, fetcher, authenticate } = await setup();
    expect(await client.load(id)).toEqual(data);
    expect(await client.load(id)).toEqual(data);
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      `http://localhost:6543/api/assets/${id}`,
      `http://localhost:6543/api/assets/${id}/content`,
      `http://localhost:6543/api/assets/${id}`,
    ]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer test-token" },
    });
    fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(client.load(id)).rejects.toThrow(/401/);
  });
  it("replaces corrupted cache entries and refuses corrupt downloads", async () => {
    const { client, fetcher, directory } = await setup();
    await client.load(id);
    const scope = (await readdir(directory))[0]!;
    await writeFile(
      join(directory, scope, `${id}-${metadata.sha256}`),
      "damaged",
    );
    expect(await client.load(id)).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await rm(join(directory, scope), { recursive: true });
    fetcher
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(
        new Response("wrong", { headers: { "content-type": "image/png" } }),
      );
    await expect(client.load(id)).rejects.toThrow(/metadatos/);
  });
  it("rejects arbitrary IDs, insecure servers, oversized bodies and cancellation", async () => {
    const { client, fetcher, authenticate, directory } = await setup();
    await expect(client.load("../secret")).rejects.toThrow(/válida/);
    expect(authenticate).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(client.load(id, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      () =>
        new OrquestadorImageAssets({
          trpcUrl: "http://example.com/api/trpc",
          cacheDirectory: directory,
          authenticate,
        }),
    ).toThrow(/HTTPS/);
    fetcher.mockResolvedValueOnce(new Response("x".repeat(4097)));
    await expect(client.load(id)).rejects.toThrow(/tamaño/);
  });
});
