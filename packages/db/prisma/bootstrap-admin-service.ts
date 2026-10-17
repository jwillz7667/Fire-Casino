import { hash } from "@node-rs/argon2";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const bootstrapSchema = z.object({
  BOOTSTRAP_ADMIN_USERNAME: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[A-Za-z0-9_.-]+$/),
  BOOTSTRAP_ADMIN_EMAIL: z
    .string()
    .trim()
    .email()
    .max(160)
    .transform((value) => value.toLowerCase()),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .min(20)
    .max(128)
    .refine(
      (value) => new Set(value).size >= 10,
      "Use a unique randomly generated password with at least ten distinct characters",
    ),
});

export class BootstrapAdminError extends Error {}

/** Creates one initial administrator; never updates existing accounts or settings. */
export async function bootstrapAdmin(
  prisma: PrismaClient,
  environment: Record<string, string | undefined>,
): Promise<{ operatorId: string; userId: string }> {
  const parsed = bootstrapSchema.safeParse(environment);
  if (!parsed.success) {
    // Never render raw env, Prisma arguments, or validation input in logs.
    throw new BootstrapAdminError(
      "Set BOOTSTRAP_ADMIN_USERNAME, a valid BOOTSTRAP_ADMIN_EMAIL, and a random BOOTSTRAP_ADMIN_PASSWORD (20–128 characters, at least ten distinct characters).",
    );
  }
  const input = parsed.data;
  const passwordHash = await hash(input.BOOTSTRAP_ADMIN_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  return prisma.$transaction(
    async (tx) => {
      // Serialize initializers and prevent account creation between the empty
      // database check and insert, including writers outside this command.
      await tx.$executeRaw`LOCK TABLE "users", "operators" IN SHARE ROW EXCLUSIVE MODE`;
      const users = await tx.user.count();
      const operators = await tx.operator.count();
      if (users !== 0 || operators !== 0) {
        throw new BootstrapAdminError(
          "Refusing bootstrap: the database already has users or operators.",
        );
      }

      const operator = await tx.operator.create({
        data: {
          tier: "SUPER_ADMIN",
          displayName: "Platform Administrator",
          pathSegment: 0,
          path: "0",
          depth: 0,
          user: {
            create: {
              username: input.BOOTSTRAP_ADMIN_USERNAME,
              email: input.BOOTSTRAP_ADMIN_EMAIL,
              passwordHash,
            },
          },
          ledgerAccounts: {
            create: { ownerType: "OPERATOR", currency: "CREDIT", balanceMinor: 0n },
          },
        },
        select: { id: true, userId: true },
      });
      await tx.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "platform.bootstrap_admin",
          targetType: "Operator",
          targetId: operator.id,
          after: { tier: "SUPER_ADMIN", username: input.BOOTSTRAP_ADMIN_USERNAME },
        },
      });
      return { operatorId: operator.id, userId: operator.userId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
  );
}
