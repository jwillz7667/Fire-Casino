import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { verify } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "./bootstrap-admin-service";

const credentials = {
  BOOTSTRAP_ADMIN_USERNAME: "initial_admin",
  BOOTSTRAP_ADMIN_EMAIL: "owner@example.com",
  BOOTSTRAP_ADMIN_PASSWORD: "LocalOnly!Random42-Admin79",
};

describe("Administrator bootstrap configuration", () => {
  it.each([
    {},
    { ...credentials, BOOTSTRAP_ADMIN_EMAIL: "invalid" },
    { ...credentials, BOOTSTRAP_ADMIN_USERNAME: "bad name" },
    { ...credentials, BOOTSTRAP_ADMIN_PASSWORD: "ChangeMe!Dev123" },
    { ...credentials, BOOTSTRAP_ADMIN_PASSWORD: "a".repeat(30) },
  ])("rejects missing or weak credentials before touching the database", async (environment) => {
    await expect(bootstrapAdmin({} as PrismaClient, environment)).rejects.toThrow(
      "Set BOOTSTRAP_ADMIN_USERNAME",
    );
  });

  it("refuses the demo seed in production even with a custom password", () => {
    const requireFromPackage = createRequire(resolve("package.json"));
    const result = spawnSync(
      process.execPath,
      [requireFromPackage.resolve("tsx/cli"), "prisma/seed.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://unused.invalid/bootstrap_test",
          SEED_PASSWORD: credentials.BOOTSTRAP_ADMIN_PASSWORD,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing demo db:seed in production");
    expect(result.stdout + result.stderr).not.toContain(credentials.BOOTSTRAP_ADMIN_PASSWORD);
  });
});

const testUrl = process.env.BOOTSTRAP_TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !parsed.pathname.endsWith("_bootstrap_test")
  ) {
    throw new Error(
      "Bootstrap integration tests require a dedicated local *_bootstrap_test database.",
    );
  }
}
const prisma = testUrl ? new PrismaClient({ datasourceUrl: testUrl }) : undefined;

describe.runIf(prisma)("Administrator bootstrap database atomicity", () => {
  const database = prisma!;
  beforeEach(async () => {
    await database.$executeRawUnsafe(
      "TRUNCATE TABLE audit_logs, ledger_accounts, operators, users, platform_settings RESTART IDENTITY CASCADE",
    );
  });
  afterAll(async () => database?.$disconnect());

  it("creates exactly one hashed-password admin, zero wallet and audit without demo data or settings writes", async () => {
    await database.platformSetting.create({ data: { key: "PLATFORM_MODE", value: "COMPLIANCE" } });
    const result = await bootstrapAdmin(database, credentials);
    const operator = await database.operator.findUniqueOrThrow({
      where: { id: result.operatorId },
      include: { user: true, ledgerAccounts: true },
    });
    expect(operator).toMatchObject({ tier: "SUPER_ADMIN", path: "0", depth: 0, parentId: null });
    expect(operator.user).toMatchObject({
      id: result.userId,
      username: credentials.BOOTSTRAP_ADMIN_USERNAME,
      email: credentials.BOOTSTRAP_ADMIN_EMAIL,
      mfaEnabled: false,
    });
    expect(await verify(operator.user.passwordHash, credentials.BOOTSTRAP_ADMIN_PASSWORD)).toBe(
      true,
    );
    expect(operator.ledgerAccounts).toHaveLength(1);
    expect(operator.ledgerAccounts[0]).toMatchObject({
      currency: "CREDIT",
      balanceMinor: 0n,
      version: 0,
    });
    expect(await database.user.count()).toBe(1);
    expect(await database.operator.count()).toBe(1);
    expect(await database.player.count()).toBe(0);
    expect(await database.ledgerTransaction.count()).toBe(0);
    expect(
      await database.platformSetting.findUnique({ where: { key: "PLATFORM_MODE" } }),
    ).toMatchObject({ value: "COMPLIANCE" });
    const audit = await database.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "platform.bootstrap_admin", targetId: operator.id });
    expect(JSON.stringify(audit)).not.toContain(credentials.BOOTSTRAP_ADMIN_PASSWORD);
    await expect(bootstrapAdmin(database, credentials)).rejects.toThrow(
      "database already has users or operators",
    );
    expect(await database.auditLog.count()).toBe(1);
  });

  it("refuses existing orphan users without changing any account", async () => {
    await database.user.create({ data: { username: "existing", passwordHash: "existing-hash" } });
    await expect(bootstrapAdmin(database, credentials)).rejects.toThrow(
      "database already has users or operators",
    );
    expect(await database.operator.count()).toBe(0);
    expect(await database.auditLog.count()).toBe(0);
    expect((await database.user.findFirstOrThrow()).passwordHash).toBe("existing-hash");
  });

  it("serializes concurrent initializers so only one succeeds", async () => {
    const results = await Promise.allSettled([
      bootstrapAdmin(database, credentials),
      bootstrapAdmin(database, {
        ...credentials,
        BOOTSTRAP_ADMIN_USERNAME: "second_admin",
        BOOTSTRAP_ADMIN_EMAIL: "second@example.com",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await database.user.count()).toBe(1);
    expect(await database.operator.count()).toBe(1);
    expect(await database.auditLog.count()).toBe(1);
  });

  it("runs the production CLI without logging credentials and refuses a second run", async () => {
    const requireFromPackage = createRequire(resolve("package.json"));
    const run = () =>
      spawnSync(
        process.execPath,
        [requireFromPackage.resolve("tsx/cli"), "prisma/bootstrap-admin.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, ...credentials, NODE_ENV: "production", DATABASE_URL: testUrl },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
    const created = run();
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Administrator created");
    const refused = run();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("database already has users or operators");
    for (const value of Object.values(credentials)) {
      expect(created.stdout + created.stderr + refused.stdout + refused.stderr).not.toContain(
        value,
      );
    }
    expect(await database.user.count()).toBe(1);
    expect(await database.auditLog.count()).toBe(1);
  });

  it("rolls back the user, operator and wallet if the audit insert fails", async () => {
    await database.$executeRawUnsafe(`CREATE FUNCTION bootstrap_test_reject_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test audit failure'; END; $$ LANGUAGE plpgsql`);
    await database.$executeRawUnsafe(`CREATE TRIGGER bootstrap_test_audit_failure BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION bootstrap_test_reject_audit()`);
    try {
      await expect(bootstrapAdmin(database, credentials)).rejects.toThrow("test audit failure");
      expect(await database.user.count()).toBe(0);
      expect(await database.operator.count()).toBe(0);
      expect(await database.ledgerAccount.count()).toBe(0);
    } finally {
      await database.$executeRawUnsafe("DROP TRIGGER bootstrap_test_audit_failure ON audit_logs");
      await database.$executeRawUnsafe("DROP FUNCTION bootstrap_test_reject_audit()");
    }
  });
});
