"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Info } from "lucide-react";
import {
  Button,
  Card,
  ConfirmMoneyDialog,
  Field,
  MoneyInput,
  SectionTitle,
  Textarea,
  useToast,
} from "@aureus/ui";
import { rechargeRequestSchema } from "@aureus/shared";
import { useAuth } from "@/lib/auth-context";
import { useWallet } from "@/lib/hooks";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { newIdempotencyKey } from "@/lib/idempotency";
import { balanceFor, currencyLabel, spendCurrency } from "@/lib/mode";
import { qk } from "@/lib/queries";
import type { RechargeRequestResponse } from "@/lib/types";
import { PackageTiles } from "./PackageTiles";

/**
 * Request a recharge from the agent (docs/07 §2.4). There is NO card/checkout
 * UI anywhere — loading credits is always a request the agent fulfills offline.
 */
export function RechargeRequestForm(): React.ReactElement {
  const { mode } = useAuth();
  const currency = spendCurrency(mode);
  const wallet = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  const before = wallet.data ? balanceFor(wallet.data.wallets, currency) : "0";

  const mutation = useMutation({
    mutationFn: (): Promise<RechargeRequestResponse> => {
      const body = rechargeRequestSchema.parse({
        amountMinor: amountMinor?.toString(),
        note: note.trim() || undefined,
      });
      return api.post<RechargeRequestResponse>("/wallet/recharge-request", body, {
        idempotencyKey,
      });
    },
    onSuccess: () => {
      toast.push({
        title: "Recharge requested",
        description: "Your agent has been notified. Credits arrive once payment is confirmed.",
        intent: "success",
      });
      setAmountMinor(undefined);
      setNote("");
      setConfirmOpen(false);
      setIdempotencyKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.walletHistory });
    },
    onError: (err) => {
      toast.push({ title: "Couldn't send request", description: messageForError(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  function openConfirm(): void {
    if (amountMinor === undefined || amountMinor <= 0n) return;
    setIdempotencyKey(newIdempotencyKey());
    setConfirmOpen(true);
  }

  const after = amountMinor !== undefined ? (BigInt(before) + amountMinor).toString() : before;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionTitle>Load credits</SectionTitle>

      <PackageHint />

      <PackageTiles currency={currency} selected={amountMinor} onSelect={setAmountMinor} />

      <Field label={`Amount (${currencyLabel(currency)})`}>
        <MoneyInput valueMinor={amountMinor} onChangeMinor={setAmountMinor} currency={currency} />
      </Field>

      <Field label="Note for your agent (optional)">
        <Textarea
          value={note}
          maxLength={280}
          placeholder="e.g. paid via cash app"
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </Field>

      <OfflineInstructions />

      <Button
        size="lg"
        className="w-full"
        disabled={amountMinor === undefined || amountMinor <= 0n}
        onClick={openConfirm}
      >
        <HandCoins className="h-4 w-4" />
        Request recharge
      </Button>

      <ConfirmMoneyDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          mutation.mutate();
        }}
        loading={mutation.isPending}
        title="Request recharge"
        description={
          mode === "COMPLIANCE"
            ? "You're requesting PLAY credits. A PRIZE bonus is added when your agent confirms payment."
            : "Your agent collects payment offline, then loads your balance."
        }
        confirmLabel="Send request"
        deltas={[
          { label: `${currencyLabel(currency)} (after agent confirms)`, currency, beforeMinor: before, afterMinor: after },
        ]}
      />
    </Card>
  );
}

function PackageHint(): React.ReactElement {
  return (
    <p className="text-xs text-text-mid">
      Pick an amount below or enter your own, then send the request to your agent.
    </p>
  );
}

function OfflineInstructions(): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-xs text-text-mid">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-lumen" />
      <span>
        Payment is handled directly with your agent (cash or their app) — never in this app. Once
        they confirm, your balance updates here automatically.
      </span>
    </div>
  );
}
