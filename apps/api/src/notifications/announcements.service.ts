import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import { type CreateAnnouncementInput, type ListAnnouncementsQuery } from "@aureus/shared";
import { type OperatorPrincipal, type Principal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/** Every prefix of a materialized path, inclusive (e.g. "0.1.2" → ["0","0.1","0.1.2"]). */
function ancestorPaths(path: string): string[] {
  const segments = path.split(".");
  const paths: string[] = [];
  for (let i = 1; i <= segments.length; i++) paths.push(segments.slice(0, i).join("."));
  return paths;
}

/**
 * Announcements (docs/06 §3.13, docs/07 §2.8). An operator broadcasts to its
 * subtree (operatorScopePath defaults to the caller's path); a principal sees an
 * announcement when it targets its audience and a path at or above its own node
 * (or is global). Clients fetch on load + reconnect, so delivery never depends on
 * a live socket.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async create(caller: OperatorPrincipal, input: CreateAnnouncementInput, ctx: ActionContext) {
    const announcement = await this.prisma.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        audience: input.audience,
        // Default to the caller's own subtree; an explicit path must still be at
        // or below the caller (can't broadcast above your scope).
        operatorScopePath: this.resolveScopePath(caller, input.operatorScopePath),
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        active: true,
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "announcement.create",
      targetType: "Announcement",
      targetId: announcement.id,
      after: { title: input.title, audience: input.audience },
      ...ctx,
    });
    return announcement;
  }

  async list(principal: Principal, query: ListAnnouncementsQuery) {
    const now = new Date();
    const path = principal.kind === "operator" ? principal.path : principal.operatorPath;
    const audiences: ("PLAYERS" | "OPERATORS" | "BOTH")[] =
      principal.kind === "operator" ? ["OPERATORS", "BOTH"] : ["PLAYERS", "BOTH"];

    const where: Prisma.AnnouncementWhereInput = {
      audience: { in: audiences },
      // Global (null) or any ancestor-or-self broadcaster's scope.
      OR: [{ operatorScopePath: null }, { operatorScopePath: { in: ancestorPaths(path) } }],
      ...(query.activeOnly
        ? {
            active: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          }
        : {}),
    };

    const items = await this.prisma.announcement.findMany({
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

  async deactivate(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Announcement not found");
    // Only the broadcaster or an ancestor may pull it (hard rule #4): the scope
    // path must be the caller's own node or a descendant. A global (null) scope
    // is reserved for the super admin at the tree root.
    const scope = existing.operatorScopePath;
    const inScope =
      scope === null
        ? caller.tier === "SUPER_ADMIN"
        : scope === caller.path || scope.startsWith(`${caller.path}.`);
    if (!inScope) throw new OutOfScopeError();
    const updated = await this.prisma.announcement.update({ where: { id }, data: { active: false } });
    await this.audit.record({
      ...auditActor(caller),
      action: "announcement.deactivate",
      targetType: "Announcement",
      targetId: id,
      after: { active: false },
      ...ctx,
    });
    return updated;
  }

  private resolveScopePath(caller: OperatorPrincipal, requested?: string): string {
    if (!requested) return caller.path;
    // Never broadcast outside your own subtree: an explicit scope must be the
    // caller's path or a descendant of it.
    return requested === caller.path || requested.startsWith(`${caller.path}.`) ? requested : caller.path;
  }
}
