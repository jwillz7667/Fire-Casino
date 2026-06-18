"use client";

import { type ReactElement, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronDown, ChevronRight, KeyRound, MinusCircle, Wallet } from "lucide-react";
import {
  Badge,
  BalanceChip,
  Button,
  EmptyState,
  Money,
  Panel,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  StatusPill,
  useToast,
} from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import type { Page, PlayerComplianceState, PlayerDetail, PlayerHistoryEvent } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { QueryBoundary } from "@/components/query-boundary";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PlayerRtpPanel } from "@/components/players/player-rtp-panel";
import { RgLimitsPanel } from "@/components/players/rg-limits-panel";
import { SessionRounds } from "@/components/players/session-rounds";
import { RechargeDialog } from "@/components/players/recharge-dialog";
import { RemoveCreditsDialog } from "@/components/players/remove-credits-dialog";
import { ResetPasswordDialog } from "@/components/players/reset-password-dialog";
import { formatDateTime, humanize } from "@/lib/format";

export default function PlayerDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  // Owner directive: super admins work at aggregate level, not per-player history.
  const isSuperAdmin = principal.tier === "SUPER_ADMIN";

  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);

  const player = useQuery({
    queryKey: ["player", id],
    queryFn: () => api.get<PlayerDetail>(`/players/${id}`),
  });
  const compliance = useQuery({
    queryKey: ["player", id, "compliance"],
    queryFn: () => api.get<PlayerComplianceState>(`/compliance/players/${id}/state`),
    enabled: player.isSuccess && hasPermission(principal, "compliance.view"),
    retry: false,
  });

  const suspend = useMutation({
    mutationFn: () => api.post<PlayerDetail>(`/players/${id}/suspend`),
    onSuccess: () => {
      toast.push({ title: "Player suspended", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["player", id] });
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      setSuspendOpen(false);
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: err instanceof ApiError ? err.message : "", intent: "danger" });
      setSuspendOpen(false);
    },
  });

  const reactivate = useMutation({
    mutationFn: () => api.post<PlayerDetail>(`/players/${id}/reactivate`),
    onSuccess: () => {
      toast.push({ title: "Player reactivated", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["player", id] });
      void queryClient.invalidateQueries({ queryKey: ["players"] });
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: err instanceof ApiError ? err.message : "", intent: "danger" });
    },
  });

  const canRecharge = hasPermission(principal, "player.recharge");
  const canDeduct = hasPermission(principal, "player.deduct");
  const canSuspend = hasPermission(principal, "player.suspend");

  const p = player.data;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/players" className="text-sm text-text-mid hover:text-text-hi">
        ← All players
      </Link>

      <QueryBoundary isLoading={player.isLoading} error={player.error} onRetry={() => { void player.refetch(); }}>
        {p ? (
          <>
            <PageHeader
              title={
                <span className="flex items-center gap-3">
                  {p.username}
                  <StatusPill status={p.status} />
                </span>
              }
              subtitle={p.displayName ?? undefined}
              actions={
                <div className="flex flex-wrap gap-2">
                  {canRecharge ? (
                    <Button onClick={() => { setRechargeOpen(true); }} disabled={p.status !== "ACTIVE"}>
                      <Wallet className="h-4 w-4" />
                      Recharge
                    </Button>
                  ) : null}
                  {canDeduct ? (
                    <Button
                      variant="secondary"
                      onClick={() => { setRemoveOpen(true); }}
                      disabled={
                        BigInt(p.wallets.find((w) => w.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0") <= 0n
                      }
                    >
                      <MinusCircle className="h-4 w-4" />
                      Remove credits
                    </Button>
                  ) : null}
                  {canSuspend ? (
                    <Button variant="secondary" onClick={() => { setResetOpen(true); }}>
                      <KeyRound className="h-4 w-4" />
                      Reset password
                    </Button>
                  ) : null}
                  {canSuspend && p.status === "ACTIVE" ? (
                    <Button variant="ghost" onClick={() => { setSuspendOpen(true); }}>
                      <Ban className="h-4 w-4" />
                      Suspend
                    </Button>
                  ) : null}
                  {canSuspend && p.status === "SUSPENDED" ? (
                    <Button variant="secondary" onClick={() => { reactivate.mutate(); }} loading={reactivate.isPending}>
                      <Ban className="h-4 w-4" />
                      Reactivate
                    </Button>
                  ) : null}
                </div>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="flex flex-col gap-6 lg:col-span-2">
                <Panel className="flex flex-col gap-3">
                  <SectionTitle>Wallet</SectionTitle>
                  {p.wallets.length > 0 ? (
                    <BalanceChip
                      balances={p.wallets.map((w) => ({
                        currency: w.currency,
                        valueMinor: w.balanceMinor,
                        label: w.currency,
                      }))}
                    />
                  ) : (
                    <span className="text-sm text-text-lo">No wallet.</span>
                  )}
                </Panel>

                {isSuperAdmin ? null : (
                  <Panel className="flex flex-col gap-3">
                    <SectionTitle>History</SectionTitle>
                    <HistoryTimeline playerId={id} />
                  </Panel>
                )}

                {hasPermission(principal, "game.rtp_agent") ? <PlayerRtpPanel playerId={id} /> : null}

                {hasPermission(principal, "compliance.manage") && compliance.data ? (
                  <RgLimitsPanel playerId={id} state={compliance.data} />
                ) : null}
              </div>

              <div className="flex flex-col gap-6">
                <Panel className="flex flex-col gap-3">
                  <SectionTitle>Profile</SectionTitle>
                  <dl className="flex flex-col gap-2 text-sm">
                    <Row label="Phone" value={p.phone ?? "—"} />
                    <Row label="Email" value={p.email ?? "—"} />
                    <Row label="Owning agent" value={p.operatorId} mono />
                    <Row label="Joined" value={formatDateTime(p.createdAt)} />
                    <Row label="Last active" value={formatDateTime(p.lastLoginAt)} />
                  </dl>
                </Panel>

                <Panel className="flex flex-col gap-3">
                  <SectionTitle>Compliance</SectionTitle>
                  {hasPermission(principal, "compliance.view") ? (
                    compliance.isLoading ? (
                      <Skeleton className="h-20 w-full" />
                    ) : compliance.data ? (
                      <ComplianceSummary state={compliance.data} />
                    ) : (
                      <span className="text-sm text-text-lo">Unavailable.</span>
                    )
                  ) : (
                    <div className="flex flex-col gap-1.5 text-sm">
                      <Row label="KYC" value={humanize(p.kyc?.status ?? "NONE")} />
                    </div>
                  )}
                </Panel>
              </div>
            </div>

            <RechargeDialog
              open={rechargeOpen}
              onClose={() => { setRechargeOpen(false); }}
              playerId={id}
              playerUsername={p.username}
            />
            <RemoveCreditsDialog
              open={removeOpen}
              onClose={() => { setRemoveOpen(false); }}
              playerId={id}
              playerUsername={p.username}
              playerWallets={p.wallets}
            />
            <ResetPasswordDialog open={resetOpen} onClose={() => { setResetOpen(false); }} playerId={id} />
            <ConfirmDialog
              open={suspendOpen}
              onClose={() => { setSuspendOpen(false); }}
              onConfirm={() => { suspend.mutate(); }}
              title="Suspend this player?"
              description="They will be blocked from play and recharge until reactivated."
              confirmLabel="Suspend"
              danger
              loading={suspend.isPending}
            />
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

const HISTORY_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "credit", label: "Credit" },
  { key: "play", label: "Play" },
  { key: "redemption", label: "Redemptions" },
];

function HistoryTimeline({ playerId }: { playerId: string }): ReactElement {
  const [view, setView] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useCursorList<PlayerHistoryEvent>(["player", playerId, "history"], (cursor) =>
    api.get<Page<PlayerHistoryEvent>>(`/players/${playerId}/history?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
  );

  // Separate the merged feed into Credit (ledger) vs Play (sessions) vs Redemptions.
  const items = list.items.filter((e) => {
    if (view === "all") return true;
    if (view === "credit") return e.kind === "ledger";
    if (view === "play") return e.kind === "session";
    return e.kind === "redemption";
  });

  if (list.isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl items={HISTORY_FILTERS} active={view} onChange={setView} />
      {items.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Recharges, sessions and redemptions will appear here." />
      ) : (
      <ul className="flex flex-col divide-y divide-hairline">
        {items.map((e) => {
          const isSession = e.kind === "session";
          const isOpen = isSession && expanded === e.id;
          return (
            <li key={`${e.kind}-${e.id}`} className="flex flex-col">
              <div
                className={`flex items-center justify-between gap-3 py-2.5 ${isSession ? "cursor-pointer" : ""}`}
                onClick={isSession ? () => { setExpanded(isOpen ? null : e.id); } : undefined}
              >
                <div className="flex items-center gap-2.5">
                  {isSession ? (
                    isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-text-lo" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-text-lo" />
                    )
                  ) : null}
                  <Badge intent={e.kind === "redemption" ? "ember" : isSession ? "info" : "gold"}>
                    {e.kind === "ledger" ? humanize(e.type) : isSession ? "Session" : "Redemption"}
                  </Badge>
                  <span className="text-xs text-text-lo">{formatDateTime(e.at)}</span>
                </div>
                <HistoryAmount event={e} />
              </div>
              {isOpen ? <SessionRounds playerId={playerId} sessionId={e.id} /> : null}
            </li>
          );
        })}
      </ul>
      )}
      {list.nextCursor ? (
        <Button variant="ghost" size="sm" className="mt-2 self-center" onClick={list.loadMore} loading={list.isFetchingNextPage}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function HistoryAmount({ event }: { event: PlayerHistoryEvent }): ReactElement {
  if (event.kind === "ledger") {
    return (
      <Money
        valueMinor={event.direction === "DEBIT" ? `-${event.amountMinor}` : event.amountMinor}
        currency={event.currency}
        signed
        size="sm"
      />
    );
  }
  if (event.kind === "session") {
    return (
      <span className="flex items-center gap-2 text-xs text-text-mid">
        <span>bet</span>
        <Money valueMinor={event.totalBetMinor} currency={event.currency} size="sm" />
        <span>win</span>
        <Money valueMinor={event.totalWinMinor} currency={event.currency} size="sm" />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <StatusPill status={event.status} />
      <Money valueMinor={event.amountMinor} currency={event.currency} size="sm" />
    </span>
  );
}

function ComplianceSummary({ state }: { state: PlayerComplianceState }): ReactElement {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Row label="KYC" value={`${humanize(state.kycStatus)} · L${state.kycLevel}`} />
      <Row label="Self-excluded" value={state.selfExcluded ? "Yes" : "No"} />
      <Row label="Open AML flags" value={String(state.openAmlFlags)} />
      <div className="flex items-center justify-between">
        <span className="text-text-lo">RG limits</span>
        <span className="text-text-hi">{state.rgLimits.length}</span>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-lo">{label}</span>
      <span className={mono ? "max-w-[12rem] truncate font-mono text-xs text-text-hi" : "text-text-hi"}>{value}</span>
    </div>
  );
}
