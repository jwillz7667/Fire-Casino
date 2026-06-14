import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import {
  type CreateOrderInput,
  type Env,
  isInSubtree,
  type ListOrdersQuery,
  type MarkOrderPaidInput,
  MINOR,
  operatorCurrency,
  type PresignProofInput,
  type RejectOrderInput,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OutOfScopeError,
} from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { LedgerService } from "../ledger/ledger.service";
import { OperatorsService } from "../operators/operators.service";
import { StorageService } from "../storage/storage.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** A child requests credits from its direct upline (docs/05 §3). */
  async request(caller: OperatorPrincipal, input: CreateOrderInput, ctx: ActionContext) {
    const buyer = await this.prisma.operator.findUnique({
      where: { id: caller.operatorId },
      select: { id: true, parentId: true, buyUnitPriceCents: true },
    });
    if (!buyer?.parentId) throw new ForbiddenError("No upline to request credits from");
    const seller = await this.prisma.operator.findUnique({
      where: { id: buyer.parentId },
      select: { id: true, sellUnitPriceCents: true },
    });
    if (!seller) throw new NotFoundError("Upline operator not found");

    const unitPriceCents = buyer.buyUnitPriceCents ?? seller.sellUnitPriceCents ?? 0;
    const totalCents = Number(input.quantityMinor / MINOR) * unitPriceCents;

    const order = await this.prisma.creditOrder.create({
      data: {
        buyerOperatorId: buyer.id,
        sellerOperatorId: seller.id,
        currency: operatorCurrency(this.env.PLATFORM_MODE),
        quantityMinor: input.quantityMinor,
        unitPriceCents,
        totalCents,
        status: "REQUESTED",
        paymentMethod: input.paymentMethod,
        paymentRef: input.paymentRef,
        proofUrl: input.proofUrl,
        note: input.note,
        requestedByUserId: caller.userId,
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "order.request",
      targetType: "CreditOrder",
      targetId: order.id,
      after: { quantityMinor: input.quantityMinor.toString(), sellerOperatorId: seller.id },
      ...ctx,
    });
    return order;
  }

  async list(caller: OperatorPrincipal, query: ListOrdersQuery) {
    const where: Prisma.CreditOrderWhereInput =
      query.role === "seller"
        ? { sellerOperatorId: caller.operatorId }
        : { buyerOperatorId: caller.operatorId };
    if (query.status) where.status = query.status;

    const items = await this.prisma.creditOrder.findMany({
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

  async get(caller: OperatorPrincipal, id: string) {
    const order = await this.loadVisible(caller, id);
    return order;
  }

  async acknowledge(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const order = await this.loadAsSeller(caller, id);
    if (order.status !== "REQUESTED") throw new ConflictError("Order is not awaiting acknowledgement");
    return this.transition(caller, id, "AWAITING_PAYMENT", "order.awaiting_payment", ctx);
  }

  async markPaid(caller: OperatorPrincipal, id: string, input: MarkOrderPaidInput, ctx: ActionContext) {
    const order = await this.loadAsSeller(caller, id);
    if (order.status !== "REQUESTED" && order.status !== "AWAITING_PAYMENT") {
      throw new ConflictError("Order cannot be marked paid in its current state");
    }
    const updated = await this.prisma.creditOrder.update({
      where: { id },
      data: {
        status: "PAID",
        paymentMethod: input.paymentMethod,
        paymentRef: input.paymentRef ?? order.paymentRef,
        proofUrl: input.proofUrl ?? order.proofUrl,
        decidedByUserId: caller.userId,
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "order.mark_paid",
      targetType: "CreditOrder",
      targetId: id,
      after: { paymentMethod: input.paymentMethod, status: "PAID" },
      ...ctx,
    });
    return updated;
  }

  /** Fulfill a paid order: post the ledger movement and link it to the order. */
  async issue(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const order = await this.loadAsSeller(caller, id);
    if (order.status === "ISSUED") return order; // idempotent at the workflow level
    if (order.status !== "PAID") throw new ConflictError("Order must be paid before issuing");

    const buyer = await this.prisma.operator.findUnique({
      where: { id: order.buyerOperatorId },
      select: { id: true },
    });
    if (!buyer) throw new NotFoundError("Buyer operator not found");
    await this.operators.assertOperatorActionable(buyer.id);

    const seller = order.sellerOperatorId
      ? await this.prisma.operator.findUnique({
          where: { id: order.sellerOperatorId },
          select: { id: true, tier: true },
        })
      : null;
    const isMint = !seller || seller.tier === "SUPER_ADMIN";
    const currency = order.currency;

    const result = await this.ledger.post({
      type: isMint ? "ISSUE" : "TRANSFER",
      currency,
      idempotencyKey: `order:${id}:issue`,
      allowNegative: isMint ? ["MINT"] : [],
      actor: { userId: caller.userId },
      ref: { type: "CreditOrder", id },
      memo: order.note ?? undefined,
      legs: isMint
        ? [
            { account: { kind: "system", systemKey: "MINT", currency }, direction: "DEBIT", amountMinor: order.quantityMinor },
            { account: { kind: "operator", operatorId: buyer.id, currency }, direction: "CREDIT", amountMinor: order.quantityMinor },
          ]
        : [
            { account: { kind: "operator", operatorId: seller.id, currency }, direction: "DEBIT", amountMinor: order.quantityMinor },
            { account: { kind: "operator", operatorId: buyer.id, currency }, direction: "CREDIT", amountMinor: order.quantityMinor },
          ],
    });

    const updated = await this.prisma.creditOrder.update({
      where: { id },
      data: { status: "ISSUED", issuedTxId: result.transactionId, decidedByUserId: caller.userId, decidedAt: new Date() },
    });

    // Off-ledger cash position: buyer owes the seller the agreed total (margin lives here, not the ledger).
    if (seller && order.totalCents > 0) {
      await this.prisma.settlement.upsert({
        where: {
          operatorId_counterpartyId_currency: {
            operatorId: seller.id,
            counterpartyId: buyer.id,
            currency,
          },
        },
        update: { netCents: { increment: order.totalCents }, lastEventAt: new Date() },
        create: { operatorId: seller.id, counterpartyId: buyer.id, currency, netCents: order.totalCents },
      });
    }

    await this.audit.record({
      ...auditActor(caller),
      action: "order.issue",
      targetType: "CreditOrder",
      targetId: id,
      after: { status: "ISSUED", transactionId: result.transactionId, isMint },
      ...ctx,
    });
    return updated;
  }

  async reject(caller: OperatorPrincipal, id: string, input: RejectOrderInput, ctx: ActionContext) {
    const order = await this.loadAsSeller(caller, id);
    this.assertCancellable(order.status);
    return this.cancelWith(caller, id, "order.reject", input.reason, ctx);
  }

  async cancel(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const order = await this.loadVisible(caller, id);
    if (order.buyerOperatorId !== caller.operatorId && order.sellerOperatorId !== caller.operatorId) {
      throw new OutOfScopeError();
    }
    this.assertCancellable(order.status);
    return this.cancelWith(caller, id, "order.cancel", undefined, ctx);
  }

  presignProof(caller: OperatorPrincipal, input: PresignProofInput) {
    return this.storage.presignUpload("assets", `proofs/${caller.operatorId}`, input.filename);
  }

  // ---- internals -------------------------------------------------------------

  private assertCancellable(status: string): void {
    if (status === "ISSUED" || status === "CANCELLED" || status === "REFUNDED") {
      throw new ConflictError("Order can no longer be cancelled");
    }
  }

  private async cancelWith(
    caller: OperatorPrincipal,
    id: string,
    action: string,
    reason: string | undefined,
    ctx: ActionContext,
  ) {
    const updated = await this.prisma.creditOrder.update({
      where: { id },
      data: { status: "CANCELLED", note: reason, decidedByUserId: caller.userId, decidedAt: new Date() },
    });
    await this.audit.record({
      ...auditActor(caller),
      action,
      targetType: "CreditOrder",
      targetId: id,
      after: { status: "CANCELLED", reason },
      ...ctx,
    });
    return updated;
  }

  private async transition(
    caller: OperatorPrincipal,
    id: string,
    status: "AWAITING_PAYMENT",
    action: string,
    ctx: ActionContext,
  ) {
    const updated = await this.prisma.creditOrder.update({ where: { id }, data: { status } });
    await this.audit.record({
      ...auditActor(caller),
      action,
      targetType: "CreditOrder",
      targetId: id,
      after: { status },
      ...ctx,
    });
    return updated;
  }

  private async loadAsSeller(caller: OperatorPrincipal, id: string) {
    const order = await this.prisma.creditOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.sellerOperatorId !== caller.operatorId) {
      throw new ForbiddenError("Only the selling operator can act on this order");
    }
    return order;
  }

  private async loadVisible(caller: OperatorPrincipal, id: string) {
    const order = await this.prisma.creditOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");
    // Visible to the buyer, the seller, or an ancestor of either (subtree view).
    const buyer = await this.prisma.operator.findUnique({
      where: { id: order.buyerOperatorId },
      select: { path: true },
    });
    const inScope =
      order.buyerOperatorId === caller.operatorId ||
      order.sellerOperatorId === caller.operatorId ||
      (buyer !== null && isInSubtree(caller.path, buyer.path));
    if (!inScope) throw new OutOfScopeError();
    return order;
  }
}
