import { Inject, Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@aureus/db";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { type Principal } from "../common/auth/principal";

export interface AuditInput {
  actorType: "USER" | "PLAYER" | "SYSTEM";
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

/** Map a principal to its audit actor identity. */
export function auditActor(principal: Principal): { actorType: "USER" | "PLAYER"; actorId: string } {
  return principal.kind === "operator"
    ? { actorType: "USER", actorId: principal.userId }
    : { actorType: "PLAYER", actorId: principal.playerId };
}

/**
 * Append-only audit log writer (hard rule #5). Exposes only record(); there is
 * no update or delete code path for AuditLog anywhere, including super admin.
 * Pass a transaction client to write the audit row atomically with the action.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient) {}

  async record(
    input: AuditInput,
    client: Pick<PrismaClient, "auditLog"> = this.prisma,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  }
}
