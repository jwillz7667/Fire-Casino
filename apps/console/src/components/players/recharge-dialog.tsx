"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmMoneyDialog, Field, Input, Modal, MoneyInput, Button, useToast } from "@aureus/ui";
import { rechargeSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import type { BalanceEntry, RechargeResult } from "@/lib/types";
import { isComplianceMode, OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/**
 * Agent recharges a player's wallet (docs/06 §3.7). Pre-checks the agent's own
 * balance and shows the post-recharge result before confirm. In COMPLIANCE mode
 * the action is framed as a PLAY purchase that also grants a PRIZE bonus.
 */
export function RechargeDialog({
  open,
  onClose,
  playerId,
  playerUsername,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerUsername: string;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const idempotencyKey = useIdempotencyKey(open);

  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const agentBalance = useQuery({
    queryKey: ["self-balance", principal.operatorId],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${principal.operatorId}/balance`),
    enabled: open,
  });

  const agentBefore = BigInt(
    agentBalance.data?.find((b) => b.currency === OPERATOR_CURRENCY)?.balanceMinor ?? "0",
  );
  const amount = amountMinor ?? 0n;
  const insufficient = amount > agentBefore;

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = rechargeSchema.safeParse({
        playerId,
        amountMinor: amount.toString(),
        note: note === "" ? undefined : note,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid amount");
      return api.post<RechargeResult>(
        "/wallet/recharge",
        { ...parsed.data, amountMinor: amount.toString() },
        { idempotencyKey },
      );
    },
    onSuccess: (result) => {
      toast.push({
        title: "Recharge complete",
        description:
          result.mode === "COMPLIANCE" && BigInt(result.prizeBonusMinor) > 0n
            ? `Player received a PRIZE bonus too.`
            : undefined,
        intent: "success",
      });
      void queryClient.invalidateQueries({ queryKey: ["self-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["player", playerId] });
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      setConfirmOpen(false);
      reset();
      onClose();
    },
    onError: (err) => {
      toast.push({ title: "Recharge failed", description: errorMessage(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  function reset(): void {
    setAmountMinor(undefined);
    setNote("");
  }

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        onClose={() => { reset(); onClose(); }}
        title={`Recharge ${playerUsername}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button disabled={amount <= 0n || insufficient} onClick={() => { setConfirmOpen(true); }}>
              Review recharge
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field
            label={isComplianceMode ? "PLAY amount" : "Amount"}
            required
            error={insufficient ? "Exceeds your balance" : undefined}
          >
            <MoneyInput
              valueMinor={amountMinor}
              onChangeMinor={setAmountMinor}
              currency={OPERATOR_CURRENCY}
              maxMinor={agentBefore}
            />
          </Field>
          {isComplianceMode ? (
            <p className="rounded-sm border border-hairline bg-surface-2 px-3 py-2 text-xs text-text-mid">
              The player buys PLAY credits and receives a PRIZE bonus per your promo configuration.
            </p>
          ) : null}
          <Field label="Note" hint="Optional">
            <Input value={note} onChange={(e) => { setNote(e.target.value); }} maxLength={280} />
          </Field>
        </div>
      </Modal>

      <ConfirmMoneyDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); }}
        onConfirm={() => { mutation.mutate(); }}
        title="Confirm recharge"
        description={`Load ${playerUsername}'s wallet from your balance.`}
        loading={mutation.isPending}
        confirmLabel="Recharge"
        deltas={[
          {
            label: "Your balance",
            currency: OPERATOR_CURRENCY,
            beforeMinor: agentBefore.toString(),
            afterMinor: (agentBefore - amount).toString(),
          },
        ]}
      />
    </>
  );
}
