import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { type Principal } from "../auth/principal";

/** Runs before authentication, including invalid-token requests. */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return `ip:${await super.getTracker(req)}`;
  }
}

/** Runs after authentication: authenticated users retain their own counters
 * across IP changes. Public auth routes use only the pre-auth IP guard.
 */
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  protected override headerPrefix = "X-Principal-RateLimit";

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ principal?: Principal }>();
    return !req.principal || (await super.shouldSkip(context));
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const principal = req.principal as Principal | undefined;
    if (principal?.kind === "operator") return Promise.resolve(`op:${principal.userId}`);
    if (principal?.kind === "player") return Promise.resolve(`pl:${principal.playerId}`);
    throw new Error("Principal throttling requires an authenticated principal");
  }
}
