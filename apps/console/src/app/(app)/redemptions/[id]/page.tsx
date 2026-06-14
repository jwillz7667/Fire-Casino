"use client";

import { type ReactElement, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmMoneyDialog,
  Money,
  Panel,
  ReasonDialog,
  SectionTitle,
  StatusPill,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { PlayerDetail, RedemptionDetail } from "@/lib/types";
import { REDEEMABLE_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { PageHeader } from "@/components/page-header";
import { QueryBoundary } from "@/components/query-boundary";
import { SettleDialog } from "@/components/redemptions/settle-dialog";
import { formatDateTime, humanize } from "@/lib/format";

type Dialog = "none" | "approve" | "reject" | "cancel" | "settle";

export default function RedemptionDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const [dialog, setDialog] = useState<Dialog>("none");
  // Fresh idempotency key each time the approve dialog opens (hard rule #3).
  const approveKey = useIdempotencyKey(dialog === "approve");

  const redemption = useQuery({
    queryKey: ["redemption", id],
    queryFn: () => api.get<RedemptionDetail>(`/redemptions/${id}`),
  });

  const data = redemption.data;
  const playerWallets = useQuery({
    queryKey: ["player", data?.playerId, "wallets-for-redemption"],
    queryFn: () => api.get<PlayerDetail>(`/players/${data?.playerId ?? ""}`),
    enabled: dialog === "approve" && Boolean(data?.playerId),
    retry: false,
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["redemption", id] });
    void queryClient.invalidateQueries({ queryKey: ["redemptions"] });
  }

  const approve = useMutation({
    mutationFn: () => api.post<RedemptionDetail>(`/redemptions/${id}/approve`, undefined, { idempotencyKey: approveKey }),
    onSuccess: () => {
      toast.push({ title: "Redemption approved", intent: "success" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => {
      toast.push({ title: "Approve blocked", description: errorMessage(err), intent: "danger" });
      setDialog("none");
    },
  });
  const reject = useMutation({
    mutationFn: (reason: string) => api.post<RedemptionDetail>(`/redemptions/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.push({ title: "Redemption rejected", intent: "info" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<RedemptionDetail>(`/redemptions/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.push({ title: "Redemption cancelled", intent: "info" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });

  const canApprove = hasPermission(principal, "redemption.approve");
  const canSettle = hasPermission(principal, "redemption.settle");

  const redeemBefore = BigInt(
    playerWallets.data?.wallets.find((w) => w.currency === REDEEMABLE_CURRENCY)?.balanceMinor ?? "0",
  );
  const amount = BigInt(data?.amountMinor ?? "0");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/redemptions" className="text-sm text-text-mid hover:text-text-hi">
        ← Redemption queue
      </Link>

      <QueryBoundary isLoading={redemption.isLoading} error={redemption.error} onRetry={() => { void redemption.refetch(); }}>
        {data ? (
          <>
            <PageHeader
              title={
                <span className="flex items-center gap-3">
                  Redemption
                  <StatusPill status={data.status} />
                </span>
              }
              subtitle={data.playerUsername ? `Player ${data.playerUsername}` : undefined}
              actions={
                <div className="flex flex-wrap gap-2">
                  {canApprove && data.status === "PENDING" ? (
                    <>
                      <Button onClick={() => { setDialog("approve"); }}>
                        <Check className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button variant="ghost" onClick={() => { setDialog("reject"); }}>
                        <X className="h-4 w-4" />
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {canSettle && data.status === "APPROVED" ? (
                    <Button onClick={() => { setDialog("settle"); }}>Mark paid</Button>
                  ) : null}
                  {canApprove && (data.status === "PENDING" || data.status === "APPROVED") ? (
                    <Button variant="ghost" onClick={() => { setDialog("cancel"); }}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel className="flex flex-col gap-3 lg:col-span-2">
                <SectionTitle>Request</SectionTitle>
                <div className="flex items-center justify-between rounded-md border border-hairline bg-surface-2 px-4 py-3">
                  <span className="text-sm text-text-mid">Amount</span>
                  <Money valueMinor={data.amountMinor} currency={data.currency} size="lg" />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Row label="Method" value={data.method ?? "—"} />
                  <Row label="Requested" value={formatDateTime(data.createdAt)} />
                  <Row label="Decided" value={formatDateTime(data.decidedAt)} />
                  <Row label="Settled" value={formatDateTime(data.settledAt)} />
                  <Row label="Payout ref" value={data.payoutRef ?? "—"} />
                  {data.rejectionReason ? <Row label="Reason" value={data.rejectionReason} /> : null}
                </dl>
                {data.playerId ? (
                  <Link href={`/players/${data.playerId}`} className="text-sm text-lumen hover:underline">
                    View player →
                  </Link>
                ) : null}
              </Panel>

              <Panel className="flex flex-col gap-3">
                <SectionTitle>Compliance gates</SectionTitle>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-text-lo">KYC</span>
                    <Badge intent={data.compliance.kycStatus === "VERIFIED" ? "success" : "warning"}>
                      {humanize(data.compliance.kycStatus)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-lo">Open AML flags</span>
                    <Badge intent={data.compliance.openAmlFlags > 0 ? "danger" : "neutral"}>
                      {data.compliance.openAmlFlags}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-lo">Self-excluded</span>
                    <Badge intent={data.compliance.selfExcluded ? "danger" : "neutral"}>
                      {data.compliance.selfExcluded ? "Yes" : "No"}
                    </Badge>
                  </div>
                </div>
                {data.compliance.kycStatus !== "VERIFIED" || data.compliance.openAmlFlags > 0 ? (
                  <p className="rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    Approval may be blocked until compliance clears.
                  </p>
                ) : null}
              </Panel>
            </div>

            <ConfirmMoneyDialog
              open={dialog === "approve"}
              onClose={() => { setDialog("none"); }}
              onConfirm={() => { approve.mutate(); }}
              title="Approve redemption"
              description="Burns the player's redeemable balance into the clearing account."
              loading={approve.isPending}
              confirmLabel="Approve"
              deltas={[
                {
                  label: `${data.playerUsername ?? "Player"} redeemable`,
                  currency: REDEEMABLE_CURRENCY,
                  beforeMinor: redeemBefore.toString(),
                  afterMinor: (redeemBefore - amount).toString(),
                },
              ]}
            />
            <ReasonDialog
              open={dialog === "reject"}
              onClose={() => { setDialog("none"); }}
              onConfirm={(reason) => { reject.mutate(reason); }}
              title="Reject redemption"
              confirmLabel="Reject"
              loading={reject.isPending}
              danger
            />
            <ReasonDialog
              open={dialog === "cancel"}
              onClose={() => { setDialog("none"); }}
              onConfirm={(reason) => { cancel.mutate(reason); }}
              title="Cancel redemption"
              confirmLabel="Cancel redemption"
              loading={cancel.isPending}
              danger
            />
            <SettleDialog open={dialog === "settle"} onClose={() => { setDialog("none"); }} redemptionId={id} />
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{label}</dt>
      <dd className="break-words text-text-hi">{value}</dd>
    </div>
  );
}
