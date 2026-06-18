import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import {
  type AmlFlagsQuery,
  type AmlSeverity,
  isInSubtree,
  type ResolveAmlFlagInput,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

// Detection thresholds (docs/05 §8, CR2). Sensible defaults; tune per jurisdiction.
const LARGE_REDEMPTION_MINOR = 5_000_000n; // single cashout ≥ 5,000 credits → flag
const HIGH_REDEMPTION_MINOR = 20_000_000n; // ≥ 20,000 credits → HIGH severity
const VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const VELOCITY_COUNT = 5; // ≥ 5 redemption requests in the window → flag

/** Internal hook input for raising an AML flag from another module/job. */
export interface CreateAmlFlagInput {
  subjectType: "PLAYER" | "OPERATOR";
  subjectId: string;
  ruleCode: string;
  severity: AmlSeverity;
  details: Prisma.InputJsonValue;
}

/**
 * AML flag queue and resolution (docs/05 §8). An OPEN or ESCALATED flag blocks
 * redemption via the compliance gate (`assertNoOpenAml`). The AML detection
 * provider is a stub (docs/01 §8); `createFlag` is the internal hook other
 * modules call to raise one, emitting an `aml.flagged` event to the admin room.
 */
@Injectable()
export class AmlService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async listFlags(caller: OperatorPrincipal, query: AmlFlagsQuery) {
    // A subject filter must resolve to a node inside the caller's subtree
    // (AmlFlag is not a scoped Prisma model, so enforce explicitly — hard rule #4).
    if (query.subjectId) await this.assertSubjectInSubtree(caller, query.subjectId);
    const items = await this.prisma.amlFlag.findMany({
      where: {
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      },
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

  async resolve(caller: OperatorPrincipal, id: string, input: ResolveAmlFlagInput, ctx: ActionContext) {
    const flag = await this.prisma.amlFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundError("AML flag not found");
    // Can't clear/escalate a flag whose subject is outside your subtree (hard rule #4).
    await this.assertSubjectInSubtree(caller, flag.subjectId, flag.subjectType);
    const updated = await this.prisma.amlFlag.update({
      where: { id },
      data: {
        status: input.resolution,
        resolvedByUserId: caller.userId,
        // REVIEWING is an interim state — only a terminal decision stamps resolvedAt.
        resolvedAt: input.resolution === "REVIEWING" ? null : new Date(),
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "aml.resolve",
      targetType: "AmlFlag",
      targetId: id,
      before: { status: flag.status },
      after: { status: updated.status, note: input.note ?? null },
      ...ctx,
    });
    return updated;
  }

  /**
   * Detection rules run on a redemption request (CR2): a single large cashout and
   * a rapid-redemption velocity rule. Each raises at most one OPEN flag per
   * rule+subject so repeated activity doesn't spam the queue. Never throws — a
   * detection hiccup must not block the player's request; the flag (if raised)
   * blocks the redemption at approval via assertNoOpenAml.
   */
  async screenRedemption(playerId: string, amountMinor: bigint): Promise<void> {
    if (amountMinor >= LARGE_REDEMPTION_MINOR) {
      await this.raiseIfAbsent(
        playerId,
        "LARGE_REDEMPTION",
        amountMinor >= HIGH_REDEMPTION_MINOR ? "HIGH" : "MEDIUM",
        { amountMinor: amountMinor.toString() },
      );
    }
    const since = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const recent = await this.prisma.redemptionRequest.count({
      where: { playerId, createdAt: { gte: since } },
    });
    if (recent >= VELOCITY_COUNT) {
      await this.raiseIfAbsent(playerId, "RAPID_REDEMPTIONS", "MEDIUM", {
        recentCount: recent,
        windowMinutes: VELOCITY_WINDOW_MS / 60_000,
      });
    }
  }

  /** Raise a flag only if no open one already exists for this subject+rule (no spam). */
  private async raiseIfAbsent(
    subjectId: string,
    ruleCode: string,
    severity: AmlSeverity,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    const open = await this.prisma.amlFlag.findFirst({
      where: { subjectType: "PLAYER", subjectId, ruleCode, status: { in: ["OPEN", "ESCALATED", "REVIEWING"] } },
      select: { id: true },
    });
    if (open) return;
    await this.createFlag({ subjectType: "PLAYER", subjectId, ruleCode, severity, details });
  }

  /** Operator-initiated manual flag (subtree-checked + audited). */
  async raiseManual(caller: OperatorPrincipal, input: CreateAmlFlagInput, ctx: ActionContext) {
    await this.assertSubjectInSubtree(caller, input.subjectId, input.subjectType);
    const flag = await this.createFlag(input);
    await this.audit.record({
      ...auditActor(caller),
      action: "aml.raise",
      targetType: "AmlFlag",
      targetId: flag.id,
      after: { subjectId: input.subjectId, ruleCode: input.ruleCode, severity: input.severity },
      ...ctx,
    });
    return flag;
  }

  /**
   * Raise an AML flag and emit it to the admin room in the same transaction
   * (outbox). Called by detection rules elsewhere; not a public HTTP surface.
   */
  async createFlag(input: CreateAmlFlagInput) {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.amlFlag.create({
        data: {
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          ruleCode: input.ruleCode,
          severity: input.severity,
          details: input.details,
        },
      });
      await tx.outboxEvent.create({
        data: {
          type: "aml.flagged",
          payload: { flagId: flag.id, severity: flag.severity, subjectId: flag.subjectId },
          rooms: ["admin:global"],
        },
      });
      return flag;
    });
  }

  /**
   * The flag's subject (a player or operator) must live inside the caller's
   * subtree. AmlFlag carries no path, so we resolve the subject and compare. For
   * a known subjectType we look it up directly; otherwise we try player then
   * operator. (A subtree-wide unfiltered listing would require denormalizing the
   * owning operator path onto AmlFlag; the subjectId + resolve paths — the
   * reachable action vectors — are scoped here.)
   */
  private async assertSubjectInSubtree(
    caller: OperatorPrincipal,
    subjectId: string,
    subjectType?: string,
  ): Promise<void> {
    if (subjectType !== "OPERATOR") {
      const player = await this.prisma.player.findUnique({
        where: { id: subjectId },
        select: { operator: { select: { path: true } } },
      });
      if (player) {
        if (!isInSubtree(caller.path, player.operator.path)) throw new OutOfScopeError();
        return;
      }
      if (subjectType === "PLAYER") throw new NotFoundError("AML subject not found");
    }
    const operator = await this.prisma.operator.findUnique({
      where: { id: subjectId },
      select: { path: true },
    });
    if (!operator) throw new NotFoundError("AML subject not found");
    if (!isInSubtree(caller.path, operator.path)) throw new OutOfScopeError();
  }
}
