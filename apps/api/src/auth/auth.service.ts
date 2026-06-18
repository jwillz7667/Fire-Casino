import { Inject, Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import { type PrismaClient } from "@aureus/db";
import {
  effectivePermissions,
  type OperatorLoginInput,
  type OperatorSummary,
  type PasswordChangeInput,
  type PlayerLoginInput,
  type PlayerSummary,
  tierRequiresMfa,
} from "@aureus/shared";
import {
  ConflictError,
  InvalidCredentialsError,
  MfaRequiredError,
  NotFoundError,
  UnauthorizedError,
} from "../common/errors/domain-error";
import {
  type OperatorPrincipal,
  type Principal,
  type PlayerPrincipal,
} from "../common/auth/principal";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { LoginThrottleService } from "./login-throttle.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

export interface AuthContext {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const MFA_ISSUER = "Fire Casino";

function operatorSettings(value: unknown): { permissions?: string[] } & Record<string, unknown> {
  return (value as { permissions?: string[] } & Record<string, unknown>) ?? {};
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  /** Record a failed login for security monitoring (docs/01 §8). Never logs the password. */
  private async auditLoginFailure(
    identifier: string,
    surface: "operator" | "player",
    reason: string,
    ctx: AuthContext,
  ): Promise<void> {
    await this.audit.record({
      actorType: "SYSTEM",
      action: "auth.login_failed",
      targetType: "User",
      after: { identifier, surface, reason },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  // ---- login -----------------------------------------------------------------

  async operatorLogin(
    input: OperatorLoginInput,
    ctx: AuthContext,
  ): Promise<IssuedSession & { operator: OperatorSummary }> {
    // Per-account lockout (S3): reject early if the identifier is locked, and
    // count password/MFA failures toward a cooldown that survives IP rotation.
    if (await this.loginThrottle.isLocked("operator", input.identifier)) {
      await this.auditLoginFailure(input.identifier, "operator", "locked_out", ctx);
      throw new InvalidCredentialsError();
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: input.identifier }, { email: input.identifier }] },
      include: { operator: true },
    });
    if (!user || user.status !== "ACTIVE" || !user.operator) {
      await this.loginThrottle.recordFailure("operator", input.identifier);
      await this.auditLoginFailure(input.identifier, "operator", "unknown_or_inactive", ctx);
      throw new InvalidCredentialsError();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.loginThrottle.recordFailure("operator", input.identifier);
      await this.auditLoginFailure(input.identifier, "operator", "bad_password", ctx);
      throw new InvalidCredentialsError();
    }
    if (user.mfaEnabled) {
      // A missing code is a prompt for the second factor, not a failed attempt.
      if (!input.totp) throw new MfaRequiredError();
      if (!user.mfaSecret || !authenticator.check(input.totp, user.mfaSecret)) {
        await this.loginThrottle.recordFailure("operator", input.identifier);
        await this.auditLoginFailure(input.identifier, "operator", "bad_mfa", ctx);
        throw new InvalidCredentialsError("Invalid MFA code");
      }
    }
    await this.loginThrottle.clear("operator", input.identifier);

    const operator = user.operator;
    const session = await this.issueOperatorSession(user.id, operator.id, operator.tier, ctx);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      actorType: "USER",
      actorId: user.id,
      action: "auth.login",
      targetType: "User",
      targetId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      ...session,
      operator: this.buildOperatorSummary({
        userId: user.id,
        username: user.username,
        mfaEnabled: user.mfaEnabled,
        operator,
      }),
    };
  }

  async playerLogin(
    input: PlayerLoginInput,
    ctx: AuthContext,
  ): Promise<IssuedSession & { player: PlayerSummary }> {
    if (await this.loginThrottle.isLocked("player", input.username)) {
      await this.auditLoginFailure(input.username, "player", "locked_out", ctx);
      throw new InvalidCredentialsError();
    }

    const player = await this.prisma.player.findUnique({
      where: { username: input.username },
      include: { operator: true, wallets: true },
    });
    if (!player || player.status !== "ACTIVE") {
      await this.loginThrottle.recordFailure("player", input.username);
      await this.auditLoginFailure(input.username, "player", "unknown_or_inactive", ctx);
      throw new InvalidCredentialsError();
    }
    if (!(await this.passwords.verify(player.passwordHash, input.password))) {
      await this.loginThrottle.recordFailure("player", input.username);
      await this.auditLoginFailure(input.username, "player", "bad_password", ctx);
      throw new InvalidCredentialsError();
    }
    await this.loginThrottle.clear("player", input.username);

    const session = await this.issuePlayerSession(player.id, player.operatorId, ctx);
    await this.prisma.player.update({ where: { id: player.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      actorType: "PLAYER",
      actorId: player.id,
      action: "auth.login",
      targetType: "Player",
      targetId: player.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      ...session,
      player: {
        playerId: player.id,
        operatorId: player.operatorId,
        username: player.username,
        displayName: player.displayName,
        status: player.status,
        wallets: player.wallets.map((w) => ({
          currency: w.currency,
          balanceMinor: w.balanceMinor.toString(),
        })),
      },
    };
  }

  // ---- refresh / logout ------------------------------------------------------

  async refresh(refreshToken: string, ctx: AuthContext): Promise<IssuedSession> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) throw new UnauthorizedError("Invalid session");

    // Reuse detection: a presented-but-revoked token means the family is
    // compromised — revoke the whole family (docs/01 §4).
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedError("Session reuse detected");
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Session expired");
    }

    const rotated = this.tokens.newRefreshToken();
    const next = await this.prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        playerId: existing.playerId,
        tokenHash: rotated.tokenHash,
        familyId: existing.familyId,
        audience: existing.audience,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: next.id },
    });

    const access = await this.signForFamily(existing, existing.familyId);
    return { ...access, refreshToken: rotated.token };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorType: existing.userId ? "USER" : "PLAYER",
      actorId: existing.userId ?? existing.playerId ?? undefined,
      action: "auth.logout",
      targetType: existing.userId ? "User" : "Player",
      targetId: existing.userId ?? existing.playerId ?? undefined,
    });
  }

  // ---- me --------------------------------------------------------------------

  async operatorMe(principal: OperatorPrincipal): Promise<OperatorSummary> {
    const operator = await this.prisma.operator.findUnique({
      where: { id: principal.operatorId },
      include: { user: true },
    });
    if (!operator) throw new NotFoundError("Operator not found");
    return this.buildOperatorSummary({
      userId: operator.userId,
      username: operator.user.username,
      mfaEnabled: operator.user.mfaEnabled,
      operator,
    });
  }

  async playerMe(principal: PlayerPrincipal): Promise<PlayerSummary> {
    const player = await this.prisma.player.findUnique({
      where: { id: principal.playerId },
      include: { wallets: true },
    });
    if (!player) throw new NotFoundError("Player not found");
    return {
      playerId: player.id,
      operatorId: player.operatorId,
      username: player.username,
      displayName: player.displayName,
      status: player.status,
      wallets: player.wallets.map((w) => ({
        currency: w.currency,
        balanceMinor: w.balanceMinor.toString(),
      })),
    };
  }

  // ---- password / mfa --------------------------------------------------------

  async changePassword(principal: Principal, input: PasswordChangeInput): Promise<void> {
    if (principal.kind === "operator") {
      const user = await this.prisma.user.findUnique({ where: { id: principal.userId } });
      if (!user) throw new NotFoundError();
      if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
        throw new InvalidCredentialsError("Current password is incorrect");
      }
      const passwordHash = await this.passwords.hash(input.newPassword);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.revokeOtherSessions({ userId: user.id }, principal.sessionId);
    } else {
      const player = await this.prisma.player.findUnique({ where: { id: principal.playerId } });
      if (!player) throw new NotFoundError();
      if (!(await this.passwords.verify(player.passwordHash, input.currentPassword))) {
        throw new InvalidCredentialsError("Current password is incorrect");
      }
      const passwordHash = await this.passwords.hash(input.newPassword);
      await this.prisma.player.update({ where: { id: player.id }, data: { passwordHash } });
      await this.revokeOtherSessions({ playerId: player.id }, principal.sessionId);
    }
    await this.audit.record({
      ...auditActor(principal),
      action: "auth.password_change",
    });
  }

  async mfaEnable(principal: OperatorPrincipal): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(principal.username, MFA_ISSUER, secret);
    // Store the (unconfirmed) secret; mfaEnabled flips on confirm.
    await this.prisma.user.update({ where: { id: principal.userId }, data: { mfaSecret: secret } });
    await this.audit.record({
      ...auditActor(principal),
      action: "auth.mfa_enable",
      targetType: "User",
      targetId: principal.userId,
    });
    return { secret, otpauthUrl };
  }

  async mfaConfirm(principal: OperatorPrincipal, totp: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId } });
    if (!user?.mfaSecret) throw new ConflictError("MFA not initialized");
    if (!authenticator.check(totp, user.mfaSecret)) {
      throw new InvalidCredentialsError("Invalid MFA code");
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.audit.record({
      ...auditActor(principal),
      action: "auth.mfa_confirm",
      targetType: "User",
      targetId: principal.userId,
    });
  }

  // ---- internals -------------------------------------------------------------

  private async issueOperatorSession(
    userId: string,
    operatorId: string,
    tier: string,
    ctx: AuthContext,
  ): Promise<IssuedSession> {
    const familyId = this.tokens.newFamilyId();
    const refreshToken = await this.persistRefresh({ userId, audience: "OPERATOR", familyId, ctx });
    const access = await this.tokens.signAccess({
      sub: userId,
      aud: "operator",
      operatorId,
      tier,
      sessionId: familyId,
    });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken };
  }

  private async issuePlayerSession(
    playerId: string,
    operatorId: string,
    ctx: AuthContext,
  ): Promise<IssuedSession> {
    const familyId = this.tokens.newFamilyId();
    const refreshToken = await this.persistRefresh({ playerId, audience: "PLAYER", familyId, ctx });
    const access = await this.tokens.signAccess({
      sub: playerId,
      aud: "player",
      operatorId,
      sessionId: familyId,
    });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken };
  }

  /** Persist a fresh refresh-token row; returns the plaintext token for the cookie. */
  private async persistRefresh(args: {
    userId?: string;
    playerId?: string;
    audience: "OPERATOR" | "PLAYER";
    familyId: string;
    ctx: AuthContext;
  }): Promise<string> {
    const { token, tokenHash } = this.tokens.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: args.userId,
        playerId: args.playerId,
        tokenHash,
        familyId: args.familyId,
        audience: args.audience,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        ip: args.ctx.ip,
        userAgent: args.ctx.userAgent,
      },
    });
    return token;
  }

  private async signForFamily(
    existing: { userId: string | null; playerId: string | null },
    familyId: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (existing.userId) {
      const operator = await this.prisma.operator.findUnique({
        where: { userId: existing.userId },
      });
      if (!operator) throw new UnauthorizedError("Invalid session");
      const access = await this.tokens.signAccess({
        sub: existing.userId,
        aud: "operator",
        operatorId: operator.id,
        tier: operator.tier,
        sessionId: familyId,
      });
      return { accessToken: access.token, expiresIn: access.expiresIn };
    }
    if (existing.playerId) {
      const player = await this.prisma.player.findUnique({ where: { id: existing.playerId } });
      if (!player) throw new UnauthorizedError("Invalid session");
      const access = await this.tokens.signAccess({
        sub: player.id,
        aud: "player",
        operatorId: player.operatorId,
        sessionId: familyId,
      });
      return { accessToken: access.token, expiresIn: access.expiresIn };
    }
    throw new UnauthorizedError("Invalid session");
  }

  private async revokeOtherSessions(
    owner: { userId?: string; playerId?: string },
    keepFamilyId: string,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { ...owner, familyId: { not: keepFamilyId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private buildOperatorSummary(args: {
    userId: string;
    username: string;
    mfaEnabled: boolean;
    operator: {
      id: string;
      displayName: string;
      tier: OperatorSummary["tier"];
      path: string;
      depth: number;
      settings: unknown;
    };
  }): OperatorSummary {
    const settings = operatorSettings(args.operator.settings);
    return {
      userId: args.userId,
      operatorId: args.operator.id,
      username: args.username,
      displayName: args.operator.displayName,
      tier: args.operator.tier,
      path: args.operator.path,
      depth: args.operator.depth,
      mfaEnabled: args.mfaEnabled,
      requiresMfaEnrollment: tierRequiresMfa(args.operator.tier) && !args.mfaEnabled,
      permissions: effectivePermissions(args.operator.tier, settings),
    };
  }
}
