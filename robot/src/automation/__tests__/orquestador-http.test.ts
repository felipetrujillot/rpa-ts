import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTrpcJson } from "../../main/orquestador-http";

afterEach(() => vi.unstubAllGlobals());

describe("orquestador HTTP responses", () => {
  it("identifies HTML responses without exposing credentials or response content", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<!DOCTYPE html>private page", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    const result = fetchTrpcJson("http://localhost:6543/api/trpc/agentes.refreshAgente?secret=hidden");
    await expect(result).rejects.toThrow("HTML (HTTP 200) en http://localhost:6543/api/trpc/agentes.refreshAgente.");
    await expect(result).rejects.not.toThrow(/hidden|private page/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries unavailable session refreshes and recovers after a server restart", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("<!DOCTYPE html>", { status: 503, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(Response.json({ result: { data: { token: "test" } } }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchTrpcJson("http://localhost:6543/api/trpc/agentes.refreshAgente", { method: "POST" }, true)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST", redirect: "error" });
  });
  it("does not replay ordinary mutations after an unavailable response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchTrpcJson("http://localhost:6543/api/trpc/agentes.executeAgenteFlowAssignment", { method: "POST" })).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("passes JSON authorization errors through to tRPC without retrying", async () => {
    const response = Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);
    expect(await fetchTrpcJson("http://localhost:6543/api/trpc/agentes.refreshAgente", {}, true)).toBe(response);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
