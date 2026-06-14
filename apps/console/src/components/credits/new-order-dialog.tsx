"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { createOrderSchema } from "@aureus/shared";
import { Button, Field, Input, Modal, MoneyInput, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { CreditOrder } from "@/lib/types";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { uploadViaPresign } from "@/lib/upload";

/** Request credits from the upline (docs/06 §3.5 outbox), with optional proof. */
export function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<bigint | undefined>();
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [proofUrl, setProofUrl] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = createOrderSchema.safeParse({
        quantityMinor: (amountMinor ?? 0n).toString(),
        note: note === "" ? undefined : note,
        paymentMethod: paymentMethod === "" ? undefined : paymentMethod,
        proofUrl,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid order");
      return api.post<CreditOrder>("/orders", { ...parsed.data, quantityMinor: (amountMinor ?? 0n).toString() });
    },
    onSuccess: () => {
      toast.push({ title: "Order requested", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      reset();
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function reset(): void {
    setAmountMinor(undefined);
    setNote("");
    setPaymentMethod("");
    setProofUrl(undefined);
    setError(undefined);
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadViaPresign("/orders/proof-url", file);
      setProofUrl(url);
      toast.push({ title: "Proof uploaded", intent: "success" });
    } catch (err) {
      toast.push({ title: "Upload failed", description: errorMessage(err), intent: "danger" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Request credits from upline"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            disabled={(amountMinor ?? 0n) <= 0n}
            onClick={() => { setError(undefined); mutation.mutate(); }}
            loading={mutation.isPending}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Quantity" required>
          <MoneyInput valueMinor={amountMinor} onChangeMinor={setAmountMinor} currency={OPERATOR_CURRENCY} />
        </Field>
        <Field label="Payment method" hint="How you paid your upline offline">
          <Input value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); }} maxLength={40} />
        </Field>
        <Field label="Note" hint="Optional">
          <Input value={note} onChange={(e) => { setNote(e.target.value); }} maxLength={280} />
        </Field>
        <Field label="Payment proof" hint={proofUrl ? "Attached." : "Optional image/PDF"}>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-hairline bg-surface-3 px-3 py-2 text-sm text-text-mid hover:text-text-hi">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : proofUrl ? "Replace file" : "Choose file"}
            <input
              type="file"
              className="hidden"
              onChange={(e) => { void onFile(e.target.files?.[0]); }}
            />
          </label>
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
