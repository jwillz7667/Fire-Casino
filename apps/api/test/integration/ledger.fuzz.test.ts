import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Currency } from "@aureus/shared";
import { LedgerService } from "../../src/ledger/ledger.service";
import { type AccountSelector } from "../../src/ledger/ledger.types";
import { createOperator, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity } from "../helpers/ledger";

const ledger = new LedgerService(testPrisma);
const CURRENCY: Currency = "CREDIT";
const mint: AccountSelector = { kind: "system", systemKey: "MINT", currency: CURRENCY };
const op = (id: string): AccountSelector => ({ kind: "operator", operatorId: id, currency: CURRENCY });

let pool: string[] = [];

beforeAll(async () => {
  await resetDb();
  pool = [];
  for (let i = 0; i < 4; i++) {
    const node = await createOperator({ username: `fuzz-${String(i)}`, tier: "DISTRIBUTOR", pathSegment: i });
    pool.push(node.operatorId);
  }
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

interface Command {
  kind: "issue" | "transfer";
  from: number;
  to: number;
  amount: bigint;
}

const commandArb: fc.Arbitrary<Command> = fc.record({
  kind: fc.constantFrom<"issue" | "transfer">("issue", "transfer"),
  from: fc.nat(3),
  to: fc.nat(3),
  amount: fc.bigInt(1n, 100_000n),
});

async function execute(cmd: Command): Promise<void> {
  if (cmd.kind === "issue") {
    await ledger.post({
      type: "ISSUE",
      currency: CURRENCY,
      idempotencyKey: `fuzz:${randomUUID()}`,
      allowNegative: ["MINT"],
      legs: [
        { account: mint, direction: "DEBIT", amountMinor: cmd.amount },
        { account: op(pool[cmd.to] ?? pool[0]!), direction: "CREDIT", amountMinor: cmd.amount },
      ],
    });
    return;
  }
  const fromId = pool[cmd.from] ?? pool[0]!;
  const toId = pool[cmd.to] ?? pool[1]!;
  if (fromId === toId) return;
  const available = await ledger.getBalance(op(fromId));
  if (available <= 0n) return;
  const amount = cmd.amount > available ? available : cmd.amount;
  await ledger.post({
    type: "TRANSFER",
    currency: CURRENCY,
    idempotencyKey: `fuzz:${randomUUID()}`,
    legs: [
      { account: op(fromId), direction: "DEBIT", amountMinor: amount },
      { account: op(toId), direction: "CREDIT", amountMinor: amount },
    ],
  });
}

describe("LedgerService — zero-sum fuzz (docs/03 §7)", () => {
  it("preserves zero-sum and cache=derived across randomized sequences", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(commandArb, { minLength: 1, maxLength: 14 }), async (commands) => {
        for (const cmd of commands) await execute(cmd);
        await assertLedgerIntegrity(testPrisma);
        for (const id of pool) {
          const balance = await ledger.getBalance(op(id));
          expect(balance >= 0n).toBe(true); // operator accounts never go negative
        }
      }),
      { numRuns: 12 },
    );
  });
});
