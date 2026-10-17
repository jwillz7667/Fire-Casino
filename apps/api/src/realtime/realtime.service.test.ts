import { type PrismaClient } from "@aureus/db";
import { describe, expect, it, vi } from "vitest";
import { type TokenService } from "../auth/token.service";
import { RealtimeService } from "./realtime.service";

function service(mfaEnabled: boolean, tier = "SUPER_ADMIN") {
  const prisma = {
    operator: {
      findFirst: vi.fn().mockResolvedValue({
        id: "op-1",
        userId: "u1",
        status: "ACTIVE",
        tier,
        path: "0",
        depth: 0,
        displayName: "Admin",
        settings: {},
        user: { status: "ACTIVE", username: "admin", mfaEnabled },
      }),
    },
  } as unknown as PrismaClient;
  const tokens = {
    verifyAccess: vi.fn().mockResolvedValue({
      sub: "u1",
      aud: "operator",
      operatorId: "op-1",
      sessionId: "s1",
      exp: 9_999_999_999,
    }),
  } as unknown as TokenService;
  return new RealtimeService(prisma, tokens);
}

describe("realtime MFA gate", () => {
  it("rejects direct admin socket handshakes until MFA enrollment is complete", async () => {
    await expect(service(false).loadConnection("valid-login-token")).rejects.toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
    });
  });
  it("allows enrolled admins and tiers that do not require MFA", async () => {
    await expect(service(true).loadConnection("token")).resolves.toMatchObject({
      principal: { kind: "operator", mfaEnabled: true },
    });
    await expect(service(false, "STORE").loadConnection("token")).resolves.toMatchObject({
      principal: { tier: "STORE" },
    });
  });
});
