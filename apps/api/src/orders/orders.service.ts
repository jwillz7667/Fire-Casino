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
  ValidationError,
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
    if (input.proofUrl) this.proofKey(input.proofUrl, [caller.operatorId]);
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
    // Multiply in BigInt BEFORE dividing so fractional credits aren't truncated
    // away, and never float-multiply money (hard rule #1, audit D3). The previous
    // `Number(qty / MINOR) * cents` dropped sub-credit quantities and lost
    // precision on large orders.
    const totalCentsBig = (input.quantityMinor * BigInt(unitPriceCents)) / MINOR;
    if (totalCentsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ValidationError(undefined, "Order total exceeds the supported range");
    }
    const totalCents = Number(totalCentsBig);

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
    await this.emitOrderUpdated(order);
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
    let where: Prisma.CreditOrderWhereInput;
    if (query.operatorId) {
      // Operator-detail Orders tab: every order touching this node. It must be
      // inside the caller's subtree (hard rule #4 — never trust a client id).
      const node = await this.prisma.operator.findUnique({
        where: { id: query.operatorId },
        select: { path: true },
      });
      if (!node) throw new NotFoundError("Operator not found");
      if (!isInSubtree(caller.path, node.path)) throw new OutOfScopeError();
      where = {
        OR: [{ buyerOperatorId: query.operatorId }, { sellerOperatorId: query.operatorId }],
      };
    } else {
      where =
        query.role === "seller"
          ? { sellerOperatorId: caller.operatorId }
          : { buyerOperatorId: caller.operatorId };
    }
    if (query.status) where.status = query.status;

    const items = await this.prisma.creditOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;

    // Attach counterparty display names so the inbox/outbox can show WHO the order
    // is with (docs/06 §3.5). One lookup over the page's buyer+seller ids; these
    // are the caller's own orders so the names are authorized to show.
    const ids = [
      ...new Set(
        page.flatMap((o) => [o.buyerOperatorId, o.sellerOperatorId]).filter((x): x is string => Boolean(x)),
      ),
    ];
    const ops = ids.length
      ? await this.prisma.operator.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(ops.map((o) => [o.id, o.displayName]));

    return {
      items: page.map((o) => ({
        ...o,
        buyerName: nameById.get(o.buyerOperatorId) ?? null,
        sellerName: o.sellerOperatorId ? (nameById.get(o.sellerOperatorId) ?? null) : null,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async get(caller: OperatorPrincipal, id: string) {
    const order = await this.loadVisible(caller, id);
    return order;
  }

  async acknowledge(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    return this.ledger.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_orders WHERE id = ${id} FOR UPDATE`;
      const order = await this.loadAsSeller(caller, id, tx);
      if (order.status !== "REQUESTED") throw new ConflictError("Order is not awaiting acknowledgement");
      return this.transition(caller, id, "AWAITING_PAYMENT", "order.awaiting_payment", ctx, tx);
    });
  }

  async markPaid(caller: OperatorPrincipal, id: string, input: MarkOrderPaidInput, ctx: ActionContext) {
    if (input.proofUrl) this.proofKey(input.proofUrl, [caller.operatorId]);
    return this.ledger.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_orders WHERE id = ${id} FOR UPDATE`;
      const order = await this.loadAsSeller(caller, id, tx);
      if (order.status !== "REQUESTED" && order.status !== "AWAITING_PAYMENT") {
        throw new ConflictError("Order cannot be marked paid in its current state");
      }
      const updated = await tx.creditOrder.update({
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
      }, tx);
      await this.emitOrderUpdated(updated, tx);
      return updated;
    });
  }

  /** Fulfill a paid order: post the ledger movement and link it to the order. */
  async issue(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    return this.ledger.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_orders WHERE id = ${id} FOR UPDATE`;
      const order = await this.loadAsSeller(caller, id, tx);
      if (order.status === "ISSUED") return order; // idempotent at the workflow level
      if (order.status !== "PAID") throw new ConflictError("Order must be paid before issuing");

      const buyer = await tx.operator.findUnique({
        where: { id: order.buyerOperatorId },
        select: { id: true },
      });
      if (!buyer) throw new NotFoundError("Buyer operator not found");
      await this.operators.assertOperatorActionable(buyer.id, tx);

      const seller = order.sellerOperatorId
        ? await tx.operator.findUnique({
            where: { id: order.sellerOperatorId },
            select: { id: true, tier: true },
          })
        : null;
      const isMint = !seller || seller.tier === "SUPER_ADMIN";
      const currency = order.currency;

      const result = await this.ledger.postInTransaction(tx, {
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

      const updated = await tx.creditOrder.update({
        where: { id },
        data: { status: "ISSUED", issuedTxId: result.transactionId, decidedByUserId: caller.userId, decidedAt: new Date() },
      });

      // Off-ledger cash position: buyer owes the seller the agreed total (margin lives here, not the ledger).
      if (seller && order.totalCents > 0) {
        await tx.settlement.upsert({
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
      }, tx);
      await this.emitOrderUpdated(updated, tx);
      return updated;
    });
  }

  async reject(caller: OperatorPrincipal, id: string, input: RejectOrderInput, ctx: ActionContext) {
    return this.ledger.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_orders WHERE id = ${id} FOR UPDATE`;
      const order = await this.loadAsSeller(caller, id, tx);
      this.assertCancellable(order.status);
      return this.cancelWith(caller, id, "order.reject", input.reason, ctx, tx);
    });
  }

  async cancel(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    return this.ledger.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_orders WHERE id = ${id} FOR UPDATE`;
      const order = await this.loadVisible(caller, id, tx);
      if (order.buyerOperatorId !== caller.operatorId && order.sellerOperatorId !== caller.operatorId) {
        throw new OutOfScopeError();
      }
      this.assertCancellable(order.status);
      return this.cancelWith(caller, id, "order.cancel", undefined, ctx, tx);
    });
  }

  presignProof(caller: OperatorPrincipal, input: PresignProofInput) {
    return this.storage.presignUpload("kyc", `proofs/${caller.operatorId}`, input.filename);
  }

  async proofDocument(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    const order = await this.loadVisible(caller, id);
    if (!order.proofUrl) throw new NotFoundError("Payment proof not found");
    const key = this.proofKey(order.proofUrl, [order.buyerOperatorId, ...(order.sellerOperatorId ? [order.sellerOperatorId] : [])]);
    await this.audit.record({ ...auditActor(caller), action: "order.proof_view", targetType: "CreditOrder", targetId: id, ...ctx });
    return { url: this.storage.presignDownload("kyc", key), expiresInSeconds: 300 };
  }

  private proofKey(url: string, operatorIds: string[]): string {
    const key = this.storage.keyFromFileUrl("kyc", url);
    if (!key || !operatorIds.some((operatorId) => key.startsWith(`proofs/${operatorId}/`))) {
      throw new ValidationError(undefined, "Payment proof must be uploaded to this operator's private proof folder");
    }
    return key;
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
    tx: Prisma.TransactionClient,
  ) {
    const updated = await tx.creditOrder.update({
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
    }, tx);
    await this.emitOrderUpdated(updated, tx);
    return updated;
  }

  private async transition(
    caller: OperatorPrincipal,
    id: string,
    status: "AWAITING_PAYMENT",
    action: string,
    ctx: ActionContext,
    tx: Prisma.TransactionClient,
  ) {
    const updated = await tx.creditOrder.update({ where: { id }, data: { status } });
    await this.audit.record({
      ...auditActor(caller),
      action,
      targetType: "CreditOrder",
      targetId: id,
      after: { status },
      ...ctx,
    }, tx);
    await this.emitOrderUpdated(updated, tx);
    return updated;
  }

  /** Push order.updated to both parties' rooms so the consoles refresh live (R1). */
  private async emitOrderUpdated(order: {
    id: string;
    status: string;
    buyerOperatorId: string;
    sellerOperatorId: string | null;
  }, client: Pick<PrismaClient, "outboxEvent"> = this.prisma): Promise<void> {
    const rooms = [
      `operator:${order.buyerOperatorId}`,
      ...(order.sellerOperatorId ? [`operator:${order.sellerOperatorId}`] : []),
    ];
    await client.outboxEvent.create({
      data: { type: "order.updated", payload: { orderId: order.id, status: order.status }, rooms },
    });
  }

  private async loadAsSeller(caller: OperatorPrincipal, id: string, client: Pick<PrismaClient, "creditOrder"> = this.prisma) {
    const order = await client.creditOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");
    if (order.sellerOperatorId !== caller.operatorId) {
      throw new ForbiddenError("Only the selling operator can act on this order");
    }
    return order;
  }

  private async loadVisible(caller: OperatorPrincipal, id: string, client: Pick<PrismaClient, "creditOrder" | "operator"> = this.prisma) {
    const order = await client.creditOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError("Order not found");
    // Visible to the buyer, the seller, or an ancestor of either (subtree view).
    const buyer = await client.operator.findUnique({
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
