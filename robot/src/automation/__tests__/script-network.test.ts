import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptHttpRequest } from "../scripts/http";
import { runTypeScript } from "../scripts/run";

vi.mock("../scripts/http", async (original) => ({
  ...(await original<typeof import("../scripts/http")>()),
  scriptHttpRequest: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("script HTTP bridge", () => {
  it("resolves typed GET and POST calls through the trusted broker", async () => {
    vi.stubEnv("RPA_SCRIPT_ALLOWED_ORIGINS", "https://api.example.com");
    vi.mocked(scriptHttpRequest)
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce({ saved: true });
    const result = await runTypeScript(
      `
      const item = await http.get<{ id: number }>("https://api.example.com/items/42");
      return await http.post("https://api.example.com/items", item, { headers: { Authorization: "Bearer test" } });
    `,
      {},
      5000,
    );
    expect(result).toMatchObject({ ok: true, result: { saved: true } });
    expect(scriptHttpRequest).toHaveBeenNthCalledWith(
      2,
      {
        url: "https://api.example.com/items",
        method: "POST",
        body: { id: 42 },
        headers: { Authorization: "Bearer test" },
      },
      new Set(["https://api.example.com"]),
      expect.any(AbortSignal),
    );
  });

  it("caps requests and propagates cancellation to outstanding HTTP", async () => {
    vi.mocked(scriptHttpRequest).mockResolvedValue({});
    const limited = await runTypeScript(
      'for (let i = 0; i < 21; i++) await http.get("https://api.example.com");',
      {},
      5000,
    );
    expect(limited.ok).toBe(false);
    expect(scriptHttpRequest).toHaveBeenCalledTimes(20);
    vi.mocked(scriptHttpRequest).mockImplementation(
      () => new Promise(() => {}),
    );
    const controller = new AbortController();
    const pending = runTypeScript(
      'await http.get("https://api.example.com");',
      {},
      5000,
      controller.signal,
    );
    await vi.waitFor(() => expect(scriptHttpRequest).toHaveBeenCalledTimes(21));
    const signal = vi.mocked(scriptHttpRequest).mock.calls[20]![2];
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      errorCode: "FLOW_CANCELLED",
    });
    expect(signal.aborted).toBe(true);
  });
});
