import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient, type ScopedPrismaClient } from "@aureus/db";
import {
  type CancelRedemptionInput,
  type CreateRedemptionInput,
  type Currency,
  type Env,
  isInSubtree,
  type ListRedemptionsQuery,
  MINOR,
  type OperatorTier,
  redeemableCurrency,
  type RedemptionQueueQuery,
  type RejectRedemptionInput,
  type SettleRedemptionInput,
} from "@aureus/shared";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import {
  ConflictError,
  NotFoundError,
  OutOfScopeError,
} from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA, PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { ComplianceService } from "../compliance/compliance.service";
import { LedgerService } from "../ledger/ledger.service";
import { OperatorsService } from "../operators/operators.service";
import { StorageService } from "../storage/storage.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
  region?: string;
}

interface RedemptionRow {
  id: string;
  playerId: string;
  operatorId: string;
  currency: Currency;
  amountMinor: bigint;
  status: string;
  method: string | null;
  payoutRef: string | null;
  holdTxId: string | null;
  settleTxId: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  settledAt: Date | null;
}

/**
 * The cashout workflow (docs/03 §4.5, docs/05 §7). A request soft-checks the
 * redeemable balance against outstanding pending requests (no hold yet);
 * approval posts the REDEEM_HOLD (wallet → clearing); settle drains clearing →
 * mint; reject/withdraw before approval move no credits; cancel after approval
 * reverses the hold back to the player. Every money step is idempotent and
 * routes through LedgerService, and the clearing account never goes negative.
 */
@Injectable()
export class RedemptionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ScopedPrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private redeemCurrency(): Currency {
    return redeemableCurrency(this.env.PLATFORM_MODE);
  }

  // ---- player surface --------------------------------------------------------

  /** Player requests a cashout. Places no hold; routes to the approving operator. */
  async request(player: PlayerPrincipal, input: CreateRedemptionInput, ctx: ActionContext) {
    const currency = this.redeemCurrency();
    // Player-initiated: geo-check against the player's resolved region (CR1).
    await this.compliance.checkRedeem(player.playerId, input.amountMinor, { region: ctx.region });

    const owner = await this.system.operator.findUnique({
      where: { id: player.operatorId },
      select: { id: true, userId: true, path: true, settings: true, sellUnitPriceCents: true },
    });
    if (!owner) throw new NotFoundError("Owning operator not found");

    // Soft-reserve: redeemable balance minus already-pending requests must cover
    // this amount (docs/03 §4.5). Approved requests already left the wallet.
    const balance = await this.ledger.getBalance({ kind: "player", playerId: player.playerId, currency });
    const pending = await this.sumPending(player.playerId);
    if (input.amountMinor > balance - pending) {
      throw new ConflictError("Amount exceeds redeemable balance net of pending redemptions");
    }

    const approver = await this.resolveApprover(owner, input.amountMinor);

    const created = await this.system.$transaction(async (tx) => {
      const redemption = await tx.redemptionRequest.create({
        data: {
          playerId: player.playerId,
          operatorId: approver.id,
          currency,
          amountMinor: input.amountMinor,
          status: "PENDING",
          method: input.method,
        },
      });
      await tx.notification.create({
        data: {
          audience: "OPERATOR",
          userId: approver.userId,
          title: "Redemption requested",
          body: `${player.username} requested a redemption of ${input.amountMinor.toString()} minor units`,
        },
      });
      await tx.outboxEvent.createMany({
        data: [
          {
            type: "redemption.queued",
            payload: { requestId: redemption.id, amountMinor: input.amountMinor.toString() },
            rooms: [`operator:${approver.id}`],
          },
          {
            type: "redemption.updated",
            payload: { requestId: redemption.id, status: "PENDING" },
            rooms: [`player:${player.playerId}`],
          },
        ],
      });
      return redemption;
    });

    // Run AML detection on the new request (CR2). A raised flag blocks approval
    // via the compliance gate; screening never throws so it can't fail the request.
    await this.compliance.screenRedemption(player.playerId, input.amountMinor);

    await this.audit.record({
      ...auditActor(player),
      action: "redemption.request",
      targetType: "RedemptionRequest",
      targetId: created.id,
      after: {
        amountMinor: input.amountMinor.toString(),
        method: input.method,
        approverOperatorId: approver.id,
        payoutDetails: input.payoutDetails ?? null,
      },
      ...ctx,
    });
    return this.toDto(created);
  }

  async listMine(player: PlayerPrincipal, query: ListRedemptionsQuery) {
    const items = await this.prisma.redemptionRequest.findMany({
      where: { playerId: player.playerId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return this.paginate(items, query.limit);
  }

  /** Player withdraws their own still-pending request (no credits moved). */
  async withdraw(player: PlayerPrincipal, id: string, input: CancelRedemptionInput, ctx: ActionContext) {
    const redemption = await this.system.redemptionRequest.findUnique({ where: { id } });
    if (!redemption || redemption.playerId !== player.playerId) throw new NotFoundError("Redemption not found");
    if (redemption.status !== "PENDING") {
      throw new ConflictError("Only a pending request can be withdrawn");
    }
    const updated = await this.markCancelled(id, input.reason ?? "Withdrawn by player", redemption.playerId, null);
    await this.audit.record({
      ...auditActor(player),
      action: "redemption.withdraw",
      targetType: "RedemptionRequest",
      targetId: id,
      after: { status: "CANCELLED" },
      ...ctx,
    });
    return this.toDto(updated);
  }

  // ---- operator surface ------------------------------------------------------

  /**
   * Approval queue scoped to the caller's subtree (docs/06 §3.8). Subtree
   * filtering is applied by the scoped Prisma client from the request scope
   * (defense-in-depth layer 2); the controller's permission guard gates access.
   */
  async queue(query: RedemptionQueueQuery) {
    const items = await this.prisma.redemptionRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.playerId ? { playerId: query.playerId } : {}),
      },
      include: { player: { select: { username: true, operatorId: true } } },
      orderBy: { createdAt: "asc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    return {
      items: page.map((r) => ({ ...this.toDto(r), playerUsername: r.player.username, ownerOperatorId: r.player.operatorId })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async get(caller: OperatorPrincipal, id: string) {
    const redemption = await this.loadInScope(caller, id);
    const state = await this.compliance.getState(redemption.playerId);
    const player = await this.system.player.findUnique({
      where: { id: redemption.playerId },
      select: { username: true, operatorId: true },
    });
    return {
      ...this.toDto(redemption),
      playerUsername: player?.username ?? null,
      ownerOperatorId: player?.operatorId ?? null,
      compliance: state,
    };
  }

  /** Approve: burn redeemable credits into the clearing account (docs/03 §4.5 step 2). */
  async approve(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const redemption = await this.loadInScope(caller, id);
    // Idempotent at the workflow level (mirrors OrdersService.issue): a retry on an
    // already-approved request returns it without a second hold/payable/audit.
    if (redemption.status === "APPROVED") return this.toDto(redemption);
    if (redemption.status !== "PENDING") throw new ConflictError("Redemption is not pending approval");

    await this.operators.assertOperatorActionable(caller.operatorId);
    // Re-run the compliance gate at decision time (KYC threshold + open AML).
    await this.compliance.checkRedeem(redemption.playerId, redemption.amountMinor);

    const currency = redemption.currency;
    const result = await this.ledger.post({
      type: "REDEEM_HOLD",
      currency,
      idempotencyKey: `redeem:${id}:hold`,
      actor: { userId: caller.userId, playerId: redemption.playerId },
      ref: { type: "RedemptionRequest", id },
      legs: [
        { account: { kind: "player", playerId: redemption.playerId, currency }, direction: "DEBIT", amountMinor: redemption.amountMinor },
        { account: { kind: "system", systemKey: "REDEMPTION_CLEARING", currency }, direction: "CREDIT", amountMinor: redemption.amountMinor },
      ],
    });

    const updated = await this.system.$transaction(async (tx) => {
      const r = await tx.redemptionRequest.update({
        where: { id },
        data: { status: "APPROVED", holdTxId: result.transactionId, reviewedByUserId: caller.userId, decidedAt: new Date() },
      });
      await this.emit(tx, id, "APPROVED", redemption.playerId);
      return r;
    });

    await this.recordPayable(redemption);
    await this.audit.record({
      ...auditActor(caller),
      action: "redemption.approve",
      targetType: "RedemptionRequest",
      targetId: id,
      after: { status: "APPROVED", holdTxId: result.transactionId, amountMinor: redemption.amountMinor.toString() },
      ...ctx,
    });
    return this.toDto(updated);
  }

  async reject(caller: OperatorPrincipal, id: string, input: RejectRedemptionInput, ctx: ActionContext) {
    const redemption = await this.loadInScope(caller, id);
    if (redemption.status !== "PENDING") {
      throw new ConflictError("Only a pending redemption can be rejected; use cancel to reverse an approved hold");
    }
    const updated = await this.system.$transaction(async (tx) => {
      const r = await tx.redemptionRequest.update({
        where: { id },
        data: { status: "REJECTED", rejectionReason: input.reason, reviewedByUserId: caller.userId, decidedAt: new Date() },
      });
      await this.emit(tx, id, "REJECTED", redemption.playerId);
      return r;
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "redemption.reject",
      targetType: "RedemptionRequest",
      targetId: id,
      after: { status: "REJECTED", reason: input.reason },
      ...ctx,
    });
    return this.toDto(updated);
  }

  /** Settle: offline cash paid; drain clearing → mint (credits leave circulation). */
  async settle(caller: OperatorPrincipal, id: string, input: SettleRedemptionInput, ctx: ActionContext) {
    const redemption = await this.loadInScope(caller, id);
    if (redemption.status !== "APPROVED") throw new ConflictError("Redemption must be approved before settling");

    const currency = redemption.currency;
    const result = await this.ledger.post({
      type: "REDEEM_SETTLE",
      currency,
      idempotencyKey: `redeem:${id}:settle`,
      allowNegative: ["MINT"],
      actor: { userId: caller.userId, playerId: redemption.playerId },
      ref: { type: "RedemptionRequest", id },
      legs: [
        { account: { kind: "system", systemKey: "REDEMPTION_CLEARING", currency }, direction: "DEBIT", amountMinor: redemption.amountMinor },
        { account: { kind: "system", systemKey: "MINT", currency }, direction: "CREDIT", amountMinor: redemption.amountMinor },
      ],
    });

    const updated = await this.system.$transaction(async (tx) => {
      const r = await tx.redemptionRequest.update({
        where: { id },
        data: { status: "PAID", settleTxId: result.transactionId, payoutRef: input.payoutRef, settledAt: new Date() },
      });
      await this.emit(tx, id, "PAID", redemption.playerId);
      return r;
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "redemption.settle",
      targetType: "RedemptionRequest",
      targetId: id,
      after: { status: "PAID", settleTxId: result.transactionId, payoutRef: input.payoutRef },
      ...ctx,
    });
    return this.toDto(updated);
  }

  /** Operator cancel: reverse an approved hold back to the player, or void a pending request. */
  async cancel(caller: OperatorPrincipal, id: string, input: CancelRedemptionInput, ctx: ActionContext) {
    const redemption = await this.loadInScope(caller, id);
    if (redemption.status === "APPROVED") {
      const currency = redemption.currency;
      const result = await this.ledger.post({
        type: "REDEEM_CANCEL",
        currency,
        idempotencyKey: `redeem:${id}:cancel`,
        actor: { userId: caller.userId, playerId: redemption.playerId },
        ref: { type: "RedemptionRequest", id },
        legs: [
          { account: { kind: "system", systemKey: "REDEMPTION_CLEARING", currency }, direction: "DEBIT", amountMinor: redemption.amountMinor },
          { account: { kind: "player", playerId: redemption.playerId, currency }, direction: "CREDIT", amountMinor: redemption.amountMinor },
        ],
      });
      const updated = await this.markCancelled(id, input.reason ?? "Cancelled after approval", redemption.playerId, caller.userId);
      await this.audit.record({
        ...auditActor(caller),
        action: "redemption.cancel",
        targetType: "RedemptionRequest",
        targetId: id,
        after: { status: "CANCELLED", reversalTxId: result.transactionId },
        ...ctx,
      });
      return this.toDto(updated);
    }
    if (redemption.status !== "PENDING") throw new ConflictError("Redemption can no longer be cancelled");
    const updated = await this.markCancelled(id, input.reason ?? "Cancelled", redemption.playerId, caller.userId);
    await this.audit.record({
      ...auditActor(caller),
      action: "redemption.cancel",
      targetType: "RedemptionRequest",
      targetId: id,
      after: { status: "CANCELLED" },
      ...ctx,
    });
    return this.toDto(updated);
  }

  /** Presign an upload URL for offline payout proof attached at settle time. */
  presignProof(caller: OperatorPrincipal, filename: string) {
    return this.storage.presignUpload("assets", `redemptions/${caller.operatorId}`, filename);
  }

  // ---- internals -------------------------------------------------------------

  private async markCancelled(id: string, reason: string, playerId: string, userId: string | null) {
    return this.system.$transaction(async (tx) => {
      const r = await tx.redemptionRequest.update({
        where: { id },
        data: { status: "CANCELLED", rejectionReason: reason, reviewedByUserId: userId ?? undefined, decidedAt: new Date() },
      });
      await this.emit(tx, id, "CANCELLED", playerId);
      return r;
    });
  }

  private async emit(tx: Prisma.TransactionClient, requestId: string, status: string, playerId: string): Promise<void> {
    const redemption = await tx.redemptionRequest.findUnique({ where: { id: requestId }, select: { operatorId: true } });
    await tx.outboxEvent.create({
      data: {
        type: "redemption.updated",
        payload: { requestId, status },
        rooms: [`player:${playerId}`, ...(redemption ? [`operator:${redemption.operatorId}`] : [])],
      },
    });
  }

  private async sumPending(playerId: string): Promise<bigint> {
    const agg = await this.system.redemptionRequest.aggregate({
      where: { playerId, status: "PENDING" },
      _sum: { amountMinor: true },
    });
    return agg._sum.amountMinor ?? 0n;
  }

  /**
   * Determine the approving operator. Default: the owning store (it holds the
   * cash relationship). If the owner configured `redemptionApproval` with a
   * threshold and the amount meets it, route to the nearest ancestor of the
   * named tier (docs/04 §3 "who approves redemptions").
   */
  private async resolveApprover(
    owner: { id: string; userId: string; path: string; settings: unknown; sellUnitPriceCents: number | null },
    amountMinor: bigint,
  ): Promise<{ id: string; userId: string }> {
    const routing = this.parseRouting(owner.settings);
    if (!routing || routing.thresholdMinor === undefined || amountMinor < routing.thresholdMinor || !routing.approverTier) {
      return { id: owner.id, userId: owner.userId };
    }
    const ancestor = await this.nearestAncestorOfTier(owner.path, routing.approverTier);
    return ancestor ?? { id: owner.id, userId: owner.userId };
  }

  private parseRouting(settings: unknown): { thresholdMinor?: bigint; approverTier?: OperatorTier } | null {
    if (!settings || typeof settings !== "object") return null;
    const ra = (settings as Record<string, unknown>).redemptionApproval;
    if (!ra || typeof ra !== "object") return null;
    const obj = ra as Record<string, unknown>;
    const threshold = obj.thresholdMinor;
    const tier = obj.approverTier;
    return {
      thresholdMinor:
        typeof threshold === "string" || typeof threshold === "number" ? BigInt(threshold) : undefined,
      approverTier: typeof tier === "string" ? (tier as OperatorTier) : undefined,
    };
  }

  private async nearestAncestorOfTier(path: string, tier: OperatorTier): Promise<{ id: string; userId: string } | null> {
    const segments = path.split(".");
    const ancestorPaths: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      ancestorPaths.push(segments.slice(0, i).join("."));
    }
    if (ancestorPaths.length === 0) return null;
    const ancestor = await this.system.operator.findFirst({
      where: { path: { in: ancestorPaths }, tier },
      orderBy: { depth: "desc" },
      select: { id: true, userId: true },
    });
    return ancestor;
  }

  /** Record the off-ledger cash the owning agent owes the player (docs/03 §4.5). */
  private async recordPayable(redemption: RedemptionRow): Promise<void> {
    const player = await this.system.player.findUnique({
      where: { id: redemption.playerId },
      select: { operatorId: true, operator: { select: { sellUnitPriceCents: true } } },
    });
    if (!player) return;
    const unitCents = player.operator.sellUnitPriceCents ?? 0;
    if (unitCents <= 0) return;
    // Multiply before dividing so fractional credits aren't truncated away
    // (hard rule #1): 1.5 credits × 100¢ = 150¢, not 100¢. Final ÷MINOR floors to cents.
    const payoutCents = Number((redemption.amountMinor * BigInt(unitCents)) / MINOR);
    if (payoutCents <= 0) return;
    await this.system.settlement.upsert({
      where: {
        operatorId_counterpartyId_currency: {
          operatorId: player.operatorId,
          counterpartyId: redemption.playerId,
          currency: redemption.currency,
        },
      },
      // Negative net: the operator owes the player (a payable), distinct from the
      // positive receivables recorded on credit-order issuance.
      update: { netCents: { decrement: payoutCents }, lastEventAt: new Date() },
      create: { operatorId: player.operatorId, counterpartyId: redemption.playerId, currency: redemption.currency, netCents: -payoutCents },
    });
  }

  private async loadInScope(caller: OperatorPrincipal, id: string): Promise<RedemptionRow> {
    const redemption = await this.system.redemptionRequest.findUnique({
      where: { id },
      include: { player: { select: { operator: { select: { path: true } } } } },
    });
    if (!redemption) throw new NotFoundError("Redemption not found");
    if (!isInSubtree(caller.path, redemption.player.operator.path)) throw new OutOfScopeError();
    return redemption;
  }

  private paginate(items: RedemptionRow[], limit: number) {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page.map((r) => this.toDto(r)), nextCursor: hasMore ? page[page.length - 1]?.id : undefined };
  }

  private toDto(r: RedemptionRow) {
    return {
      id: r.id,
      playerId: r.playerId,
      operatorId: r.operatorId,
      currency: r.currency,
      amountMinor: r.amountMinor.toString(),
      status: r.status,
      method: r.method,
      payoutRef: r.payoutRef,
      holdTxId: r.holdTxId,
      settleTxId: r.settleTxId,
      rejectionReason: r.rejectionReason,
      reviewedByUserId: r.reviewedByUserId,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      settledAt: r.settledAt,
    };
  }
}
