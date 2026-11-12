import { afterEach, describe, expect, it, vi } from "vitest";
import { OrquestadorScriptAuthorization } from "../scripts/authorization";
const id = "playwright.browser.openTab";
afterEach(() => vi.restoreAllMocks());
const make = (allowed: unknown = true) => {
  const authenticate = vi.fn(async () => "device-credential");
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ result: { data: { allowed } } }), {
        headers: { "content-type": "application/json" },
      }),
  );
  const client = new OrquestadorScriptAuthorization({
    trpcUrl: "https://orquestador.example/api/trpc",
    authenticate,
    fetch,
  });
  return { client, authenticate, fetch };
};
describe("SDK server authorization client", () => {
  it("uses the configured server and device token, checks every call without a cached grant", async () => {
    const { client, authenticate, fetch } = make();
    const signal = new AbortController().signal;
    expect(await client.authorize(id, signal)).toBe(true);
    fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ result: { data: { allowed: false } } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await client.authorize(id, signal)).toBe(false);
    expect(authenticate).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain(
      "https://orquestador.example/api/trpc/agentes.authorizeScriptAction",
    );
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer device-credential",
    );
    const input = new URL(String(url)).searchParams.get("input");
    expect(JSON.parse(input!)).toEqual({ actionId: id });
    expect(init.redirect).toBe("error");
  });
  it("rejects invalid grants, failed authentication and disconnected servers", async () => {
    await expect(
      make("true").client.authorize(id, new AbortController().signal),
    ).rejects.toThrow();
    const { client, authenticate, fetch } = make();
    authenticate.mockRejectedValueOnce(new Error("unlinked"));
    await expect(
      client.authorize(id, new AbortController().signal),
    ).rejects.toThrow("unlinked");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(
      client.authorize(id, new AbortController().signal),
    ).rejects.toThrow();
  });
  it("propagates cancellation and never contacts the server after cancellation", async () => {
    const { client, authenticate, fetch } = make();
    const controller = new AbortController();
    authenticate.mockImplementationOnce(async () => {
      controller.abort();
      return "device-credential";
    });
    await expect(client.authorize(id, controller.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.authorize(id, controller.signal)).rejects.toThrow();
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
