import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import {
  type Currency,
  type Env,
  type IssueCreditsInput,
  MINOR,
  operatorCurrency,
  type TransferCreditsInput,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ForbiddenError, NotFoundError, ValidationError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { LedgerService } from "../ledger/ledger.service";
import { OperatorsService } from "./operators.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class CreditsService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
  ) {}

  private get currency(): Currency {
    return operatorCurrency(this.env.PLATFORM_MODE);
  }

  /** Mint new credits from MINT into a target operator (docs/03 §4.1). */
  async issue(
    caller: OperatorPrincipal,
    input: IssueCreditsInput,
    idempotencyKey: string,
    ctx: ActionContext,
  ) {
    return this.ledger.transaction(async (tx) => {
      await this.operators.assertOperatorActionable(input.operatorId, tx);
      const currency = this.currency;
      const result = await this.ledger.postInTransaction(tx, {
        type: "ISSUE",
        currency,
        idempotencyKey: `issue:${caller.operatorId}:${idempotencyKey}`,
        allowNegative: ["MINT"],
        actor: { userId: caller.userId },
        ref: { type: "CreditIssue", id: input.operatorId },
        memo: input.memo,
        legs: [
          {
            account: { kind: "system", systemKey: "MINT", currency },
            direction: "DEBIT",
            amountMinor: input.quantityMinor,
          },
          {
            account: { kind: "operator", operatorId: input.operatorId, currency },
            direction: "CREDIT",
            amountMinor: input.quantityMinor,
          },
        ],
      });
      if (result.replayed) return result;
      await this.audit.record(
        {
          ...auditActor(caller),
          action: "ledger.issue",
          targetType: "Operator",
          targetId: input.operatorId,
          after: {
            quantityMinor: input.quantityMinor.toString(),
            currency,
            transactionId: result.transactionId,
          },
          ...ctx,
        },
        tx,
      );
      return result;
    });
  }

  /** Push credits from the caller to a direct child operator (docs/03 §4.2). */
  async transfer(
    caller: OperatorPrincipal,
    input: TransferCreditsInput,
    idempotencyKey: string,
    ctx: ActionContext,
  ) {
    return this.ledger.transaction(async (tx) => {
      const buyer = await this.loadDirectChild(caller, input.toOperatorId, tx);
      await this.operators.assertOperatorActionable(buyer.id, tx);

      // Convert the full fractional credit quantity to cents in BigInt before
      // dividing. Settlement.netCents is a PostgreSQL Int, so reject overflow
      // before creating any ledger entries or balance events.
      const totalCentsBig =
        input.unitPriceCents === undefined
          ? undefined
          : (input.quantityMinor * BigInt(input.unitPriceCents)) / MINOR;
      if (totalCentsBig !== undefined && totalCentsBig > 2_147_483_647n) {
        throw new ValidationError(undefined, "Transfer cash total exceeds the supported range");
      }
      const totalCents = totalCentsBig === undefined ? undefined : Number(totalCentsBig);
      const currency = this.currency;
      const result = await this.ledger.postInTransaction(tx, {
        type: "TRANSFER",
        currency,
        idempotencyKey: `transfer:${caller.operatorId}:${idempotencyKey}`,
        actor: { userId: caller.userId },
        ref: { type: "CreditTransfer", id: buyer.id },
        memo: input.memo,
        legs: [
          {
            account: { kind: "operator", operatorId: caller.operatorId, currency },
            direction: "DEBIT",
            amountMinor: input.quantityMinor,
          },
          {
            account: { kind: "operator", operatorId: buyer.id, currency },
            direction: "CREDIT",
            amountMinor: input.quantityMinor,
          },
        ],
      });

      if (result.replayed) return result;

      // Record the agreed cash the buyer owes the seller — margin/reporting only,
      // never the ledger (docs/03 §3). Positive netCents = counterparty owes operator.
      if (totalCents !== undefined) {
        await tx.settlement.upsert({
          where: {
            operatorId_counterpartyId_currency: {
              operatorId: caller.operatorId,
              counterpartyId: buyer.id,
              currency,
            },
          },
          update: { netCents: { increment: totalCents }, lastEventAt: new Date() },
          create: {
            operatorId: caller.operatorId,
            counterpartyId: buyer.id,
            currency,
            netCents: totalCents,
          },
        });
      }

      await this.audit.record(
        {
          ...auditActor(caller),
          action: "ledger.transfer",
          targetType: "Operator",
          targetId: buyer.id,
          after: {
            quantityMinor: input.quantityMinor.toString(),
            currency,
            unitPriceCents: input.unitPriceCents,
            transactionId: result.transactionId,
          },
          ...ctx,
        },
        tx,
      );
      return result;
    });
  }

  private async loadDirectChild(
    caller: OperatorPrincipal,
    operatorId: string,
    client: Pick<PrismaClient, "operator"> = this.prisma,
  ) {
    const buyer = await client.operator.findUnique({
      where: { id: operatorId },
      select: { id: true, parentId: true },
    });
    if (!buyer) throw new NotFoundError("Target operator not found");
    if (buyer.parentId !== caller.operatorId) {
      throw new ForbiddenError("Credits can only be transferred to a direct child");
    }
    return buyer;
  }
}
