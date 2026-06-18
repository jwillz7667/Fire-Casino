import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import {
  type Env,
  isInSubtree,
  type KycDecisionInput,
  type KycQueueQuery,
  type KycSubmitInput,
  type PresignKycDocInput,
} from "@aureus/shared";
import { type OperatorPrincipal, type Principal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/**
 * KYC submission and review (docs/05 §8). KycRecord is keyed 1:1 to a player and
 * is NOT in the scoped Prisma client, so subtree enforcement is explicit here
 * (defense in depth alongside the controller's @ScopeCheck): every operator
 * action loads the player and asserts its owning operator lives in the caller's
 * subtree; a player may only act on their own record. The KYC provider itself is
 * a stub (docs/01 §8) — verification is an operator decision.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Player self-submit or agent-on-behalf: record the document and move to PENDING. */
  async submit(actor: Principal, playerId: string, input: KycSubmitInput, ctx: ActionContext) {
    await this.assertActorScope(actor, playerId);
    const record = await this.prisma.kycRecord.upsert({
      where: { playerId },
      update: {
        status: "PENDING",
        idType: input.idType,
        documentUrl: input.documentUrl,
        level: input.level,
        provider: this.env.KYC_PROVIDER,
        verifiedAt: null,
        rejectedReason: null,
      },
      create: {
        playerId,
        status: "PENDING",
        idType: input.idType,
        documentUrl: input.documentUrl,
        level: input.level,
        provider: this.env.KYC_PROVIDER,
      },
    });
    await this.audit.record({
      ...auditActor(actor),
      action: "kyc.submit",
      targetType: "KycRecord",
      targetId: record.id,
      after: { status: "PENDING", idType: input.idType, level: input.level },
      ...ctx,
    });
    return record;
  }

  /** Operator decision: verify (stamp verifiedAt) or reject (store the reason). */
  async decision(caller: OperatorPrincipal, playerId: string, input: KycDecisionInput, ctx: ActionContext) {
    await this.assertPlayerInSubtree(caller, playerId);
    const existing = await this.prisma.kycRecord.findUnique({ where: { playerId } });
    if (!existing) throw new NotFoundError("No KYC record to decide on");
    const verified = input.decision === "VERIFIED";
    const record = await this.prisma.kycRecord.update({
      where: { playerId },
      data: verified
        ? {
            status: "VERIFIED",
            verifiedAt: new Date(),
            rejectedReason: null,
            level: input.level ?? existing.level,
          }
        : { status: "REJECTED", rejectedReason: input.reason ?? "Rejected", verifiedAt: null },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "kyc.decision",
      targetType: "KycRecord",
      targetId: record.id,
      before: { status: existing.status },
      after: { status: record.status, level: record.level },
      ...ctx,
    });
    return record;
  }

  /** Pending KYC queue scoped to the caller's subtree (explicit path filter). */
  async queue(caller: OperatorPrincipal, query: KycQueueQuery) {
    const items = await this.prisma.kycRecord.findMany({
      where: {
        status: "PENDING",
        player: {
          operator: {
            OR: [{ path: caller.path }, { path: { startsWith: `${caller.path}.` } }],
          },
        },
      },
      include: { player: { select: { username: true, operatorId: true } } },
      orderBy: { createdAt: "asc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    return {
      items: page.map((r) => ({
        id: r.id,
        playerId: r.playerId,
        playerUsername: r.player.username,
        operatorId: r.player.operatorId,
        status: r.status,
        level: r.level,
        idType: r.idType,
        documentUrl: r.documentUrl,
        createdAt: r.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  /** Presign a private upload URL for a KYC document (R2 `kyc` bucket). */
  async presignDoc(actor: Principal, playerId: string, input: PresignKycDocInput) {
    await this.assertActorScope(actor, playerId);
    return this.storage.presignUpload("kyc", `players/${playerId}`, input.filename);
  }

  /**
   * Time-limited signed read of a player's KYC document for a privileged
   * reviewer (docs/05 §8). The key is recovered from the stored URL and must
   * resolve to this player's own folder in our `kyc` bucket — so a tampered
   * documentUrl can never presign someone else's object. Audited as a view.
   */
  async previewDocument(caller: OperatorPrincipal, playerId: string, ctx: ActionContext) {
    await this.assertPlayerInSubtree(caller, playerId);
    const record = await this.prisma.kycRecord.findUnique({ where: { playerId } });
    if (!record?.documentUrl) throw new NotFoundError("No KYC document on file");
    const key = this.storage.keyFromFileUrl("kyc", record.documentUrl);
    if (!key || !key.startsWith(`players/${playerId}/`)) {
      throw new NotFoundError("KYC document is not available for preview");
    }
    const url = this.storage.presignDownload("kyc", key);
    await this.audit.record({
      ...auditActor(caller),
      action: "kyc.document_view",
      targetType: "KycRecord",
      targetId: record.id,
      ...ctx,
    });
    return { url, expiresInSeconds: 300 };
  }

  // ---- internals -------------------------------------------------------------

  private async assertActorScope(actor: Principal, playerId: string): Promise<void> {
    if (actor.kind === "player") {
      if (actor.playerId !== playerId) throw new OutOfScopeError();
      return;
    }
    await this.assertPlayerInSubtree(actor, playerId);
  }

  private async assertPlayerInSubtree(caller: OperatorPrincipal, playerId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { operator: { select: { path: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    if (!isInSubtree(caller.path, player.operator.path)) throw new OutOfScopeError();
  }
}
