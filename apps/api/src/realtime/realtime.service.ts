import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { type RealtimeTokenResponse } from "@aureus/shared";
import { type AccessClaims, TokenService } from "../auth/token.service";
import { UnauthorizedError } from "../common/errors/domain-error";
import { type Principal } from "../common/auth/principal";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { allowedRoomsFor } from "./room-access";

/**
 * Realtime auth surface (docs/05 §11). Mints the short-lived token a client
 * presents on the Socket.io handshake and re-loads the principal from a
 * handshake token (mirrors AccessTokenGuard.loadPrincipal so socket auth and
 * REST auth resolve identically — never trust path/tier from the token).
 */
@Injectable()
export class RealtimeService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Issue a fresh access token bound to the same session, plus the rooms the
   * principal is entitled to auto-join. The token reuses the standard access
   * claims so the handshake verifies through the same TokenService path.
   */
  async issueToken(principal: Principal): Promise<RealtimeTokenResponse> {
    const claims: AccessClaims =
      principal.kind === "operator"
        ? {
            sub: principal.userId,
            aud: "operator",
            sessionId: principal.sessionId,
            operatorId: principal.operatorId,
            tier: principal.tier,
          }
        : {
            sub: principal.playerId,
            aud: "player",
            sessionId: principal.sessionId,
            operatorId: principal.operatorId,
          };

    const { token, expiresIn } = await this.tokens.signAccess(claims);
    return { token, rooms: allowedRoomsFor(principal), expiresInSeconds: expiresIn };
  }

  /** Verify a handshake token and load the live principal, or throw. */
  async loadPrincipalFromToken(token: string): Promise<Principal> {
    const claims = await this.tokens.verifyAccess(token);
    return this.loadPrincipal(claims);
  }

  /**
   * Like loadPrincipalFromToken but also returns the token's expiry so the
   * gateway can drop the socket when its access token lapses (a connection must
   * never outlive its token; the client re-mints + reconnects). The live
   * principal reload also fails for a deactivated account, so re-handshake is
   * the deactivation kill-switch.
   */
  async loadConnection(token: string): Promise<{ principal: Principal; expSeconds: number | null }> {
    const claims = await this.tokens.verifyAccess(token);
    const principal = await this.loadPrincipal(claims);
    return { principal, expSeconds: typeof claims.exp === "number" ? claims.exp : null };
  }

  private async loadPrincipal(claims: AccessClaims): Promise<Principal> {
    if (claims.aud === "operator") {
      const operator = await this.prisma.operator.findFirst({
        where: { id: claims.operatorId, userId: claims.sub },
        include: { user: true },
      });
      if (!operator || operator.status !== "ACTIVE" || operator.user.status !== "ACTIVE") {
        throw new UnauthorizedError("Account is not active");
      }
      return {
        kind: "operator",
        userId: operator.userId,
        operatorId: operator.id,
        username: operator.user.username,
        displayName: operator.displayName,
        tier: operator.tier,
        path: operator.path,
        depth: operator.depth,
        mfaEnabled: operator.user.mfaEnabled,
        settings: (operator.settings as { permissions?: string[] }) ?? {},
        sessionId: claims.sessionId,
      };
    }

    const player = await this.prisma.player.findUnique({
      where: { id: claims.sub },
      include: { operator: { select: { path: true } } },
    });
    if (!player || player.status !== "ACTIVE") {
      throw new UnauthorizedError("Account is not active");
    }
    return {
      kind: "player",
      playerId: player.id,
      operatorId: player.operatorId,
      operatorPath: player.operator.path,
      username: player.username,
      sessionId: claims.sessionId,
    };
  }
}
