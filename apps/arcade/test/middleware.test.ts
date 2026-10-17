import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "../src/middleware";

const secret = "test-only-proxy-proof-0123456789abcdef";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_PROXY", "true");
  vi.stubEnv("RENDER", "true");
  vi.stubEnv("FRONTEND_PROXY_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());

function forward(headers: HeadersInit) {
  const result = middleware(
    new NextRequest("https://frontend.example/api/v1/auth/refresh", { headers }),
  );
  return {
    ip: result.headers.get("x-middleware-request-x-firecasino-client-ip"),
    proof: result.headers.get("x-middleware-request-x-firecasino-proxy-proof"),
    response: result,
  };
}

const forged = {
  "x-firecasino-client-ip": "198.51.100.99",
  "x-firecasino-proxy-proof": "attacker-proof",
};

describe("authenticated Render client IP forwarding", () => {
  it("runs only on the API prefix with the Node runtime", () => {
    expect(config).toEqual({ matcher: "/api/v1/:path*", runtime: "nodejs" });
  });

  it.each(["203.0.113.42", "2001:db8::42"])(
    "forwards one edge-verified IP %s and replaces spoofed assertions",
    (ip) => {
      const result = forward({
        ...forged,
        "cf-connecting-ip": ip,
        "x-forwarded-for": "192.0.2.99",
      });
      expect(result.ip).toBe(ip);
      expect(result.proof).toBe(secret);
      expect(result.response.headers.get("x-firecasino-client-ip")).toBeNull();
      expect(result.response.headers.get("x-firecasino-proxy-proof")).toBeNull();
    },
  );

  it("strips spoofed assertion headers even when the proxy is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_API_PROXY", "false");
    const result = forward({ ...forged, "cf-connecting-ip": "203.0.113.42" });
    expect(result.ip).toBeNull();
    expect(result.proof).toBeNull();
  });

  it("does not trust CF headers outside Render", () => {
    vi.stubEnv("RENDER", "false");
    const result = forward({ ...forged, "cf-connecting-ip": "203.0.113.42" });
    expect(result.ip).toBeNull();
    expect(result.proof).toBeNull();
  });

  it.each([undefined, "", "too-short"])(
    "does not forward without a strong server-only secret (%s)",
    (value) => {
      vi.stubEnv("FRONTEND_PROXY_SECRET", value);
      const result = forward({ ...forged, "cf-connecting-ip": "203.0.113.42" });
      expect(result.ip).toBeNull();
      expect(result.proof).toBeNull();
    },
  );

  it.each([
    "not-an-ip",
    "203.0.113.42,198.51.100.99",
    "203.0.113.42:443",
    "[2001:db8::42]",
    "999.0.0.1",
  ])("rejects invalid or multiple CF addresses (%s)", (ip) => {
    const result = forward({ ...forged, "cf-connecting-ip": ip });
    expect(result.ip).toBeNull();
    expect(result.proof).toBeNull();
  });

  it("never falls back to caller-controlled forwarded-for headers", () => {
    const result = forward({
      ...forged,
      "x-forwarded-for": "203.0.113.42",
      "x-real-ip": "203.0.113.42",
    });
    expect(result.ip).toBeNull();
    expect(result.proof).toBeNull();
  });

  it("preserves the auth audience and credentials needed by the API", () => {
    const result = forward({
      ...forged,
      "cf-connecting-ip": "203.0.113.42",
      "x-auth-audience": "player",
      Authorization: "Bearer local-test-token",
      Cookie: "fc_player_refresh=local-test-cookie",
    });
    expect(result.response.headers.get("x-middleware-request-x-auth-audience")).toBe("player");
    expect(result.response.headers.get("x-middleware-request-authorization")).toBe(
      "Bearer local-test-token",
    );
    expect(result.response.headers.get("x-middleware-request-cookie")).toBe(
      "fc_player_refresh=local-test-cookie",
    );
  });
});
