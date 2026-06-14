import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import {
  type Env,
  type UpdateNodeSettingsInput,
  type UpdatePlatformSettingsInput,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { NotFoundError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Platform + per-node settings (docs/05 §9, docs/06 §3.14). Platform rows live in
 * the PlatformSetting table; the boot env is the default until an admin overrides
 * a key. CREDIT_MINOR_UNITS is intentionally absent from the update schema — the
 * money scale is fixed for the life of a deployment (docs/03 §8) — and is surfaced
 * read-only. Every change is audited; mode/critical-money changes are the kind the
 * console flags for a human decision. Writes use the system client (settings are
 * cross-tree); a node may only edit its own Operator row.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async getPlatform() {
    const rows = await this.prisma.platformSetting.findMany();
    const valueByKey = new Map(rows.map((r) => [r.key, r.value]));
    const updatedAtByKey = new Map(rows.map((r) => [r.key, r.updatedAt]));
    const defaults = this.platformDefaults();

    const setting = (key: string, readOnly: boolean) => ({
      key,
      value: valueByKey.has(key) ? valueByKey.get(key) : defaults[key],
      readOnly,
      updatedAt: updatedAtByKey.get(key) ?? null,
    });

    return {
      mode: valueByKey.get("PLATFORM_MODE") ?? this.env.PLATFORM_MODE,
      settings: [
        setting("PLATFORM_MODE", false),
        setting("CREDIT_MINOR_UNITS", true),
        setting("REDEMPTION_KYC_THRESHOLD_MINOR", false),
        setting("DEFAULT_GAME_RTP_BPS", false),
        setting("KYC_ENFORCED", false),
        setting("GEO_ENFORCED", false),
      ],
    };
  }

  async updatePlatform(caller: OperatorPrincipal, input: UpdatePlatformSettingsInput, ctx: ActionContext) {
    const changed: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      changed[key] = value;
    }
    const keys = Object.keys(changed);

    const existing = await this.prisma.platformSetting.findMany({ where: { key: { in: keys } } });
    const defaults = this.platformDefaults();
    const before: Record<string, unknown> = {};
    for (const key of keys) {
      const row = existing.find((e) => e.key === key);
      before[key] = row ? row.value : (defaults[key] ?? null);
    }

    for (const [key, value] of Object.entries(changed)) {
      await this.prisma.platformSetting.upsert({
        where: { key },
        update: { value, updatedBy: caller.userId },
        create: { key, value, updatedBy: caller.userId },
      });
    }

    await this.audit.record({
      ...auditActor(caller),
      action: "settings.platform.update",
      targetType: "PlatformSetting",
      before: before as Prisma.InputJsonValue,
      after: changed,
      ...ctx,
    });
    return this.getPlatform();
  }

  async getNode(caller: OperatorPrincipal) {
    const op = await this.prisma.operator.findUnique({
      where: { id: caller.operatorId },
      select: { id: true, displayName: true, tier: true, buyUnitPriceCents: true, sellUnitPriceCents: true, settings: true },
    });
    if (!op) throw new NotFoundError("Operator not found");
    const settings = asObject(op.settings);
    return {
      id: op.id,
      displayName: op.displayName,
      tier: op.tier,
      buyUnitPriceCents: op.buyUnitPriceCents,
      sellUnitPriceCents: op.sellUnitPriceCents,
      prizeBonusBps: typeof settings.prizeBonusBps === "number" ? settings.prizeBonusBps : null,
      redemptionApproval: settings.redemptionApproval ?? null,
    };
  }

  async updateNode(caller: OperatorPrincipal, input: UpdateNodeSettingsInput, ctx: ActionContext) {
    const current = await this.prisma.operator.findUnique({
      where: { id: caller.operatorId },
      select: { settings: true },
    });
    if (!current) throw new NotFoundError("Operator not found");

    const data: Prisma.OperatorUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.buyUnitPriceCents !== undefined) data.buyUnitPriceCents = input.buyUnitPriceCents;
    if (input.sellUnitPriceCents !== undefined) data.sellUnitPriceCents = input.sellUnitPriceCents;
    if (input.prizeBonusBps !== undefined || input.redemptionApproval !== undefined) {
      data.settings = mergeNodeSettings(current.settings, input);
    }

    const updated = await this.prisma.operator.update({
      where: { id: caller.operatorId },
      data,
      select: { id: true, displayName: true, tier: true, buyUnitPriceCents: true, sellUnitPriceCents: true, settings: true },
    });

    const after: Record<string, unknown> = { ...input };
    if (input.redemptionApproval?.thresholdMinor !== undefined) {
      after.redemptionApproval = {
        ...input.redemptionApproval,
        thresholdMinor: input.redemptionApproval.thresholdMinor.toString(),
      };
    }
    await this.audit.record({
      ...auditActor(caller),
      action: "settings.node.update",
      targetType: "Operator",
      targetId: caller.operatorId,
      after: after as Prisma.InputJsonValue,
      ...ctx,
    });
    return updated;
  }

  private platformDefaults(): Record<string, string | number | boolean> {
    return {
      PLATFORM_MODE: this.env.PLATFORM_MODE,
      CREDIT_MINOR_UNITS: this.env.CREDIT_MINOR_UNITS,
      REDEMPTION_KYC_THRESHOLD_MINOR: this.env.REDEMPTION_KYC_THRESHOLD_MINOR,
      DEFAULT_GAME_RTP_BPS: this.env.DEFAULT_GAME_RTP_BPS,
      KYC_ENFORCED: true,
      GEO_ENFORCED: true,
    };
  }
}

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Merge prizeBonusBps / redemptionApproval into the node's settings JSON (thresholdMinor as string). */
function mergeNodeSettings(current: Prisma.JsonValue | null, input: UpdateNodeSettingsInput): Prisma.InputJsonObject {
  const base = asObject(current);
  if (input.prizeBonusBps !== undefined) base.prizeBonusBps = input.prizeBonusBps;
  if (input.redemptionApproval !== undefined) {
    const ra = input.redemptionApproval;
    const approval: Record<string, unknown> = { funding: ra.funding };
    if (ra.thresholdMinor !== undefined) {
      approval.thresholdMinor = typeof ra.thresholdMinor === "bigint" ? ra.thresholdMinor.toString() : ra.thresholdMinor;
    }
    if (ra.approverTier !== undefined) approval.approverTier = ra.approverTier;
    base.redemptionApproval = approval;
  }
  return base as Prisma.InputJsonObject;
}
