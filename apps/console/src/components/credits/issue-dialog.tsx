"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmMoneyDialog, Field, Input, Modal, MoneyInput, Button, Select, useToast } from "@aureus/ui";
import { issueCreditsSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import type { BalanceEntry, LedgerPostResult, OperatorNode, Page } from "@/lib/types";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/** Mint new credits into a direct child or self — the only place credits enter existence. */
export function IssueDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const idempotencyKey = useIdempotencyKey(open);

  const [targetId, setTargetId] = useState<string>(principal.operatorId);
  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [memo, setMemo] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const children = useQuery({
    queryKey: ["operators", "children", principal.operatorId],
    queryFn: () => api.get<Page<OperatorNode>>(`/operators?scope=children&limit=100`),
    enabled: open,
  });
  const targetBalance = useQuery({
    queryKey: ["operator", targetId, "balance"],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${targetId}/balance`),
    enabled: open,
  });

  const before = BigInt(targetBalance.data?.find((b) => b.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0");
  const amount = amountMinor ?? 0n;

  const targets = [
    { id: principal.operatorId, label: `${principal.displayName} (you)` },
    ...(children.data?.items ?? []).map((o) => ({ id: o.id, label: o.displayName })),
  ];

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = issueCreditsSchema.safeParse({
        operatorId: targetId,
        quantityMinor: amount.toString(),
        memo: memo === "" ? undefined : memo,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid issue");
      return api.post<LedgerPostResult>(
        "/credits/issue",
        { ...parsed.data, quantityMinor: amount.toString() },
        { idempotencyKey },
      );
    },
    onSuccess: () => {
      toast.push({ title: "Credits issued", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["self-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["operator", targetId] });
      setConfirmOpen(false);
      reset();
      onClose();
    },
    onError: (err) => {
      toast.push({ title: "Issue failed", description: errorMessage(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  function reset(): void {
    setAmountMinor(undefined);
    setMemo("");
  }

  const targetLabel = targets.find((t) => t.id === targetId)?.label ?? "target";

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        onClose={() => { reset(); onClose(); }}
        title="Issue credits"
        footer={
          <>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button disabled={amount <= 0n} onClick={() => { setConfirmOpen(true); }}>
              Review issue
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-lo">Newly minted credits flow from the system MINT account into the target.</p>
          <Field label="Target operator" required>
            <Select value={targetId} onChange={(e) => { setTargetId(e.target.value); }}>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required>
            <MoneyInput valueMinor={amountMinor} onChangeMinor={setAmountMinor} currency={OPERATOR_CURRENCY} />
          </Field>
          <Field label="Memo" hint="Optional">
            <Input value={memo} onChange={(e) => { setMemo(e.target.value); }} maxLength={280} />
          </Field>
        </div>
      </Modal>

      <ConfirmMoneyDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); }}
        onConfirm={() => { mutation.mutate(); }}
        title="Confirm issue"
        description={`Mint credits into ${targetLabel}.`}
        loading={mutation.isPending}
        confirmLabel="Issue credits"
        deltas={[
          {
            label: targetLabel,
            currency: OPERATOR_CURRENCY,
            beforeMinor: before.toString(),
            afterMinor: (before + amount).toString(),
          },
        ]}
      />
    </>
  );
}
