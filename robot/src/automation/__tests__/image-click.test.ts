import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { cuaApp } from "../apps/cua.app";
import { CuaDriver, type CuaTransport } from "../drivers/cua-driver";
import { findImage } from "../vision/match";
import { clickImage, imageClickParameters } from "../vision/click";

const id = "10000000-0000-4000-8000-000000000001";
const input = {
  assetId: id,
  pid: 10,
  windowId: 20,
  scales: "1",
  timeoutMs: 10000,
};
let reference: Buffer;
let screenshot: string;
async function screen(
  positions: Array<{ left: number; top: number }>,
  scale = 1,
) {
  const image =
    scale === 1
      ? reference
      : await sharp(reference)
          .resize(Math.round(32 * scale), Math.round(20 * scale))
          .png()
          .toBuffer();
  return (
    await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#cccccc" },
    })
      .composite(positions.map((position) => ({ input: image, ...position })))
      .png()
      .toBuffer()
  ).toString("base64");
}
beforeAll(async () => {
  const data = Buffer.alloc(32 * 20 * 3);
  for (let i = 0; i < data.length; i++)
    data[i] = (i * 37 + Math.floor(i / 11) * 53) % 256;
  reference = await sharp(data, { raw: { width: 32, height: 20, channels: 3 } })
    .png()
    .toBuffer();
  screenshot = await screen([{ left: 80, top: 45 }]);
});
const setup = (image = () => screenshot) => {
  const transport = vi.fn<CuaTransport>(async (tool) =>
    tool === "click"
      ? { delivered: true }
      : {
          capture_id: "capture-current",
          images: [{ data: image(), mimeType: "image/png" }],
        },
  );
  const load = vi.fn(async () => reference);
  return {
    transport,
    load,
    context: {
      appContexts: {
        cua: new CuaDriver("image-test", transport),
        imageAssets: { load },
      },
    },
  };
};
describe("visual matching", () => {
  it("finds a unique reference with exact capture coordinates", async () => {
    const matches = await findImage(
      screenshot,
      reference,
      { minSimilarity: 0.99, scales: [1] },
      10000,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      x: 80,
      y: 45,
      width: 32,
      height: 20,
      scale: 1,
    });
  });
  it("searches scales and merges peaks for the same target", async () => {
    const image = await screen([{ left: 20, top: 10 }], 1.5);
    const matches = await findImage(
      image,
      reference,
      { minSimilarity: 0.95, scales: [1, 1.5, 2] },
      10000,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      x: 20,
      y: 10,
      width: 48,
      height: 30,
      scale: 1.5,
    });
  });
  it("returns multiple targets and respects region offsets", async () => {
    const image = await screen([
      { left: 10, top: 5 },
      { left: 120, top: 60 },
    ]);
    expect(
      await findImage(
        image,
        reference,
        { minSimilarity: 0.99, scales: [1] },
        10000,
      ),
    ).toHaveLength(2);
    const found = await findImage(
      image,
      reference,
      {
        minSimilarity: 0.99,
        scales: [1],
        region: { x: 100, y: 50, width: 100, height: 50 },
      },
      10000,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ x: 120, y: 60 });
  });
  it("returns no match for an absent reference and rejects uniform references", async () => {
    expect(
      await findImage(
        await screen([]),
        reference,
        { minSimilarity: 0.99, scales: [1] },
        10000,
      ),
    ).toEqual([]);
    const blank = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      findImage(screenshot, blank, { minSimilarity: 0.9, scales: [1] }, 10000),
    ).rejects.toThrow(/uniforme/);
  });
  it("rejects out-of-bounds regions and interrupts the worker", async () => {
    await expect(
      findImage(
        screenshot,
        reference,
        {
          minSimilarity: 0.9,
          scales: [1],
          region: { x: 195, y: 0, width: 20, height: 10 },
        },
        10000,
      ),
    ).rejects.toThrow(/fuera/);
    const controller = new AbortController();
    const pending = findImage(
      screenshot,
      reference,
      { minSimilarity: 0.9, scales: [1] },
      10000,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelada/);
    await expect(
      findImage(screenshot, reference, { minSimilarity: 0.9, scales: [1] }, 1),
    ).rejects.toThrow(/agotado/);
  });
});
describe("click image action", () => {
  it("runs the registered action with the real matcher and clicks once with capture_id", async () => {
    const { context, transport, load } = setup();
    const action = cuaApp.actions.find(
      (action) => action.id === "cua.image.click",
    )!;
    const result = await action.run(input, context);
    expect(result, result.message).toMatchObject({
      ok: true,
      output: { clicked: true, assetId: id, x: 96, y: 55 },
    });
    expect(load).toHaveBeenCalledWith(id, undefined);
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      "get_window_state",
      "click",
    ]);
    expect(transport.mock.calls[1]![1]).toMatchObject({
      scope: "window",
      pid: 10,
      window_id: 20,
      capture_id: "capture-current",
      x: 96,
      y: 55,
      count: 1,
    });
  });
  it("refuses ambiguity without clicking", async () => {
    const duplicate = await screen([
      { left: 10, top: 5 },
      { left: 120, top: 60 },
    ]);
    const { context, transport } = setup(() => duplicate);
    await expect(clickImage(input, context)).rejects.toMatchObject({
      code: "IMAGE_MATCH_AMBIGUOUS",
    });
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      "get_window_state",
    ]);
  });
  it("retries fresh captures and supports explicit desktop targets", async () => {
    const { context, transport } = setup();
    const found = {
      x: 20,
      y: 10,
      width: 32,
      height: 20,
      similarity: 1,
      scale: 1,
    };
    const matcher = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([found]);
    await clickImage(
      { ...input, scope: "desktop", pid: 0, button: "right", count: 2 },
      context,
      matcher,
    );
    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      "get_desktop_state",
      "get_desktop_state",
      "click",
    ]);
    const args = transport.mock.calls[2]![1];
    expect(args).toMatchObject({ scope: "desktop", button: "right", count: 2 });
    expect(args.pid).toBeUndefined();
  });
  it("never clicks after cancellation or retries a click with uncertain delivery", async () => {
    const { context, transport } = setup();
    const controller = new AbortController();
    const found = {
      x: 20,
      y: 10,
      width: 32,
      height: 20,
      similarity: 1,
      scale: 1,
    };
    await expect(
      clickImage(input, { ...context, signal: controller.signal }, async () => {
        controller.abort();
        return [found];
      }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockImplementation(async (tool) => {
      if (tool === "click")
        throw new Error("CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: click");
      return { capture_id: "c", images: [{ data: screenshot }] };
    });
    await expect(
      clickImage(input, context, async () => [found]),
    ).rejects.toThrow(/UNCERTAIN/);
    expect(
      transport.mock.calls.filter((call) => call[0] === "click"),
    ).toHaveLength(1);
  });
  it("times out without clicking and rejects invalid parameters before any download", async () => {
    const { context, transport, load } = setup();
    await expect(
      clickImage({ ...input, timeoutMs: 1000 }, context, async () => []),
    ).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
    expect(transport.mock.calls.every((call) => call[0] !== "click")).toBe(
      true,
    );
    load.mockClear();
    transport.mockClear();
    for (const overrides of [
      { assetId: "../path" },
      { minSimilarity: NaN },
      { scales: "0,1" },
      { scales: "1," },
      { timeoutMs: 0 },
      { region: { x: -1, y: 0, width: 3, height: 4 } },
    ]) {
      expect(() => imageClickParameters({ ...input, ...overrides })).toThrow();
    }
    await expect(clickImage({ ...input, pid: 0 }, context)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
