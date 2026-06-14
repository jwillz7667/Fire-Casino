import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isInSubtree } from "@aureus/shared";
import { type PrismaClient } from "@aureus/db";
import { OutOfScopeError, UnauthorizedError } from "../errors/domain-error";
import { PRISMA_SYSTEM } from "../../prisma/prisma.module";
import { SCOPE_CHECK_KEY, type ScopeCheckConfig } from "./auth.decorators";
import { type Principal } from "./principal";

interface ScopedRequest {
  principal?: Principal;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/**
 * Subtree boundary guard (docs/04 §2, layer 1). For routes annotated with
 * @ScopeCheck, loads each referenced operator/player target and asserts it lives
 * inside the caller's subtree, else OUT_OF_SCOPE. Complements the Prisma
 * extension (layer 2): a bug in one is caught by the other.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<ScopeCheckConfig>(SCOPE_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!config) return true;

    const req = context.switchToHttp().getRequest<ScopedRequest>();
    const principal = req.principal;
    if (!principal) throw new UnauthorizedError();
    // Scope-checked routes are operator routes.
    if (principal.kind !== "operator") throw new OutOfScopeError();
    const callerPath = principal.path;

    for (const ref of config.operatorIdFrom ?? []) {
      const id = this.read(req, ref);
      if (id === undefined) continue;
      const target = await this.prisma.operator.findUnique({
        where: { id },
        select: { path: true },
      });
      if (!target || !isInSubtree(callerPath, target.path)) throw new OutOfScopeError();
    }

    for (const ref of config.playerIdFrom ?? []) {
      const id = this.read(req, ref);
      if (id === undefined) continue;
      const target = await this.prisma.player.findUnique({
        where: { id },
        select: { operator: { select: { path: true } } },
      });
      if (!target || !isInSubtree(callerPath, target.operator.path)) throw new OutOfScopeError();
    }

    return true;
  }

  private read(
    req: ScopedRequest,
    ref: { source: "params" | "query" | "body"; key: string },
  ): string | undefined {
    const bag = req[ref.source];
    const value = bag?.[ref.key];
    return typeof value === "string" ? value : undefined;
  }
}
