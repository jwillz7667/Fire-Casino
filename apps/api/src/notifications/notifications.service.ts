import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import { type ListNotificationsQuery } from "@aureus/shared";
import { type Principal } from "../common/auth/principal";
import { NotFoundError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";

/**
 * Per-principal notification inbox (docs/06 §1, docs/07 §2.8). Rows are written
 * by the domain services (recharge requested, redemption queued, …); this
 * exposes reads + read receipts. A principal only ever sees its own rows.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient) {}

  private ownerWhere(principal: Principal): Prisma.NotificationWhereInput {
    return principal.kind === "operator"
      ? { userId: principal.userId }
      : { playerId: principal.playerId };
  }

  async list(principal: Principal, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      ...this.ownerWhere(principal),
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.notification.count({ where: { ...this.ownerWhere(principal), readAt: null } }),
    ]);
    const hasMore = items.length > query.limit;
    return {
      items: hasMore ? items.slice(0, query.limit) : items,
      nextCursor: hasMore ? items[query.limit - 1]?.id : undefined,
      unreadCount: unread,
    };
  }

  async markRead(principal: Principal, id: string) {
    // Scope the update to the owner so one principal cannot read another's row.
    const result = await this.prisma.notification.updateMany({
      where: { id, ...this.ownerWhere(principal), readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, ...this.ownerWhere(principal) },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError("Notification not found");
    }
    return { ok: true };
  }

  async markAllRead(principal: Principal) {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.ownerWhere(principal), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
