"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmMoneyDialog, Field, Input, Modal, MoneyInput, Button, useToast } from "@aureus/ui";
import { transferCreditsSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import type { BalanceEntry, LedgerPostResult } from "@/lib/types";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/** Direct credit push to a direct child, with a before/after confirm (docs/06 §3.4). */
export function TransferCreditsDialog({
  open,
  onClose,
  fromOperatorId,
  toOperator,
}: {
  open: boolean;
  onClose: () => void;
  fromOperatorId: string;
  toOperator: { id: string; displayName: string };
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const idempotencyKey = useIdempotencyKey(open);

  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [memo, setMemo] = useState("");
  const [unitPriceCents, setUnitPriceCents] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fromBalance = useQuery({
    queryKey: ["self-balance", fromOperatorId],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${fromOperatorId}/balance`),
    enabled: open,
  });
  const toBalance = useQuery({
    queryKey: ["operator", toOperator.id, "balance"],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${toOperator.id}/balance`),
    enabled: open,
  });

  const fromMinor = BigInt(
    fromBalance.data?.find((b) => b.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0",
  );
  const toMinorBalance = BigInt(
    toBalance.data?.find((b) => b.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0",
  );
  const amount = amountMinor ?? 0n;

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = transferCreditsSchema.safeParse({
        toOperatorId: toOperator.id,
        quantityMinor: (amountMinor ?? 0n).toString(),
        unitPriceCents: unitPriceCents === "" ? undefined : Number(unitPriceCents),
        memo: memo === "" ? undefined : memo,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid transfer");
      return api.post<LedgerPostResult>(
        "/credits/transfer",
        { ...parsed.data, quantityMinor: (amountMinor ?? 0n).toString() },
        { idempotencyKey },
      );
    },
    onSuccess: () => {
      toast.push({ title: "Credits transferred", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["self-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["operator", toOperator.id] });
      setConfirmOpen(false);
      reset();
      onClose();
    },
    onError: (err) => {
      toast.push({ title: "Transfer failed", description: errorMessage(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  function reset(): void {
    setAmountMinor(undefined);
    setMemo("");
    setUnitPriceCents("");
  }

  const canReview = amount > 0n && amount <= fromMinor;

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        onClose={() => {
          reset();
          onClose();
        }}
        title={`Transfer credits to ${toOperator.displayName}`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button disabled={!canReview} onClick={() => { setConfirmOpen(true); }}>
              Review transfer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Amount" required hint={amount > fromMinor ? "Exceeds your balance" : undefined}>
            <MoneyInput
              valueMinor={amountMinor}
              onChangeMinor={setAmountMinor}
              currency={OPERATOR_CURRENCY}
              maxMinor={fromMinor}
            />
          </Field>
          <Field label="Agreed cash price ¢/credit" hint="Optional · off-ledger margin">
            <Input
              inputMode="numeric"
              value={unitPriceCents}
              onChange={(e) => { setUnitPriceCents(e.target.value.replace(/\D/g, "")); }}
            />
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
        title="Confirm transfer"
        description={`Move credits from your node to ${toOperator.displayName}.`}
        loading={mutation.isPending}
        confirmLabel="Transfer"
        deltas={[
          {
            label: "Your balance",
            currency: OPERATOR_CURRENCY,
            beforeMinor: fromMinor.toString(),
            afterMinor: (fromMinor - amount).toString(),
          },
          {
            label: toOperator.displayName,
            currency: OPERATOR_CURRENCY,
            beforeMinor: toMinorBalance.toString(),
            afterMinor: (toMinorBalance + amount).toString(),
          },
        ]}
      />
    </>
  );
}
