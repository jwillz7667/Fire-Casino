import { JwtService } from "@nestjs/jwt";
import { loadEnv } from "@aureus/shared";
import { describe, expect, it } from "vitest";
import { TokenService } from "./token.service";

const env = loadEnv();
const jwt = new JwtService({});
const tokens = new TokenService(jwt, env);
const claims = {
  sub: "user-1",
  aud: "operator" as const,
  operatorId: "op-1",
  sessionId: "family-1",
};

describe("access token verification", () => {
  it("accepts the service's signed token", async () => {
    const { token } = await tokens.signAccess(claims);
    await expect(tokens.verifyAccess(token)).resolves.toMatchObject(claims);
  });
  it("rejects a correctly signed token with an unknown audience", async () => {
    const token = await jwt.signAsync(
      { ...claims, aud: "admin" },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: 900 },
    );
    await expect(tokens.verifyAccess(token)).rejects.toThrow();
  });
  it("rejects a correctly signed token with missing session or expiry", async () => {
    const { sessionId: _sessionId, ...incomplete } = claims;
    const token = await jwt.signAsync(incomplete, { secret: env.JWT_ACCESS_SECRET });
    await expect(tokens.verifyAccess(token)).rejects.toThrow();
  });
  it("rejects an alternate HMAC algorithm", async () => {
    const token = await jwt.signAsync(claims, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: 900,
      algorithm: "HS384",
    });
    await expect(tokens.verifyAccess(token)).rejects.toThrow();
  });
});
