import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import {
  bps,
  type Currency,
  type Env,
  isInSubtree,
  operatorCurrency,
  type RechargeInput,
  type RechargeRequestInput,
  type RemoveCreditsInput,
  type WalletHistoryQuery,
} from "@aureus/shared";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { ComplianceService } from "../compliance/compliance.service";
import { LedgerService } from "../ledger/ledger.service";
import { type PostGroup } from "../ledger/ledger.types";
import { OperatorsService } from "../operators/operators.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

const DEFAULT_PRIZE_BONUS_BPS = 10_000; // 100% PRIZE bonus on a PLAY purchase

@Injectable()
export class WalletService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Agent recharges a player's wallet (docs/03 §4.3). OPERATOR mode: a single
   * CREDIT transfer. COMPLIANCE mode: a PLAY purchase from the agent plus a
   * PRIZE bonus granted from PROMO (the sweeps model), committed atomically.
   */
  async recharge(
    caller: OperatorPrincipal,
    input: RechargeInput,
    idempotencyKey: string,
    ctx: ActionContext,
  ) {
    const player = await this.prisma.player.findUnique({
      where: { id: input.playerId },
      select: { id: true, operatorId: true, operator: { select: { path: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    // Defense-in-depth: a credit-moving op must verify subtree ownership itself,
    // not lean only on the controller ScopeGuard (docs/04 §7 — two layers). The
    // Prisma read extension filters reads, not this write path.
    if (!isInSubtree(caller.path, player.operator.path)) throw new OutOfScopeError();

    await this.operators.assertOperatorActionable(caller.operatorId);
    // Pass the amount so the DEPOSIT responsible-gaming limit is actually enforced
    // (CR3 — it was previously called without an amount and silently skipped).
    await this.compliance.checkDeposit(player.id, { amountMinor: input.amountMinor });

    const keyBase = `recharge:${caller.operatorId}:${idempotencyKey}`;

    if (this.env.PLATFORM_MODE !== "COMPLIANCE") {
      const currency: Currency = "CREDIT";
      const result = await this.ledger.post({
        type: "RECHARGE",
        currency,
        idempotencyKey: keyBase,
        actor: { userId: caller.userId },
        ref: { type: "Recharge", id: player.id },
        memo: input.note,
        legs: [
          { account: { kind: "operator", operatorId: caller.operatorId, currency }, direction: "DEBIT", amountMinor: input.amountMinor },
          { account: { kind: "player", playerId: player.id, currency }, direction: "CREDIT", amountMinor: input.amountMinor },
        ],
      });
      await this.recordRecharge(caller, input, "CREDIT", 0n, result.transactionId, ctx);
      return { mode: "OPERATOR", transactionId: result.transactionId, prizeBonusMinor: "0" };
    }

    // COMPLIANCE mode: PLAY purchase + PRIZE bonus, atomic.
    const bonusBps = this.prizeBonusBps(caller);
    const prizeBonus = bps(input.amountMinor, bonusBps);
    const groups: PostGroup[] = [
      {
        type: "RECHARGE",
        currency: "PLAY",
        idempotencyKey: `${keyBase}:play`,
        legs: [
          { account: { kind: "operator", operatorId: caller.operatorId, currency: "PLAY" }, direction: "DEBIT", amountMinor: input.amountMinor },
          { account: { kind: "player", playerId: player.id, currency: "PLAY" }, direction: "CREDIT", amountMinor: input.amountMinor },
        ],
      },
    ];
    if (prizeBonus > 0n) {
      groups.push({
        type: "PROMO_GRANT",
        currency: "PRIZE",
        idempotencyKey: `${keyBase}:prize`,
        allowNegative: ["PROMO"],
        legs: [
          { account: { kind: "system", systemKey: "PROMO", currency: "PRIZE" }, direction: "DEBIT", amountMinor: prizeBonus },
          { account: { kind: "player", playerId: player.id, currency: "PRIZE" }, direction: "CREDIT", amountMinor: prizeBonus },
        ],
      });
    }
    const results = await this.ledger.postBatch(groups, {
      actor: { userId: caller.userId },
      ref: { type: "Recharge", id: player.id },
      memo: input.note,
    });
    await this.recordRecharge(caller, input, "PLAY", prizeBonus, results[0]?.transactionId ?? "", ctx);
    return {
      mode: "COMPLIANCE",
      transactionId: results[0]?.transactionId,
      prizeBonusMinor: prizeBonus.toString(),
    };
  }

  /**
   * Agent removes credits from a player's wallet (docs/03 §4.4). The removed
   * amount is BURNED: the player is debited and the system SINK account is
   * credited in the same currency — the agent's own balance is never touched, so
   * a removal can never refund or inflate the agent. The player cannot be driven
   * negative (the ledger rejects it), so an agent can only remove up to the
   * spendable balance it funded. Removal targets the operator-funded currency
   * (CREDIT in OPERATOR mode, PLAY in COMPLIANCE mode); redeemable PRIZE winnings
   * are never reachable here.
   */
  async removeCredits(
    caller: OperatorPrincipal,
    input: RemoveCreditsInput,
    idempotencyKey: string,
    ctx: ActionContext,
  ) {
    const player = await this.prisma.player.findUnique({
      where: { id: input.playerId },
      select: { id: true, operatorId: true, operator: { select: { path: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    // Defense-in-depth subtree check on the write path (docs/04 §7), matching recharge.
    if (!isInSubtree(caller.path, player.operator.path)) throw new OutOfScopeError();

    await this.operators.assertOperatorActionable(caller.operatorId);

    const currency: Currency = operatorCurrency(this.env.PLATFORM_MODE);
    const result = await this.ledger.post({
      type: "CREDIT_REMOVAL",
      currency,
      idempotencyKey: `remove:${caller.operatorId}:${idempotencyKey}`,
      actor: { userId: caller.userId },
      ref: { type: "CreditRemoval", id: player.id },
      memo: input.reason,
      legs: [
        { account: { kind: "player", playerId: player.id, currency }, direction: "DEBIT", amountMinor: input.amountMinor },
        { account: { kind: "system", systemKey: "SINK", currency }, direction: "CREDIT", amountMinor: input.amountMinor },
      ],
    });

    await this.audit.record({
      ...auditActor(caller),
      action: "wallet.remove",
      targetType: "Player",
      targetId: input.playerId,
      after: {
        amountMinor: input.amountMinor.toString(),
        currency,
        reason: input.reason,
        transactionId: result.transactionId,
      },
      ...ctx,
    });

    return {
      transactionId: result.transactionId,
      removedMinor: input.amountMinor.toString(),
      currency,
    };
  }

  /** Player asks their agent to load credits (no money moves; notifies the agent). */
  async rechargeRequest(player: PlayerPrincipal, input: RechargeRequestInput, ctx: ActionContext) {
    const owner = await this.prisma.operator.findUnique({
      where: { id: player.operatorId },
      select: { id: true, userId: true },
    });
    if (!owner) throw new NotFoundError("Owning operator not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.create({
        data: {
          audience: "OPERATOR",
          userId: owner.userId,
          title: "Recharge requested",
          body: `${player.username} requested a recharge of ${input.amountMinor.toString()} minor units`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: "recharge.requested",
          payload: { playerId: player.playerId, amountMinor: input.amountMinor.toString() },
          rooms: [`operator:${owner.id}`],
        },
      });
    });

    await this.audit.record({
      ...auditActor(player),
      action: "wallet.recharge_request",
      targetType: "Operator",
      targetId: owner.id,
      after: { amountMinor: input.amountMinor.toString() },
      ...ctx,
    });
    return { status: "requested" as const };
  }

  async getWallet(player: PlayerPrincipal) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: "PLAYER", playerId: player.playerId },
      select: { currency: true, balanceMinor: true },
    });
    return {
      wallets: accounts.map((a) => ({ currency: a.currency, balanceMinor: a.balanceMinor.toString() })),
    };
  }

  async getHistory(player: PlayerPrincipal, query: WalletHistoryQuery) {
    const items = await this.prisma.ledgerEntry.findMany({
      where: { account: { ownerType: "PLAYER", playerId: player.playerId } },
      select: {
        id: true,
        direction: true,
        amountMinor: true,
        currency: true,
        balanceAfterMinor: true,
        createdAt: true,
        transaction: { select: { type: true, memo: true } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    return {
      items: page.map((e) => ({
        id: e.id,
        type: e.transaction.type,
        direction: e.direction,
        currency: e.currency,
        amountMinor: e.amountMinor.toString(),
        balanceAfterMinor: e.balanceAfterMinor.toString(),
        memo: e.transaction.memo,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  // ---- internals -------------------------------------------------------------

  private prizeBonusBps(caller: OperatorPrincipal): number {
    const configured = caller.settings.prizeBonusBps;
    return typeof configured === "number" && configured >= 0 ? configured : DEFAULT_PRIZE_BONUS_BPS;
  }

  private async recordRecharge(
    caller: OperatorPrincipal,
    input: RechargeInput,
    purchaseCurrency: Currency,
    prizeBonus: bigint,
    transactionId: string,
    ctx: ActionContext,
  ): Promise<void> {
    await this.audit.record({
      ...auditActor(caller),
      action: "wallet.recharge",
      targetType: "Player",
      targetId: input.playerId,
      after: {
        amountMinor: input.amountMinor.toString(),
        purchaseCurrency,
        prizeBonusMinor: prizeBonus.toString(),
        unitPriceCents: input.unitPriceCents,
        transactionId,
      },
      ...ctx,
    });
  }
}
