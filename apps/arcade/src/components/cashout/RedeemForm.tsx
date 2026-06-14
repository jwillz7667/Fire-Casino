"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpFromLine, ShieldAlert } from "lucide-react";
import {
  Button,
  Card,
  ConfirmMoneyDialog,
  Field,
  Money,
  MoneyInput,
  SectionTitle,
  Select,
  useToast,
} from "@aureus/ui";
import { type Currency, createRedemptionSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { ERROR_CODES, isErrorCode, messageForError } from "@/lib/errors";
import { newIdempotencyKey } from "@/lib/idempotency";
import { currencyLabel } from "@/lib/mode";
import { qk } from "@/lib/queries";
import type { RedemptionDTO } from "@/lib/types";

const METHODS = [
  { value: "CASH", label: "Cash (in person)" },
  { value: "CASHAPP", label: "Cash App" },
  { value: "VENMO", label: "Venmo" },
  { value: "ZELLE", label: "Zelle" },
  { value: "PAYPAL", label: "PayPal" },
  { value: "BANK", label: "Bank transfer" },
] as const;

export function RedeemForm({
  currency,
  redeemableMinor,
  minMinor,
  kycRequired,
}: {
  currency: Currency;
  redeemableMinor: string;
  minMinor: bigint;
  kycRequired: boolean;
}): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [method, setMethod] = useState<string>(METHODS[0].value);
  const [details, setDetails] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [needsKyc, setNeedsKyc] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  const redeemable = BigInt(redeemableMinor);

  const mutation = useMutation({
    mutationFn: (): Promise<RedemptionDTO> => {
      const body = createRedemptionSchema.parse({
        amountMinor: amountMinor?.toString(),
        method,
        payoutDetails: details.trim() ? { details: details.trim() } : undefined,
      });
      return api.post<RedemptionDTO>("/redemptions", body, { idempotencyKey });
    },
    onSuccess: () => {
      toast.push({ title: "Cash out requested", description: "We'll update you as it's reviewed.", intent: "success" });
      setAmountMinor(undefined);
      setDetails("");
      setConfirmOpen(false);
      setIdempotencyKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: qk.redemptions });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (err) => {
      setConfirmOpen(false);
      if (isErrorCode(err, ERROR_CODES.KYC_REQUIRED)) {
        setNeedsKyc(true);
        return;
      }
      toast.push({ title: "Couldn't request cash out", description: messageForError(err), intent: "danger" });
    },
  });

  const tooLow = amountMinor !== undefined && amountMinor < minMinor;
  const tooHigh = amountMinor !== undefined && amountMinor > redeemable;
  const canSubmit = amountMinor !== undefined && !tooLow && !tooHigh && method.length >= 2;
  const after = amountMinor !== undefined ? (redeemable - amountMinor).toString() : redeemableMinor;

  if (kycRequired || needsKyc) {
    return <KycPrompt />;
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionTitle>Request cash out</SectionTitle>

      <div className="flex items-center justify-between text-xs text-text-mid">
        <span>Minimum</span>
        <Money valueMinor={minMinor} currency={currency} size="sm" />
      </div>

      <Field
        label={`Amount (${currencyLabel(currency)})`}
        error={tooHigh ? "More than your redeemable balance." : tooLow ? "Below the minimum." : undefined}
      >
        <MoneyInput
          valueMinor={amountMinor}
          onChangeMinor={setAmountMinor}
          currency={currency}
          minMinor={minMinor}
          maxMinor={redeemable}
        />
      </Field>

      <Field label="Payout method">
        <Select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
          }}
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Payout details (optional)" hint="How your agent should reach you to pay out.">
        <input
          value={details}
          maxLength={280}
          placeholder="e.g. $handle, phone, or account"
          onChange={(e) => {
            setDetails(e.target.value);
          }}
          className="w-full rounded-sm border border-hairline bg-surface-3 px-3 py-2 text-sm text-text-hi placeholder:text-text-lo outline-none focus:border-lumen/60 focus:ring-2 focus:ring-lumen/30"
        />
      </Field>

      <Button
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={() => {
          setIdempotencyKey(newIdempotencyKey());
          setConfirmOpen(true);
        }}
      >
        <ArrowUpFromLine className="h-4 w-4" />
        Request cash out
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
        title="Request cash out"
        description="This reserves the amount while your request is reviewed. You can withdraw it while it's still pending."
        confirmLabel="Request"
        deltas={[
          { label: "Redeemable (while pending)", currency, beforeMinor: redeemableMinor, afterMinor: after },
        ]}
      />
    </Card>
  );
}

function KycPrompt(): React.ReactElement {
  return (
    <Card className="flex flex-col items-center gap-3 p-5 text-center">
      <ShieldAlert className="h-8 w-8 text-warning" />
      <div className="text-base font-semibold text-text-hi">Verify your identity first</div>
      <p className="max-w-xs text-sm text-text-mid">
        Cashing out requires a quick identity check. It only takes a minute.
      </p>
      <Link href="/kyc" className="w-full">
        <Button size="lg" className="w-full">
          Start verification
        </Button>
      </Link>
    </Card>
  );
}
