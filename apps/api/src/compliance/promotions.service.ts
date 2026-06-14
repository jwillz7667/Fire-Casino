import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import {
  type CreatePromotionInput,
  type Currency,
  type RedeemPromoInput,
} from "@aureus/shared";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import { ConflictError, NotFoundError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { ComplianceService } from "./compliance.service";
import { LedgerService } from "../ledger/ledger.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Promotional credit grants (docs/05 §8). A redemption posts a PROMO_GRANT
 * (PROMO system account → player wallet) through the ledger, so the bonus is
 * fully accounted for and nets to zero. Per-player and total caps are enforced
 * by counting prior PROMO_GRANT transactions referencing the promotion. AMoE
 * (alternative means of entry) promos grant the redeemable PRIZE currency; all
 * others grant their configured currency. Idempotent per (promo, player).
 */
@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  async create(caller: OperatorPrincipal, input: CreatePromotionInput, ctx: ActionContext) {
    const promo = await this.prisma.promotion.create({
      data: {
        code: input.code,
        description: input.description ?? null,
        currency: input.currency,
        grantMinor: input.grantMinor,
        isAmoe: input.isAmoe,
        maxRedemptions: input.maxRedemptions ?? null,
        perPlayerLimit: input.perPlayerLimit,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "promo.create",
      targetType: "Promotion",
      targetId: promo.id,
      after: {
        code: promo.code,
        currency: promo.currency,
        grantMinor: promo.grantMinor.toString(),
        isAmoe: promo.isAmoe,
        perPlayerLimit: promo.perPlayerLimit,
        maxRedemptions: promo.maxRedemptions,
      },
      ...ctx,
    });
    return promo;
  }

  list() {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: "desc" } });
  }

  async redeem(player: PlayerPrincipal, input: RedeemPromoInput, ctx: ActionContext) {
    const promo = await this.prisma.promotion.findUnique({ where: { code: input.code } });
    if (!promo) throw new NotFoundError("Promotion not found");
    if (promo.status !== "ACTIVE") throw new ConflictError("Promotion is not active");
    const now = Date.now();
    if (promo.startsAt && promo.startsAt.getTime() > now) {
      throw new ConflictError("Promotion has not started");
    }
    if (promo.endsAt && promo.endsAt.getTime() < now) {
      throw new ConflictError("Promotion has ended");
    }

    // The grant credits the player's wallet — block self-excluded/suspended accounts.
    await this.compliance.assertPlayerActionable(player.playerId);

    // Caps are derived from posted PROMO_GRANT transactions referencing the promo.
    const totalRedemptions = await this.prisma.ledgerTransaction.count({
      where: { type: "PROMO_GRANT", refType: "Promotion", refId: promo.id },
    });
    if (promo.maxRedemptions !== null && totalRedemptions >= promo.maxRedemptions) {
      throw new ConflictError("Promotion redemption limit reached");
    }
    const playerRedemptions = await this.prisma.ledgerTransaction.count({
      where: {
        type: "PROMO_GRANT",
        refType: "Promotion",
        refId: promo.id,
        actorPlayerId: player.playerId,
      },
    });
    if (playerRedemptions >= promo.perPlayerLimit) {
      throw new ConflictError("You have already redeemed this promotion");
    }

    const currency: Currency = promo.isAmoe ? "PRIZE" : promo.currency;
    const result = await this.ledger.post({
      type: "PROMO_GRANT",
      currency,
      idempotencyKey: `promo:${promo.id}:${player.playerId}`,
      allowNegative: ["PROMO"],
      actor: { playerId: player.playerId },
      ref: { type: "Promotion", id: promo.id },
      memo: `Promo ${promo.code}`,
      legs: [
        { account: { kind: "system", systemKey: "PROMO", currency }, direction: "DEBIT", amountMinor: promo.grantMinor },
        { account: { kind: "player", playerId: player.playerId, currency }, direction: "CREDIT", amountMinor: promo.grantMinor },
      ],
    });

    await this.audit.record({
      ...auditActor(player),
      action: "promo.redeem",
      targetType: "Promotion",
      targetId: promo.id,
      after: {
        code: promo.code,
        currency,
        grantMinor: promo.grantMinor.toString(),
        transactionId: result.transactionId,
        replayed: result.replayed,
      },
      ...ctx,
    });

    return {
      promotionId: promo.id,
      code: promo.code,
      currency,
      grantMinor: promo.grantMinor.toString(),
      transactionId: result.transactionId,
      replayed: result.replayed,
    };
  }
}
