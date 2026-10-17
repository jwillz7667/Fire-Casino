import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { authOriginProtection } from "./auth-origin";

function request(method: string, headers: Record<string, string> = {}) {
  const next = vi.fn();
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  authOriginProtection(["https://console.example.com", "https://arcade.example.com"])(
    { method, headers } as Request,
    res as unknown as Response,
    next as NextFunction,
  );
  return { next, res };
}

describe("cookie auth origin protection", () => {
  it.each(["https://evil.example", "https://console.example.com.evil.example", "null"])(
    "rejects an untrusted browser origin %s",
    (origin) => {
      const { next, res } = request("POST", { origin });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    },
  );
  it("allows an exact configured frontend origin even for a cross-site API", () => {
    const { next, res } = request("POST", {
      origin: "https://arcade.example.com",
      "sec-fetch-site": "cross-site",
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
  it("rejects cross-site requests with a suppressed Origin", () => {
    expect(request("POST", { "sec-fetch-site": "cross-site" }).res.status).toHaveBeenCalledWith(
      403,
    );
  });
  it("allows CLI clients without browser headers and preflight requests", () => {
    expect(request("POST").next).toHaveBeenCalledOnce();
    expect(request("OPTIONS", { origin: "https://evil.example" }).next).toHaveBeenCalledOnce();
  });
});
