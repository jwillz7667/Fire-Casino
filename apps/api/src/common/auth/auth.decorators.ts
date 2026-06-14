import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { type Permission } from "@aureus/shared";
import {
  type Audience,
  type OperatorPrincipal,
  type PlayerPrincipal,
  type Principal,
} from "./principal";

export const IS_PUBLIC_KEY = "auth:isPublic";
export const AUDIENCE_KEY = "auth:audience";
export const PERMISSIONS_KEY = "auth:permissions";
export const SCOPE_CHECK_KEY = "auth:scopeCheck";

/** Marks a route as not requiring authentication. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Declares the token audience a route requires (operator console vs player arcade). */
export const Auth = (audience: Audience): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIENCE_KEY, audience);

/** Requires the caller to hold every listed permission (docs/04 §3). */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface ScopeCheckConfig {
  /** Route param/body/query keys carrying an operator id to subtree-check. */
  operatorIdFrom?: { source: "params" | "query" | "body"; key: string }[];
  /** Route param/body/query keys carrying a player id to subtree-check. */
  playerIdFrom?: { source: "params" | "query" | "body"; key: string }[];
}

/** Declares which request values are scoped ids the ScopeGuard must verify. */
export const ScopeCheck = (config: ScopeCheckConfig): MethodDecorator =>
  SetMetadata(SCOPE_CHECK_KEY, config);

function principalOf(ctx: ExecutionContext): Principal {
  const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
  if (!req.principal) throw new UnauthorizedException();
  return req.principal;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OperatorPrincipal => {
    const principal = principalOf(ctx);
    if (principal.kind !== "operator") throw new UnauthorizedException();
    return principal;
  },
);

export const CurrentPlayer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlayerPrincipal => {
    const principal = principalOf(ctx);
    if (principal.kind !== "player") throw new UnauthorizedException();
    return principal;
  },
);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => principalOf(ctx),
);
