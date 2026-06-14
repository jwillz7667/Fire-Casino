import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { ForbiddenError, NotFoundError, SelfExcludedError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";

/**
 * Compliance hooks (hard rule #7). The checks are real and enforced at the right
 * decision points; the deeper rules (responsible-gaming limits, KYC thresholds,
 * geo provider, AML) are layered in during Phase 9 behind these same methods.
 * Today they enforce account status and self-exclusion, which are always on.
 */
@Injectable()
export class ComplianceService {
  constructor(@Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient) {}

  /** Gate before a recharge/deposit (docs/03 §4.3). */
  async checkDeposit(playerId: string): Promise<void> {
    await this.assertPlayerActionable(playerId);
  }

  /** Gate before a game round (docs/03 §4.4). */
  async checkPlay(playerId: string): Promise<void> {
    await this.assertPlayerActionable(playerId);
  }

  /** Shared: the player exists, is ACTIVE, and is not under an active self-exclusion. */
  async assertPlayerActionable(playerId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { status: true, selfExclusion: { select: { until: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    if (player.status === "SELF_EXCLUDED") throw new SelfExcludedError();
    if (player.status !== "ACTIVE") throw new ForbiddenError("Player account is not active");

    const exclusion = player.selfExclusion;
    if (exclusion && (exclusion.until === null || exclusion.until.getTime() > Date.now())) {
      throw new SelfExcludedError();
    }
  }
}
