"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmMoneyDialog, Field, Input, Modal, MoneyInput, Button, useToast } from "@aureus/ui";
import { removeCreditsSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import type { BalanceEntry, RemoveCreditsResult } from "@/lib/types";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/**
 * Agent removes credits from a player's wallet (docs/06 §3.7, R8). The removed
 * amount is BURNED — it does not return to the agent's balance — so the dialog
 * frames the player's balance going down and makes the burn explicit. Capped at
 * the player's spendable balance; a reason is required.
 */
export function RemoveCreditsDialog({
  open,
  onClose,
  playerId,
  playerUsername,
  playerWallets,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerUsername: string;
  playerWallets: BalanceEntry[];
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const idempotencyKey = useIdempotencyKey(open);

  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const playerBefore = BigInt(
    playerWallets.find((w) => w.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0",
  );
  const amount = amountMinor ?? 0n;
  const exceeds = amount > playerBefore;

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = removeCreditsSchema.safeParse({
        playerId,
        amountMinor: amount.toString(),
        reason,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      return api.post<RemoveCreditsResult>(
        "/wallet/remove",
        { ...parsed.data, amountMinor: amount.toString() },
        { idempotencyKey },
      );
    },
    onSuccess: () => {
      toast.push({ title: "Credits removed", description: "Burned — not returned to your balance.", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["player", playerId] });
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      setConfirmOpen(false);
      reset();
      onClose();
    },
    onError: (err) => {
      toast.push({ title: "Removal failed", description: errorMessage(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  function reset(): void {
    setAmountMinor(undefined);
    setReason("");
  }

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        onClose={() => { reset(); onClose(); }}
        title={`Remove credits from ${playerUsername}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={amount <= 0n || exceeds || reason.trim() === ""}
              onClick={() => { setConfirmOpen(true); }}
            >
              Review removal
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Amount" required error={exceeds ? "Exceeds the player's balance" : undefined}>
            <MoneyInput
              valueMinor={amountMinor}
              onChangeMinor={setAmountMinor}
              currency={OPERATOR_CURRENCY}
              maxMinor={playerBefore}
            />
          </Field>
          <p className="rounded-sm border border-hairline bg-surface-2 px-3 py-2 text-xs text-text-mid">
            Removed credits are burned and do <strong>not</strong> return to your balance.
          </p>
          <Field label="Reason" required>
            <Input value={reason} onChange={(e) => { setReason(e.target.value); }} maxLength={280} />
          </Field>
        </div>
      </Modal>

      <ConfirmMoneyDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); }}
        onConfirm={() => { mutation.mutate(); }}
        title="Confirm removal"
        description={`Burn credits from ${playerUsername}'s wallet. This does not refund your balance.`}
        loading={mutation.isPending}
        confirmLabel="Remove credits"
        danger
        deltas={[
          {
            label: "Player balance",
            currency: OPERATOR_CURRENCY,
            beforeMinor: playerBefore.toString(),
            afterMinor: (playerBefore - amount).toString(),
          },
        ]}
      />
    </>
  );
}
