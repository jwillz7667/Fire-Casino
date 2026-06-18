import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../../src/audit/audit.service";
import { resetDb, testPrisma } from "../helpers/db";

const audit = new AuditService(testPrisma);

afterAll(async () => {
  await testPrisma.$disconnect();
});

/**
 * Hard rule #5 — the audit log is append-only. These tests pin both halves of
 * the guarantee: records are written for privileged actions, and the service
 * surface exposes no mutation/deletion path (the only way a row could change).
 */
describe("AuditService — append-only audit log (hard rule #5)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("records a privileged action with its actor and target", async () => {
    await audit.record({
      actorType: "USER",
      actorId: "user-1",
      action: "operator.create",
      targetType: "Operator",
      targetId: "op-1",
      after: { tier: "STORE" },
      ip: "127.0.0.1",
    });

    const rows = await testPrisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: "USER",
      actorId: "user-1",
      action: "operator.create",
      targetType: "Operator",
      targetId: "op-1",
    });
  });

  it("only ever appends — successive records never overwrite", async () => {
    await audit.record({ actorType: "USER", actorId: "u", action: "a.one" });
    await audit.record({ actorType: "USER", actorId: "u", action: "a.two" });
    await audit.record({ actorType: "PLAYER", actorId: "p", action: "a.three" });

    const rows = await testPrisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["a.one", "a.two", "a.three"]);
  });

  it("the database rejects UPDATE and DELETE on audit_logs (append-only trigger, D1)", async () => {
    await audit.record({ actorType: "USER", actorId: "u", action: "a.locked", targetType: "X", targetId: "1" });

    await expect(
      testPrisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/i);
    await expect(testPrisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/i);

    const rows = await testPrisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("a.locked");
  });

  it("exposes no update or delete path on the service surface", () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(audit)).filter(
      (m) => m !== "constructor",
    );
    // The only public operation is record(); there is deliberately no update/
    // remove/delete method anywhere on the audit service.
    expect(methods).toEqual(["record"]);
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });
});
