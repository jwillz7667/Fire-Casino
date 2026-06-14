import { Controller, Get, Inject, Query } from "@nestjs/common";
import { type Prisma, type PrismaClient, type ScopedPrismaClient } from "@aureus/db";
import { type AuditQuery, auditQuerySchema } from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PRISMA, PRISMA_SYSTEM } from "../prisma/prisma.module";

/**
 * Read-only audit log viewer (docs/05 §9, docs/06 §3.12). Append-only by
 * construction — this surface exposes only a filtered, cursor-paginated read;
 * there is no update/delete path anywhere, including super admin (hard rule #5).
 *
 * Scope (AuditLog has no subtree path of its own): SUPER_ADMIN/ADMIN see the full
 * log; every other tier is restricted to rows whose actorId is themselves or a
 * descendant — resolved by collecting the subtree's operator user ids and player
 * ids via the scoped Prisma client (which fail-closes outside the subtree) and
 * filtering `actorId IN (...)`. This is best-effort by actor identity; target-only
 * rows authored by an out-of-subtree actor are not shown to lower tiers.
 */
@Controller("audit")
@Auth("operator")
@RequirePermission("audit.view")
export class AuditController {
  constructor(
    @Inject(PRISMA) private readonly scoped: ScopedPrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
  ) {}

  @Get()
  async list(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.actorType) where.actorType = query.actorType;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }

    const isAdmin = caller.tier === "SUPER_ADMIN" || caller.tier === "ADMIN";
    if (isAdmin) {
      if (query.actorId) where.actorId = query.actorId;
    } else {
      const actorIds = await this.subtreeActorIds();
      // Intersect an explicit actorId filter with the allowed set; an out-of-subtree
      // actorId collapses to an empty IN-list that matches nothing.
      where.actorId = query.actorId
        ? { in: actorIds.includes(query.actorId) ? [query.actorId] : [] }
        : { in: actorIds };
    }

    const items = await this.system.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    return {
      items: hasMore ? items.slice(0, query.limit) : items,
      nextCursor: hasMore ? items[query.limit - 1]?.id : undefined,
    };
  }

  /** Operator user ids + player ids in the caller's subtree (scoped client fail-closes). */
  private async subtreeActorIds(): Promise<string[]> {
    const [operators, players] = await Promise.all([
      this.scoped.operator.findMany({ select: { userId: true } }),
      this.scoped.player.findMany({ select: { id: true } }),
    ]);
    return [...operators.map((o) => o.userId), ...players.map((p) => p.id)];
  }
}
