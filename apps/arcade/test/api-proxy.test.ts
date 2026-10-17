import { afterEach, describe, expect, it, vi } from "vitest";
import { apiProxyRewrites } from "../api-proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("fixed API proxy upstream", () => {
  it("leaves direct mode unchanged unless explicitly enabled", () => {
    expect(apiProxyRewrites({ NODE_ENV: "test" })).toEqual([]);
    expect(apiProxyRewrites({ NODE_ENV: "test", NEXT_PUBLIC_API_PROXY: "false" })).toEqual([]);
  });

  it("rewrites only the API prefix to the configured HTTPS origin", () => {
    expect(
      apiProxyRewrites({
        NODE_ENV: "test",
        NEXT_PUBLIC_API_PROXY: "true",
        NEXT_PUBLIC_API_URL: "https://api.example.com/",
      }),
    ).toEqual([{ source: "/api/v1/:path*", destination: "https://api.example.com/api/v1/:path*" }]);
  });

  it("allows localhost HTTP for local end-to-end checks", () => {
    expect(
      apiProxyRewrites({
        NODE_ENV: "test",
        NEXT_PUBLIC_API_PROXY: "true",
        NEXT_PUBLIC_API_URL: "http://localhost:4000",
      })[0]?.destination,
    ).toBe("http://localhost:4000/api/v1/:path*");
  });

  it.each([
    "http://remote.example.com",
    "https://user:password@api.example.com",
    "https://api.example.com/path",
    "https://api.example.com?target=elsewhere",
    "https://api.example.com#fragment",
    "javascript:alert(1)",
  ])("rejects unsafe or ambiguous upstream %s", (upstream) => {
    expect(() =>
      apiProxyRewrites({
        NODE_ENV: "test",
        NEXT_PUBLIC_API_PROXY: "true",
        NEXT_PUBLIC_API_URL: upstream,
      }),
    ).toThrow();
  });

  it("requires an explicit upstream when proxying", () => {
    expect(() => apiProxyRewrites({ NODE_ENV: "test", NEXT_PUBLIC_API_PROXY: "true" })).toThrow(
      "NEXT_PUBLIC_API_URL is required",
    );
  });
});

describe.each(["false", "true"])("HTTP client with NEXT_PUBLIC_API_PROXY=%s", (proxy) => {
  it("uses the selected HTTP origin and keeps the direct realtime origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_PROXY", proxy);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/");
    vi.resetModules();
    const env = await import("../src/lib/env");
    const client = await import("../src/lib/api");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await client.api.get("/wallet/history?limit=1", { query: { limit: 25 } });

    const base = proxy === "true" ? "/api/v1" : "https://api.example.com/api/v1";
    expect(env.API_ORIGIN).toBe("https://api.example.com");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${base}/wallet/history?limit=25`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      headers: { "X-Auth-Audience": "player" },
    });
  });

  it("refreshes through the selected origin with the correct cookie audience", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_PROXY", proxy);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    vi.resetModules();
    const client = await import("../src/lib/api");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ accessToken: "refreshed" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.tryRefresh()).resolves.toBe(true);

    const base = proxy === "true" ? "/api/v1" : "https://api.example.com/api/v1";
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${base}/auth/refresh`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-Auth-Audience": "player" },
    });
  });
});
