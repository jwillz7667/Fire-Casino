import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type Permission } from "@aureus/shared";
import { ForbiddenError } from "../errors/domain-error";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "./auth.decorators";
import { type Principal } from "./principal";

/**
 * Authorization guard (global). Enforces @RequirePermission via the docs/04 §3
 * matrix (base set ∪ per-operator grants). Permission-gated routes are operator
 * routes; a player principal is always forbidden from them.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyRequired = this.reflector.getAllAndOverride<Permission[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !anyRequired?.length) return true;

    const req = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = req.principal;
    if (!principal || principal.kind !== "operator") {
      throw new ForbiddenError("Operator privileges required");
    }

    const hasPermission = (perm: Permission) => can(principal.tier, principal.settings, perm);
    const ok =
      (!required?.length || required.every(hasPermission)) &&
      (!anyRequired?.length || anyRequired.some(hasPermission));
    if (!ok) throw new ForbiddenError("Missing required permission");
    return true;
  }
}
