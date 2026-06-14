import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { isInSubtree, type SelfExcludeInput, type SetRgLimitInput } from "@aureus/shared";
import { type Principal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Responsible-gaming limits and self-exclusion (docs/05 §8). The compliance gate
 * reads these rows: value/time limits throttle deposit/wager/loss/session, and a
 * self-exclusion (plus Player.status = SELF_EXCLUDED) blocks play and recharge.
 * `setByPlayer` records whether the player or an operator set a limit. Records
 * are not subtree-scoped, so operator actions assert subtree membership here.
 */
@Injectable()
export class RgService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  getLimits(playerId: string) {
    return this.prisma.responsibleGamingLimit.findMany({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });
  }

  async setLimit(actor: Principal, playerId: string, input: SetRgLimitInput, ctx: ActionContext) {
    await this.assertActorScope(actor, playerId);
    const setByPlayer = actor.kind === "player";
    const limit = await this.prisma.responsibleGamingLimit.create({
      data: {
        playerId,
        type: input.type,
        period: input.period,
        valueMinor: input.valueMinor ?? null,
        minutes: input.minutes ?? null,
        setByPlayer,
      },
    });
    await this.audit.record({
      ...auditActor(actor),
      action: "rg.set_limit",
      targetType: "ResponsibleGamingLimit",
      targetId: limit.id,
      after: {
        type: input.type,
        period: input.period,
        valueMinor: input.valueMinor?.toString() ?? null,
        minutes: input.minutes ?? null,
        setByPlayer,
      },
      ...ctx,
    });
    return limit;
  }

  /**
   * Upsert the player's self-exclusion. The account is flipped to SELF_EXCLUDED
   * only when the exclusion is currently in force (permanent or a future end),
   * so a back-dated `until` does not lock an otherwise active account.
   */
  async selfExclude(actor: Principal, playerId: string, input: SelfExcludeInput, ctx: ActionContext) {
    await this.assertActorScope(actor, playerId);
    const until = input.until ? new Date(input.until) : null;
    const isActive = until === null || until.getTime() > Date.now();

    const exclusion = await this.prisma.$transaction(async (tx) => {
      const ex = await tx.selfExclusion.upsert({
        where: { playerId },
        update: { until, reason: input.reason ?? null },
        create: { playerId, until, reason: input.reason ?? null },
      });
      if (isActive) {
        await tx.player.update({ where: { id: playerId }, data: { status: "SELF_EXCLUDED" } });
      }
      await tx.outboxEvent.create({
        data: {
          type: "compliance.self_excluded",
          payload: { playerId, until: until?.toISOString() ?? null },
          rooms: [`player:${playerId}`],
        },
      });
      return ex;
    });

    await this.audit.record({
      ...auditActor(actor),
      action: "rg.self_exclude",
      targetType: "Player",
      targetId: playerId,
      after: { until: until?.toISOString() ?? null, reason: input.reason ?? null, active: isActive },
      ...ctx,
    });
    return exclusion;
  }

  // ---- internals -------------------------------------------------------------

  private async assertActorScope(actor: Principal, playerId: string): Promise<void> {
    if (actor.kind === "player") {
      if (actor.playerId !== playerId) throw new OutOfScopeError();
      return;
    }
    // actor narrowed to OperatorPrincipal here.
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { operator: { select: { path: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    if (!isInSubtree(actor.path, player.operator.path)) throw new OutOfScopeError();
  }
}
