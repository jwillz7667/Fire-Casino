import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { trustedFrontendIp } from "./trusted-frontend-ip";

const secret = "p".repeat(64);
const peer = "198.51.100.10";

function apply(
  headers: Record<string, string | string[]> = {},
  configuredSecret: string | undefined = secret,
) {
  const req = {
    headers: { ...headers },
    get ip() {
      return peer;
    },
  } as unknown as Request;
  const next = vi.fn();
  trustedFrontendIp(configuredSecret)(req, {} as Response, next as NextFunction);
  expect(next).toHaveBeenCalledOnce();
  expect(req.headers["x-firecasino-proxy-proof"]).toBeUndefined();
  expect(req.headers["x-firecasino-client-ip"]).toBeUndefined();
  return req;
}

describe("authenticated frontend client IP", () => {
  it.each(["203.0.113.8", "2001:db8::8"])("uses a single verified client IP %s", (clientIp) => {
    expect(
      apply({ "x-firecasino-client-ip": clientIp, "x-firecasino-proxy-proof": secret }).ip,
    ).toBe(clientIp);
  });

  it.each([undefined, "wrong", "q".repeat(64)])(
    "ignores a forged assertion with proof %s",
    (proof) => {
      expect(
        apply({
          "x-firecasino-client-ip": "203.0.113.8",
          ...(proof ? { "x-firecasino-proxy-proof": proof } : {}),
        }).ip,
      ).toBe(peer);
    },
  );

  it.each([
    "203.0.113.8, 198.51.100.9",
    " 203.0.113.8",
    "203.0.113.8:4000",
    "not-an-ip",
    ["203.0.113.8", "198.51.100.9"],
  ])("ignores an invalid or duplicate asserted IP %s", (clientIp) => {
    expect(
      apply({ "x-firecasino-client-ip": clientIp, "x-firecasino-proxy-proof": secret }).ip,
    ).toBe(peer);
  });

  it("keeps direct request identity when forwarding is disabled or only XFF/CF headers are forged", () => {
    expect(
      apply({ "x-firecasino-client-ip": "203.0.113.8", "x-firecasino-proxy-proof": secret }, "").ip,
    ).toBe(peer);
    expect(apply({ "x-forwarded-for": "203.0.113.8", "cf-connecting-ip": "203.0.113.8" }).ip).toBe(
      peer,
    );
  });
});
