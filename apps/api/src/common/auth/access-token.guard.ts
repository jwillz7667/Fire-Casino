import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PinoLogger } from "nestjs-pino";
import { type PrismaClient } from "@aureus/db";
import { UnauthorizedError } from "../errors/domain-error";
import { PRISMA_SYSTEM } from "../../prisma/prisma.module";
import { type AccessClaims, TokenService } from "../../auth/token.service";
import { ScopeService } from "../scope/scope.service";
import { AUDIENCE_KEY, IS_PUBLIC_KEY } from "./auth.decorators";
import { type Audience, type Principal } from "./principal";

interface IncomingRequest {
  principal?: Principal;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/**
 * Authentication guard (global). Validates the JWT access token, enforces the
 * route's required audience, loads the principal fresh from the DB (path/tier
 * resolved per request, never from the token — docs/01 §4), attaches it to the
 * request, and seeds the AsyncLocalStorage scope used by the scoped Prisma
 * client and the ScopeGuard. Routes marked @Public bypass it.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly scope: ScopeService,
    private readonly logger: PinoLogger,
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<IncomingRequest>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedError();

    let claims: AccessClaims;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }

    const requiredAudience = this.reflector.getAllAndOverride<Audience>(AUDIENCE_KEY, targets);
    if (requiredAudience && claims.aud !== requiredAudience) {
      throw new UnauthorizedError("Token not valid for this surface");
    }

    const principal = await this.loadPrincipal(claims);
    req.principal = principal;
    this.seedScope(principal);
    // Bind the principal id to every subsequent log line in this request (docs/01 §11).
    this.logger.assign({
      principalKind: principal.kind,
      principalId: principal.kind === "operator" ? principal.userId : principal.playerId,
      operatorId: principal.operatorId,
    });
    return true;
  }

  private extractToken(req: IncomingRequest): string | null {
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }
    return req.cookies?.fc_access ?? null;
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

  private seedScope(principal: Principal): void {
    if (principal.kind === "operator") {
      this.scope.set({
        kind: "operator",
        path: principal.path,
        operatorId: principal.operatorId,
        tier: principal.tier,
        userId: principal.userId,
      });
    } else {
      this.scope.set({
        kind: "player",
        playerId: principal.playerId,
        operatorId: principal.operatorId,
      });
    }
  }
}
