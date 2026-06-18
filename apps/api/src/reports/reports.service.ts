import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, type ScopedPrismaClient } from "@aureus/db";
import {
  type CreditFlowQuery,
  type Env,
  type ExportReportInput,
  isInSubtree,
  operatorCurrency,
  type ReportRangeQuery,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA, PRISMA_SYSTEM } from "../prisma/prisma.module";
import { ReconciliationService } from "../reconciliation/reconciliation.service";

export interface RevenueReport {
  currency: string;
  betsMinor: string;
  winsMinor: string;
  revenueMinor: string;
  platformRevenueMinor?: string;
}

/**
 * Scoped reporting aggregates (docs/05 §9, docs/06 §3.9). Every figure is for the
 * caller's subtree only: list/balance reads go through the scoped Prisma client
 * (which injects the subtree path filter), while ledger-entry/order/settlement
 * aggregates — whose models are not auto-scoped — carry an explicit
 * operator/player path predicate. Money stays integer-minor as strings; the
 * off-platform cash view (margin/settlement) is in cents.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ScopedPrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /** Dashboard KPIs (docs/06 §3.1), with mint/revenue/reconciliation extras for admins. */
  async overview(caller: OperatorPrincipal) {
    const currency = operatorCurrency(this.env.PLATFORM_MODE);
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const subtree = this.subtreeOp(caller.path);

    const [circulation, activePlayers, recharges, pendingRedeem, inbox, outbox] = await Promise.all([
      this.prisma.ledgerAccount.aggregate({
        where: { currency, ownerType: { in: ["OPERATOR", "PLAYER"] } },
        _sum: { balanceMinor: true },
      }),
      this.prisma.player.count({ where: { status: "ACTIVE" } }),
      this.system.ledgerEntry.aggregate({
        where: {
          direction: "CREDIT",
          transaction: { type: "RECHARGE" },
          account: { ownerType: "PLAYER", player: { operator: subtree } },
          createdAt: { gte: startOfDay },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.redemptionRequest.aggregate({
        where: { status: "PENDING" },
        _count: true,
        _sum: { amountMinor: true },
      }),
      this.system.creditOrder.count({
        where: { sellerOperatorId: caller.operatorId, status: { in: ["REQUESTED", "AWAITING_PAYMENT", "PAID"] } },
      }),
      this.system.creditOrder.count({
        where: { buyerOperatorId: caller.operatorId, status: { in: ["REQUESTED", "AWAITING_PAYMENT", "PAID"] } },
      }),
    ]);

    const base = {
      currency,
      creditsInCirculationMinor: (circulation._sum.balanceMinor ?? 0n).toString(),
      activePlayers,
      netRechargesTodayMinor: (recharges._sum.amountMinor ?? 0n).toString(),
      pendingRedemptions: {
        count: pendingRedeem._count,
        totalMinor: (pendingRedeem._sum.amountMinor ?? 0n).toString(),
      },
      pendingOrders: { inbox, outbox },
    };

    if (caller.tier !== "SUPER_ADMIN" && caller.tier !== "ADMIN") return base;

    const [mint, revenue, recon] = await Promise.all([
      this.system.ledgerAccount.findFirst({
        where: { ownerType: "SYSTEM", systemKey: "MINT", currency },
        select: { balanceMinor: true },
      }),
      this.system.ledgerAccount.findFirst({
        where: { ownerType: "SYSTEM", systemKey: "REVENUE", currency },
        select: { balanceMinor: true },
      }),
      this.reconciliation.runAll(),
    ]);
    return {
      ...base,
      totalMintedMinor: (-(mint?.balanceMinor ?? 0n)).toString(),
      revenueMinor: (revenue?.balanceMinor ?? 0n).toString(),
      reconciliation: {
        ok: recon.checks.every((c) => c.ok),
        checks: recon.checks.map((c) => ({ name: c.name, ok: c.ok })),
      },
    };
  }

  /** Issued / transferred / recharged / redeemed bucketed by day|week|month (docs/06 §3.9). */
  async creditFlow(caller: OperatorPrincipal, query: CreditFlowQuery) {
    const path = await this.scopedPath(caller, query.operatorId);
    const pathPrefix = `${path}.%`;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const currency = operatorCurrency(this.env.PLATFORM_MODE);

    const rows = await this.system.$queryRaw<
      { bucket: Date; issued: bigint; transferred: bigint; recharged: bigint; redeemed: bigint }[]
    >(Prisma.sql`
      SELECT date_trunc(${query.granularity}, e."createdAt") AS bucket,
        COALESCE(SUM(CASE WHEN t.type = 'ISSUE' AND e.direction = 'CREDIT' THEN e."amountMinor" ELSE 0 END), 0)::bigint AS issued,
        COALESCE(SUM(CASE WHEN t.type = 'TRANSFER' AND e.direction = 'CREDIT' THEN e."amountMinor" ELSE 0 END), 0)::bigint AS transferred,
        COALESCE(SUM(CASE WHEN t.type = 'RECHARGE' AND e.direction = 'CREDIT' THEN e."amountMinor" ELSE 0 END), 0)::bigint AS recharged,
        COALESCE(SUM(CASE WHEN t.type = 'REDEEM_HOLD' AND e.direction = 'DEBIT' THEN e."amountMinor" ELSE 0 END), 0)::bigint AS redeemed
      FROM ledger_entries e
      JOIN ledger_transactions t ON t.id = e."transactionId"
      JOIN ledger_accounts a ON a.id = e."accountId"
      LEFT JOIN operators o ON o.id = a."operatorId"
      LEFT JOIN players pl ON pl.id = a."playerId"
      LEFT JOIN operators po ON po.id = pl."operatorId"
      WHERE a."ownerType" IN ('OPERATOR', 'PLAYER')
        AND e.currency::text = ${currency}
        AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        AND (
          (o.path = ${path} OR o.path LIKE ${pathPrefix})
          OR (po.path = ${path} OR po.path LIKE ${pathPrefix})
        )
      GROUP BY 1 ORDER BY 1`);

    return {
      currency,
      granularity: query.granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      buckets: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        issuedMinor: r.issued.toString(),
        transferredMinor: r.transferred.toString(),
        rechargedMinor: r.recharged.toString(),
        redeemedMinor: r.redeemed.toString(),
      })),
    };
  }

  /** Redemption pipeline counts + settlement totals by status (docs/06 §3.9). */
  async redemptionsReport(caller: OperatorPrincipal, query: ReportRangeQuery) {
    if (query.operatorId) await this.scopedPath(caller, query.operatorId);
    const createdAt = this.createdAtFilter(query);
    const where: Prisma.RedemptionRequestWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      ...(query.operatorId ? { player: { operatorId: query.operatorId } } : {}),
    };
    const grouped = await this.prisma.redemptionRequest.groupBy({
      by: ["status"],
      where,
      orderBy: { status: "asc" },
      _count: true,
      _sum: { amountMinor: true },
    });
    const byStatus = grouped.map((g) => ({
      status: g.status,
      count: g._count,
      totalMinor: (g._sum.amountMinor ?? 0n).toString(),
    }));
    const totalFor = (status: string): string =>
      (grouped.find((g) => g.status === status)?._sum.amountMinor ?? 0n).toString();
    return {
      byStatus,
      pendingMinor: totalFor("PENDING"),
      approvedMinor: totalFor("APPROVED"),
      settledMinor: totalFor("PAID"),
    };
  }

  /** Per-player recharge/redemption/net, top 100 by recharge in range (docs/06 §3.9). */
  async playerActivity(caller: OperatorPrincipal, query: ReportRangeQuery) {
    const path = await this.scopedPath(caller, query.operatorId);
    const pathPrefix = `${path}.%`;
    const from = query.from ? new Date(query.from) : new Date(0);
    const to = query.to ? new Date(query.to) : new Date();
    const opFilter = query.operatorId ? Prisma.sql`AND pl."operatorId" = ${query.operatorId}` : Prisma.empty;

    const rows = await this.system.$queryRaw<
      { playerId: string; username: string; operatorId: string; recharged: bigint; redeemed: bigint }[]
    >(Prisma.sql`
      SELECT pl.id AS "playerId", pl.username, pl."operatorId",
        COALESCE(rc.recharged, 0)::bigint AS recharged,
        COALESCE(rd.redeemed, 0)::bigint AS redeemed
      FROM players pl
      JOIN operators o ON o.id = pl."operatorId"
      LEFT JOIN (
        SELECT a."playerId", SUM(e."amountMinor") AS recharged
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e."transactionId"
        JOIN ledger_accounts a ON a.id = e."accountId"
        WHERE t.type = 'RECHARGE' AND e.direction = 'CREDIT' AND a."ownerType" = 'PLAYER'
          AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY a."playerId"
      ) rc ON rc."playerId" = pl.id
      LEFT JOIN (
        SELECT "playerId", SUM("amountMinor") AS redeemed
        FROM redemption_requests
        WHERE status = 'PAID' AND "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY "playerId"
      ) rd ON rd."playerId" = pl.id
      WHERE (o.path = ${path} OR o.path LIKE ${pathPrefix})
        ${opFilter}
      ORDER BY COALESCE(rc.recharged, 0) DESC
      LIMIT 100`);

    return {
      items: rows.map((r) => ({
        playerId: r.playerId,
        username: r.username,
        operatorId: r.operatorId,
        rechargedMinor: r.recharged.toString(),
        redeemedMinor: r.redeemed.toString(),
        netMinor: (r.recharged - r.redeemed).toString(),
      })),
    };
  }

  /**
   * Per-agent credit summary (docs/06 §3.9, R3): for every operator in the
   * caller's subtree, its current HOLDINGS (balance) plus the credits it has SOLD
   * to players (RECHARGE outflow) and REMOVED/burned from players (CREDIT_REMOVAL)
   * over the range. Only stores (agents) own players, so sold/removed are non-zero
   * only for agents; distributors still show their holdings. Holdings are the live
   * balance; sold/removed are range-bounded (default: all time).
   */
  async agentSales(caller: OperatorPrincipal, query: ReportRangeQuery) {
    const path = await this.scopedPath(caller, query.operatorId);
    const pathPrefix = `${path}.%`;
    const from = query.from ? new Date(query.from) : new Date(0);
    const to = query.to ? new Date(query.to) : new Date();
    const currency = operatorCurrency(this.env.PLATFORM_MODE);

    const rows = await this.system.$queryRaw<
      {
        operatorId: string;
        displayName: string;
        tier: string;
        holdings: bigint;
        sold: bigint;
        removed: bigint;
      }[]
    >(Prisma.sql`
      SELECT o.id AS "operatorId", o."displayName" AS "displayName", o.tier::text AS tier,
        COALESCE(bal."balanceMinor", 0)::bigint AS holdings,
        COALESCE(sold.sold, 0)::bigint AS sold,
        COALESCE(removed.removed, 0)::bigint AS removed
      FROM operators o
      LEFT JOIN ledger_accounts bal
        ON bal."operatorId" = o.id AND bal."ownerType" = 'OPERATOR' AND bal.currency::text = ${currency}
      LEFT JOIN (
        SELECT pl."operatorId" AS opid, SUM(e."amountMinor") AS sold
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e."transactionId"
        JOIN ledger_accounts a ON a.id = e."accountId"
        JOIN players pl ON pl.id = a."playerId"
        WHERE t.type = 'RECHARGE' AND e.direction = 'CREDIT' AND a."ownerType" = 'PLAYER'
          AND e.currency::text = ${currency}
          AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY pl."operatorId"
      ) sold ON sold.opid = o.id
      LEFT JOIN (
        SELECT pl."operatorId" AS opid, SUM(e."amountMinor") AS removed
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e."transactionId"
        JOIN ledger_accounts a ON a.id = e."accountId"
        JOIN players pl ON pl.id = a."playerId"
        WHERE t.type = 'CREDIT_REMOVAL' AND e.direction = 'DEBIT' AND a."ownerType" = 'PLAYER'
          AND e.currency::text = ${currency}
          AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY pl."operatorId"
      ) removed ON removed.opid = o.id
      WHERE (o.path = ${path} OR o.path LIKE ${pathPrefix})
      ORDER BY sold DESC NULLS LAST, o."displayName" ASC`);

    return {
      currency,
      items: rows.map((r) => ({
        operatorId: r.operatorId,
        displayName: r.displayName,
        tier: r.tier,
        holdingsMinor: r.holdings.toString(),
        soldToPlayersMinor: r.sold.toString(),
        removedFromPlayersMinor: r.removed.toString(),
        netToPlayersMinor: (r.sold - r.removed).toString(),
      })),
    };
  }

  /** House edge accrued from games in the subtree (docs/06 §3.9). Branch-scoped. */
  async revenue(caller: OperatorPrincipal, query: ReportRangeQuery): Promise<RevenueReport> {
    const path = await this.scopedPath(caller, query.operatorId);
    const createdAt = this.createdAtFilter(query);
    const currency = operatorCurrency(this.env.PLATFORM_MODE);
    const playerInSubtree: Prisma.LedgerAccountWhereInput = {
      ownerType: "PLAYER",
      player: { operator: this.subtreeOp(path) },
    };

    const [bets, wins] = await Promise.all([
      this.system.ledgerEntry.aggregate({
        where: { currency, direction: "DEBIT", transaction: { type: "GAME_BET" }, account: playerInSubtree, ...(createdAt ? { createdAt } : {}) },
        _sum: { amountMinor: true },
      }),
      this.system.ledgerEntry.aggregate({
        where: { currency, direction: "CREDIT", transaction: { type: "GAME_WIN" }, account: playerInSubtree, ...(createdAt ? { createdAt } : {}) },
        _sum: { amountMinor: true },
      }),
    ]);
    const betsMinor = bets._sum.amountMinor ?? 0n;
    const winsMinor = wins._sum.amountMinor ?? 0n;
    const report: RevenueReport = {
      currency,
      betsMinor: betsMinor.toString(),
      winsMinor: winsMinor.toString(),
      revenueMinor: (betsMinor - winsMinor).toString(),
    };
    // Only the super admin sees the platform-wide REVENUE account; branches see
    // their own derived house edge so a sub-distributor's revenue is its branch.
    if (caller.tier === "SUPER_ADMIN") {
      const account = await this.system.ledgerAccount.findFirst({
        where: { ownerType: "SYSTEM", systemKey: "REVENUE", currency },
        select: { balanceMinor: true },
      });
      report.platformRevenueMinor = (account?.balanceMinor ?? 0n).toString();
    }
    return report;
  }

  /** Buy/sell unit-price spread + realized order margin per node (docs/06 §3.9, reporting only). */
  async margin(_caller: OperatorPrincipal) {
    const operators = await this.prisma.operator.findMany({
      select: { id: true, displayName: true, tier: true, buyUnitPriceCents: true, sellUnitPriceCents: true },
    });
    const ids = operators.map((o) => o.id);

    const [sold, bought] = await Promise.all([
      this.system.creditOrder.groupBy({
        by: ["sellerOperatorId"],
        where: { status: "ISSUED", sellerOperatorId: { in: ids } },
        orderBy: { sellerOperatorId: "asc" },
        _sum: { totalCents: true },
      }),
      this.system.creditOrder.groupBy({
        by: ["buyerOperatorId"],
        where: { status: "ISSUED", buyerOperatorId: { in: ids } },
        orderBy: { buyerOperatorId: "asc" },
        _sum: { totalCents: true },
      }),
    ]);
    const soldMap = new Map(sold.map((s) => [s.sellerOperatorId, s._sum.totalCents ?? 0]));
    const boughtMap = new Map(bought.map((b) => [b.buyerOperatorId, b._sum.totalCents ?? 0]));

    const nodes = operators.map((o) => {
      const soldCents = soldMap.get(o.id) ?? 0;
      const boughtCents = boughtMap.get(o.id) ?? 0;
      const buy = o.buyUnitPriceCents ?? 0;
      const sell = o.sellUnitPriceCents ?? 0;
      return {
        operatorId: o.id,
        displayName: o.displayName,
        tier: o.tier,
        buyUnitPriceCents: buy,
        sellUnitPriceCents: sell,
        spreadCents: sell - buy,
        soldCents,
        boughtCents,
        marginCents: soldCents - boughtCents,
      };
    });
    return { nodes, totalMarginCents: nodes.reduce((acc, n) => acc + n.marginCents, 0) };
  }

  /** Outstanding off-ledger cash up/down the chain (docs/06 §3.9). Subtree Settlement rows. */
  async settlement(_caller: OperatorPrincipal) {
    const operators = await this.prisma.operator.findMany({ select: { id: true } });
    const ids = operators.map((o) => o.id);
    const idSet = new Set(ids);

    // Player payables carry the owning store as operatorId, so subtree operator
    // ids alone capture both operator receivables and player payables.
    const rows = await this.system.settlement.findMany({
      where: { OR: [{ operatorId: { in: ids } }, { counterpartyId: { in: ids } }] },
      orderBy: { lastEventAt: "desc" },
      take: 500,
    });

    let receivableCents = 0;
    let payableCents = 0;
    for (const r of rows) {
      if (!idSet.has(r.operatorId)) continue;
      if (r.netCents >= 0) receivableCents += r.netCents;
      else payableCents += -r.netCents;
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        operatorId: r.operatorId,
        counterpartyId: r.counterpartyId,
        currency: r.currency,
        netCents: r.netCents,
        lastEventAt: r.lastEventAt,
      })),
      receivableCents,
      payableCents,
      netCents: receivableCents - payableCents,
    };
  }

  /** Synchronous CSV of any scoped report (docs/05 §9). Money fields stay integer-minor strings. */
  async exportCsv(caller: OperatorPrincipal, input: ExportReportInput): Promise<{ filename: string; csv: string }> {
    const range = { from: input.from, to: input.to, operatorId: input.operatorId };
    let headers: string[];
    let rows: (string | number)[][];

    switch (input.type) {
      case "credit-flow": {
        const r = await this.creditFlow(caller, { ...range, granularity: "day" });
        headers = ["bucket", "issuedMinor", "transferredMinor", "rechargedMinor", "redeemedMinor"];
        rows = r.buckets.map((b) => [b.bucket, b.issuedMinor, b.transferredMinor, b.rechargedMinor, b.redeemedMinor]);
        break;
      }
      case "player-activity": {
        const r = await this.playerActivity(caller, range);
        headers = ["playerId", "username", "operatorId", "rechargedMinor", "redeemedMinor", "netMinor"];
        rows = r.items.map((i) => [i.playerId, i.username, i.operatorId, i.rechargedMinor, i.redeemedMinor, i.netMinor]);
        break;
      }
      case "agent-sales": {
        const r = await this.agentSales(caller, range);
        headers = ["operatorId", "displayName", "tier", "holdingsMinor", "soldToPlayersMinor", "removedFromPlayersMinor", "netToPlayersMinor"];
        rows = r.items.map((i) => [i.operatorId, i.displayName, i.tier, i.holdingsMinor, i.soldToPlayersMinor, i.removedFromPlayersMinor, i.netToPlayersMinor]);
        break;
      }
      case "revenue": {
        const r = await this.revenue(caller, range);
        headers = ["currency", "betsMinor", "winsMinor", "revenueMinor"];
        rows = [[r.currency, r.betsMinor, r.winsMinor, r.revenueMinor]];
        break;
      }
      case "margin": {
        const r = await this.margin(caller);
        headers = [
          "operatorId",
          "displayName",
          "tier",
          "buyUnitPriceCents",
          "sellUnitPriceCents",
          "spreadCents",
          "soldCents",
          "boughtCents",
          "marginCents",
        ];
        rows = r.nodes.map((n) => [
          n.operatorId,
          n.displayName,
          n.tier,
          n.buyUnitPriceCents,
          n.sellUnitPriceCents,
          n.spreadCents,
          n.soldCents,
          n.boughtCents,
          n.marginCents,
        ]);
        break;
      }
      case "settlement": {
        const r = await this.settlement(caller);
        headers = ["id", "operatorId", "counterpartyId", "currency", "netCents", "lastEventAt"];
        rows = r.items.map((i) => [i.id, i.operatorId, i.counterpartyId, i.currency, i.netCents, i.lastEventAt.toISOString()]);
        break;
      }
      case "redemptions": {
        const r = await this.redemptionsReport(caller, range);
        headers = ["status", "count", "totalMinor"];
        rows = r.byStatus.map((s) => [s.status, s.count, s.totalMinor]);
        break;
      }
    }

    return { filename: `${input.type}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(headers, rows) };
  }

  /** Ledger-health surface for the admin page: reconciliation + system balances. */
  async ledgerHealth() {
    const [result, systemAccounts] = await Promise.all([
      this.reconciliation.runAll(),
      this.reconciliation.systemAccountBalances(),
    ]);
    return { ...result, systemAccounts };
  }

  lookupTransaction(input: { id?: string; idempotencyKey?: string }) {
    return this.reconciliation.lookupTransaction(input);
  }

  // ---- internals -------------------------------------------------------------

  private subtreeOp(path: string): Prisma.OperatorWhereInput {
    return { OR: [{ path }, { path: { startsWith: `${path}.` } }] };
  }

  /** Recent money-in events in the caller's subtree (docs/06 §3.1 activity feed). */
  async activity(caller: OperatorPrincipal) {
    const subtree = this.subtreeOp(caller.path);
    const entries = await this.system.ledgerEntry.findMany({
      where: {
        direction: "CREDIT",
        account: { OR: [{ operator: subtree }, { player: { operator: subtree } }] },
      },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        account: { select: { ownerType: true } },
        transaction: { select: { type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return {
      items: entries.map((e) => ({
        id: e.id,
        type: e.transaction.type,
        actor: e.account.ownerType,
        currency: e.currency,
        amountMinor: e.amountMinor.toString(),
        at: e.createdAt,
      })),
    };
  }

  private createdAtFilter(query: ReportRangeQuery): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    return {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lt: new Date(query.to) } : {}),
    };
  }

  /** Resolve the path to scope by; an explicit operatorId is subtree-checked first. */
  private async scopedPath(caller: OperatorPrincipal, operatorId?: string): Promise<string> {
    if (!operatorId) return caller.path;
    const op = await this.system.operator.findUnique({ where: { id: operatorId }, select: { path: true } });
    if (!op) throw new NotFoundError("Operator not found");
    if (!isInSubtree(caller.path, op.path)) throw new OutOfScopeError();
    return op.path;
  }
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number): string => {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
}
