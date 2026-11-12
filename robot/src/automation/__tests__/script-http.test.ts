import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import {
  isPublicAddress,
  scriptAllowedOrigins,
  scriptHttpRequest,
} from "../scripts/http";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const signal = () => new AbortController().signal;
const origins = new Set(["https://api.example.com"]);

describe("script HTTP policy", () => {
  it("accepts exact HTTPS origins only", () => {
    expect([
      ...scriptAllowedOrigins(
        "https://api.example.com, https://other.example.com:8443",
      ),
    ]).toEqual(["https://api.example.com", "https://other.example.com:8443"]);
    for (const origin of [
      "http://example.com",
      "https://u:p@example.com",
      "https://example.com/path",
      "https://example.com?x",
      "*.example.com",
    ])
      expect(() => scriptAllowedOrigins(origin)).toThrow();
  });

  it("blocks local, private, link-local, mapped IPv4 and reserved IPs", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.2",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("93.184.215.14")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("denies unlisted origins, credentials and protocol changes before DNS", async () => {
    for (const url of [
      "https://evil.example.com",
      "http://api.example.com",
      "https://api.example.com.evil.test",
      "https://u:p@api.example.com",
      "https://api.example.com:8443",
    ])
      await expect(
        scriptHttpRequest({ url }, origins, signal()),
      ).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("denies mixed public/private DNS answers", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.215.14", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(
      scriptHttpRequest({ url: "https://api.example.com" }, origins, signal()),
    ).rejects.toThrow("privadas");
    expect(request).not.toHaveBeenCalled();
  });

  function mockResponse(status: number, chunks: string[]) {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.215.14", family: 4 },
    ] as never);
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      destroy: vi.fn((error?: Error) => {
        if (error) response.emit("error", error);
      }),
    });
    const req = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        queueMicrotask(() => {
          const callback = vi.mocked(request).mock.calls[0]![2] as (
            res: unknown,
          ) => void;
          callback(response);
          for (const chunk of chunks) response.emit("data", Buffer.from(chunk));
          response.emit("end");
        });
      }),
    });
    vi.mocked(request).mockReturnValue(req as never);
    return { req, response };
  }

  it("pins the validated DNS answer and returns parsed JSON", async () => {
    const { req } = mockResponse(200, ['{"ok":true}']);
    expect(
      await scriptHttpRequest(
        {
          url: "https://api.example.com/data",
          method: "POST",
          body: { name: "test" },
        },
        origins,
        signal(),
      ),
    ).toEqual({ ok: true });
    const options = vi.mocked(request).mock
      .calls[0]![1] as import("node:https").RequestOptions;
    expect(options.agent).toBe(false);
    expect(options.headers).toMatchObject({
      "content-type": "application/json",
    });
    const done = vi.fn();
    (options.lookup as Function)("api.example.com", {}, done);
    expect(done).toHaveBeenCalledWith(null, "93.184.215.14", 4);
    expect(req.end).toHaveBeenCalledWith('{"name":"test"}');
  });

  it("rejects redirects without sending another request", async () => {
    mockResponse(302, []);
    await expect(
      scriptHttpRequest({ url: "https://api.example.com" }, origins, signal()),
    ).rejects.toThrow("302");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds responses and blocks routing headers and unsupported methods", async () => {
    mockResponse(200, ["x".repeat(1024 * 1024 + 1)]);
    await expect(
      scriptHttpRequest({ url: "https://api.example.com" }, origins, signal()),
    ).rejects.toThrow("grande");
    for (const input of [
      { headers: { Host: "localhost" } },
      { method: "CONNECT" },
      { body: "x".repeat(300000) },
    ])
      await expect(
        scriptHttpRequest(
          { url: "https://api.example.com", ...input },
          origins,
          signal(),
        ),
      ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
