import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { tierRequiresMfa } from "@aureus/shared";
import { MfaEnrollmentRequiredError } from "../errors/domain-error";
import { ALLOW_MFA_ENROLLMENT_KEY } from "./auth.decorators";
import { type Principal } from "./principal";

interface IncomingRequest {
  principal?: Principal;
}

/**
 * Server-side forced-MFA enforcement (global, runs after AccessTokenGuard which
 * loads `mfaEnabled` fresh from the DB). An operator whose tier requires MFA but
 * has not enrolled holds a valid session that can ONLY reach the enrollment flow
 * (routes marked @AllowMfaEnrollment); every other route is rejected with
 * MFA_ENROLLMENT_REQUIRED until they confirm a second factor.
 *
 * This closes the prior-audit critical where forced enrollment was a client-only
 * gate (the console MfaGate) — bypassable by calling the API directly with the
 * login token. Because mfaEnabled is read per-request, the same token starts
 * working for privileged routes the instant enrollment is confirmed; no re-login.
 */
@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IncomingRequest>();
    const principal = req.principal;

    // Public/pre-auth routes have no principal; players never require MFA.
    if (!principal || principal.kind !== "operator") return true;
    if (!tierRequiresMfa(principal.tier) || principal.mfaEnabled) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_ENROLLMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new MfaEnrollmentRequiredError();
  }
}
