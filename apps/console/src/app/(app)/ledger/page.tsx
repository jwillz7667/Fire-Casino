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
import type { LedgerHealth, LedgerTransaction } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, humanize } from "@/lib/format";

export default function LedgerHealthPage(): ReactElement {
  const principal = usePrincipal();
  const toast = useToast();
  const [lookup, setLookup] = useState("");
  const [tx, setTx] = useState<LedgerTransaction | null>(null);
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
      return api.get<LedgerTransaction>(`/reports/ledger-health/transaction?${params.toString()}`);
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
          {health.data?.lastRunAt ? (
            <span className="text-xs text-text-lo">Last run {formatDateTime(health.data.lastRunAt)}</span>
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
                key={c.key}
                className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface-2 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  {c.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger" />
                  )}
                  <span className="text-sm text-text-hi">{c.label}</span>
                </div>
                <Badge intent={c.passed ? "success" : "danger"}>{c.passed ? "Pass" : "Fail"}</Badge>
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
              <div key={`${a.account}-${a.currency}`} className="rounded-md border border-hairline bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{humanize(a.account)}</span>
                  <span className="text-[0.625rem] text-text-lo">{a.currency}</span>
                </div>
                <div className="mt-1.5">
                  <Money valueMinor={a.balanceMinor} currency={a.currency} size="md" />
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
              <StatusPill status={tx.type} />
              <StatusPill status={tx.status} />
              <span className="font-mono text-xs text-text-lo">{tx.id}</span>
              <span className="ml-auto text-xs text-text-lo">{formatDateTime(tx.createdAt)}</span>
            </div>
            {tx.memo ? <p className="text-sm text-text-mid">{tx.memo}</p> : null}
            <ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
              {tx.legs.map((leg, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge intent={leg.direction === "DEBIT" ? "warning" : "info"}>{leg.direction}</Badge>
                    <span className="text-sm text-text-hi">{leg.accountLabel}</span>
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
