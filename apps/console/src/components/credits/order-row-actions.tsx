"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmMoneyDialog, ReasonDialog, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { BalanceEntry, CreditOrder } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkPaidDialog } from "./mark-paid-dialog";

type Dialog = "none" | "markPaid" | "issue" | "reject" | "cancel";

/** Inline workflow actions for one credit order, scoped by role + status. */
export function OrderRowActions({ order, role }: { order: CreditOrder; role: "seller" | "buyer" }): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>("none");

  const buyerBalance = useQuery({
    queryKey: ["operator", order.buyerOperatorId, "balance"],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${order.buyerOperatorId}/balance`),
    enabled: dialog === "issue",
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["self-balance"] });
  }

  const acknowledge = useMutation({
    mutationFn: () => api.post<CreditOrder>(`/orders/${order.id}/awaiting-payment`),
    onSuccess: () => {
      toast.push({ title: "Awaiting payment", intent: "info" });
      invalidate();
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });
  const issue = useMutation({
    mutationFn: () => api.post<CreditOrder>(`/orders/${order.id}/issue`),
    onSuccess: () => {
      toast.push({ title: "Credits issued", intent: "success" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => {
      toast.push({ title: "Issue failed", description: errorMessage(err), intent: "danger" });
      setDialog("none");
    },
  });
  const reject = useMutation({
    mutationFn: (reason: string) => api.post<CreditOrder>(`/orders/${order.id}/reject`, { reason }),
    onSuccess: () => {
      toast.push({ title: "Order rejected", intent: "info" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<CreditOrder>(`/orders/${order.id}/cancel`),
    onSuccess: () => {
      toast.push({ title: "Order cancelled", intent: "info" });
      invalidate();
      setDialog("none");
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" });
      setDialog("none");
    },
  });

  const buyerBefore = BigInt(
    buyerBalance.data?.find((b) => b.currency === order.currency)?.balanceMinor ?? "0",
  );
  const amount = BigInt(order.quantityMinor);

  const sellerActions: ReactElement[] = [];
  if (role === "seller") {
    if (order.status === "REQUESTED") {
      sellerActions.push(
        <Button key="ack" size="sm" variant="ghost" onClick={() => { acknowledge.mutate(); }} loading={acknowledge.isPending}>
          Acknowledge
        </Button>,
      );
    }
    if (order.status === "REQUESTED" || order.status === "AWAITING_PAYMENT") {
      sellerActions.push(
        <Button key="paid" size="sm" variant="secondary" onClick={() => { setDialog("markPaid"); }}>
          Mark paid
        </Button>,
      );
    }
    if (order.status === "PAID") {
      sellerActions.push(
        <Button key="issue" size="sm" onClick={() => { setDialog("issue"); }}>
          Issue
        </Button>,
      );
    }
    if (order.status === "REQUESTED" || order.status === "AWAITING_PAYMENT" || order.status === "PAID") {
      sellerActions.push(
        <Button key="reject" size="sm" variant="ghost" onClick={() => { setDialog("reject"); }}>
          Reject
        </Button>,
      );
    }
  } else if (order.status === "REQUESTED" || order.status === "AWAITING_PAYMENT") {
    sellerActions.push(
      <Button key="cancel" size="sm" variant="ghost" onClick={() => { setDialog("cancel"); }}>
        Cancel
      </Button>,
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {sellerActions.length > 0 ? sellerActions : <span className="text-xs text-text-lo">—</span>}

      <MarkPaidDialog open={dialog === "markPaid"} onClose={() => { setDialog("none"); }} orderId={order.id} />

      <ConfirmMoneyDialog
        open={dialog === "issue"}
        onClose={() => { setDialog("none"); }}
        onConfirm={() => { issue.mutate(); }}
        title="Issue credits for this order"
        description="Posts the ledger transfer and links it to the order."
        loading={issue.isPending}
        confirmLabel="Issue"
        deltas={[
          {
            label: "Buyer balance",
            currency: order.currency,
            beforeMinor: buyerBefore.toString(),
            afterMinor: (buyerBefore + amount).toString(),
          },
        ]}
      />

      <ReasonDialog
        open={dialog === "reject"}
        onClose={() => { setDialog("none"); }}
        onConfirm={(reason) => { reject.mutate(reason); }}
        title="Reject order"
        confirmLabel="Reject"
        loading={reject.isPending}
        danger
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={() => { setDialog("none"); }}
        onConfirm={() => { cancel.mutate(); }}
        title="Cancel this order?"
        description="The request will be withdrawn."
        confirmLabel="Cancel order"
        danger
        loading={cancel.isPending}
      />
    </div>
  );
}
