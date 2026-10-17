import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { z } from "zod";
import { type Env } from "@aureus/shared";
import { type Audience } from "../common/auth/principal";
import { ENV } from "../config/config.module";

export interface AccessClaims {
  sub: string; // userId (operator) | playerId (player)
  aud: Audience;
  sessionId: string; // refresh-token family id
  operatorId?: string;
  tier?: string;
  exp?: number; // standard JWT expiry (seconds since epoch), set by signing
  iat?: number;
}

const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.enum(["operator", "player"]),
  sessionId: z.string().min(1),
  operatorId: z.string().min(1),
  tier: z.string().optional(),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Stateless JWT access tokens + opaque rotating refresh tokens (docs/01 §4).
 * Refresh tokens are random, returned to the client as an httpOnly cookie, and
 * stored only as a SHA-256 hash. Rotation + reuse detection live in AuthService.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await this.jwt.signAsync(claims, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
      keyid: this.env.JWT_KID,
      algorithm: "HS256",
    });
    return { token, expiresIn: this.env.JWT_ACCESS_TTL };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const claims: unknown = await this.jwt.verifyAsync(token, {
      secret: this.env.JWT_ACCESS_SECRET,
      algorithms: ["HS256"],
    });
    return accessClaimsSchema.parse(claims);
  }

  /** A fresh opaque refresh token and its storage hash. */
  newRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(48).toString("base64url");
    return { token, tokenHash: sha256(token) };
  }

  hashRefreshToken(token: string): string {
    return sha256(token);
  }

  newFamilyId(): string {
    return randomUUID();
  }

  get refreshTtlSeconds(): number {
    return this.env.JWT_REFRESH_TTL;
  }
}
