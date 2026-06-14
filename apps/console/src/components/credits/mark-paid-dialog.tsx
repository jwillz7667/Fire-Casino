"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { markOrderPaidSchema } from "@aureus/shared";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { CreditOrder } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { uploadViaPresign } from "@/lib/upload";

/** Seller records that offline cash for an order was received (docs/06 §3.5 inbox). */
export function MarkPaidDialog({
  open,
  onClose,
  orderId,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [proofUrl, setProofUrl] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = markOrderPaidSchema.safeParse({
        paymentMethod,
        paymentRef: paymentRef === "" ? undefined : paymentRef,
        proofUrl,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      return api.post<CreditOrder>(`/orders/${orderId}/mark-paid`, parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Order marked paid", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      reset();
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function reset(): void {
    setPaymentMethod("");
    setPaymentRef("");
    setProofUrl(undefined);
    setError(undefined);
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    try {
      setProofUrl(await uploadViaPresign("/orders/proof-url", file));
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
      title="Mark order paid"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            disabled={paymentMethod.trim() === ""}
            onClick={() => { setError(undefined); mutation.mutate(); }}
            loading={mutation.isPending}
          >
            Mark paid
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Payment method" required>
          <Input value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); }} maxLength={40} />
        </Field>
        <Field label="Reference" hint="Optional">
          <Input value={paymentRef} onChange={(e) => { setPaymentRef(e.target.value); }} maxLength={120} />
        </Field>
        <Field label="Proof" hint={proofUrl ? "Attached." : "Optional"}>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-hairline bg-surface-3 px-3 py-2 text-sm text-text-mid hover:text-text-hi">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : proofUrl ? "Replace file" : "Choose file"}
            <input type="file" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); }} />
          </label>
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
