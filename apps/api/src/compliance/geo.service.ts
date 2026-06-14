import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { type UpsertGeoRuleInput } from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { NotFoundError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Geo allow/deny rules (docs/05 §8). GeoRule rows are the source the compliance
 * gate reads for region enforcement; this service is the write surface. Regions
 * are stored upper-cased so the unique key and the gate's lookup agree. Uses the
 * system client — GeoRule is platform-global, not subtree-scoped.
 */
@Injectable()
export class GeoService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.geoRule.findMany({ orderBy: { region: "asc" } });
  }

  async upsert(caller: OperatorPrincipal, input: UpsertGeoRuleInput, ctx: ActionContext) {
    const region = input.region.toUpperCase();
    const rule = await this.prisma.geoRule.upsert({
      where: { region },
      update: { action: input.action, reason: input.reason ?? null },
      create: { region, action: input.action, reason: input.reason ?? null },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "compliance.geo.upsert",
      targetType: "GeoRule",
      targetId: rule.id,
      after: { region, action: input.action, reason: input.reason ?? null },
      ...ctx,
    });
    return rule;
  }

  async remove(caller: OperatorPrincipal, region: string, ctx: ActionContext) {
    const key = region.toUpperCase();
    const existing = await this.prisma.geoRule.findUnique({ where: { region: key } });
    if (!existing) throw new NotFoundError("Geo rule not found");
    await this.prisma.geoRule.delete({ where: { region: key } });
    await this.audit.record({
      ...auditActor(caller),
      action: "compliance.geo.remove",
      targetType: "GeoRule",
      targetId: existing.id,
      before: { region: key, action: existing.action },
      ...ctx,
    });
    return { region: key, removed: true };
  }
}
