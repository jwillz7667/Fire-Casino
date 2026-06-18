"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Play, Search, XCircle } from "lucide-react";
import { ledgerTxLookupSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  EmptyState,
  ForbiddenState,
  Input,
  Money,
  Panel,
  SectionTitle,
  Skeleton,
  StatusPill,
  useToast,
} from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { LedgerHealth, LedgerTransactionDetail, LedgerTxAccount } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, humanize } from "@/lib/format";

/** Human label for a ledger leg's account (the API returns an account object, not a label). */
function accountLabel(a: LedgerTxAccount): string {
  if (a.systemKey) return humanize(a.systemKey);
  if (a.ownerType === "OPERATOR" && a.operatorId) return `Operator ${a.operatorId.slice(0, 8)}`;
  if (a.ownerType === "PLAYER" && a.playerId) return `Player ${a.playerId.slice(0, 8)}`;
  return humanize(a.ownerType);
}

export default function LedgerHealthPage(): ReactElement {
  const principal = usePrincipal();
  const toast = useToast();
  const [lookup, setLookup] = useState("");
  const [tx, setTx] = useState<LedgerTransactionDetail | null>(null);
  const [txError, setTxError] = useState<string | undefined>();

  const canView = hasPermission(principal, "report.ledger_health");

  const health = useQuery({
    queryKey: ["ledger", "health"],
    queryFn: () => api.get<LedgerHealth>("/reports/ledger-health"),
    enabled: canView,
    retry: false,
  });

  const runNow = useMutation({
    mutationFn: () => api.post<{ jobId?: string }>("/reports/ledger-health/run"),
    onSuccess: () => {
      toast.push({ title: "Reconciliation queued", intent: "success" });
      void health.refetch();
    },
    onError: (err) => {
      toast.push({ title: "Couldn't run", description: errorMessage(err), intent: "danger" });
    },
  });

  const lookupTx = useMutation({
    mutationFn: () => {
      const parsed = ledgerTxLookupSchema.safeParse(
        lookup.includes("-") ? { idempotencyKey: lookup } : { id: lookup },
      );
      if (!parsed.success) throw new Error("Enter a transaction id or idempotency key");
      const params = new URLSearchParams();
      if (parsed.data.id) params.set("id", parsed.data.id);
      if (parsed.data.idempotencyKey) params.set("idempotencyKey", parsed.data.idempotencyKey);
      return api.get<LedgerTransactionDetail>(`/reports/ledger-health/transaction?${params.toString()}`);
    },
    onSuccess: (data) => {
      setTx(data);
      setTxError(undefined);
    },
    onError: (err) => {
      setTx(null);
      setTxError(errorMessage(err));
    },
  });

  if (!canView) return <ForbiddenState />;

  const unavailable = health.error instanceof ApiError;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ledger health"
        subtitle="Reconciliation integrity for the credit ledger."
        actions={
          <Button onClick={() => { runNow.mutate(); }} loading={runNow.isPending}>
            <Play className="h-4 w-4" />
            Run reconciliation now
          </Button>
        }
      />

      <Panel className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <SectionTitle>Reconciliation checks</SectionTitle>
          {health.data?.ranAt ? (
            <span className="text-xs text-text-lo">Last run {formatDateTime(health.data.ranAt)}</span>
          ) : null}
        </div>
        {health.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : unavailable || (health.data?.checks.length ?? 0) === 0 ? (
          <EmptyState title="No reconciliation data" description="Run a reconciliation to populate these checks." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(health.data?.checks ?? []).map((c) => (
              <div
                key={c.name}
                className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface-2 px-3 py-2.5"
                title={c.detail}
              >
                <div className="flex items-center gap-2">
                  {c.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger" />
                  )}
                  <span className="text-sm text-text-hi">{humanize(c.name)}</span>
                </div>
                <Badge intent={c.ok ? "success" : "danger"}>{c.ok ? "Pass" : "Fail"}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col gap-4">
        <SectionTitle>System accounts</SectionTitle>
        {health.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (health.data?.systemAccounts.length ?? 0) === 0 ? (
          <EmptyState title="No system accounts" />
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {(health.data?.systemAccounts ?? []).map((a) => (
              <div key={`${a.systemKey}-${a.currency}`} className="rounded-md border border-hairline bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{humanize(a.systemKey)}</span>
                  <span className="text-[0.625rem] text-text-lo">{a.currency}</span>
                </div>
                <div className="mt-1.5">
                  <Money valueMinor={a.balanceMinor} currency={a.currency} size="md" />
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  {a.ok ? (
                    <CheckCircle2 className="h-3 w-3 text-success" />
                  ) : (
                    <XCircle className="h-3 w-3 text-danger" />
                  )}
                  <span className="text-[0.625rem] text-text-lo">expect {a.expectedSign.replace(/_/g, " ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col gap-4">
        <SectionTitle>Transaction explorer</SectionTitle>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-lo" />
            <Input
              value={lookup}
              onChange={(e) => { setLookup(e.target.value); }}
              placeholder="Transaction id or idempotency key"
              className="pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") lookupTx.mutate();
              }}
            />
          </div>
          <Button onClick={() => { lookupTx.mutate(); }} loading={lookupTx.isPending} disabled={lookup.trim() === ""}>
            Look up
          </Button>
        </div>

        {txError ? <p className="text-sm text-danger">{txError}</p> : null}

        {tx ? (
          <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={tx.transaction.type} />
              <StatusPill status={tx.transaction.status} />
              <span className="font-mono text-xs text-text-lo">{tx.transaction.id}</span>
              <span className="ml-auto text-xs text-text-lo">{formatDateTime(tx.transaction.createdAt)}</span>
            </div>
            {tx.transaction.memo ? <p className="text-sm text-text-mid">{tx.transaction.memo}</p> : null}
            <ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
              {tx.legs.map((leg) => (
                <li key={leg.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge intent={leg.direction === "DEBIT" ? "warning" : "info"}>{leg.direction}</Badge>
                    <span className="text-sm text-text-hi">{accountLabel(leg.account)}</span>
                  </div>
                  <Money valueMinor={leg.amountMinor} currency={leg.currency} size="sm" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
