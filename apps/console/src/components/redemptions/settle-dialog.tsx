"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { settleRedemptionSchema } from "@aureus/shared";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { RedemptionDto } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { uploadViaPresign } from "@/lib/upload";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

/** Record an offline payout and drain clearing → mint (docs/06 §3.8). */
export function SettleDialog({
  open,
  onClose,
  redemptionId,
}: {
  open: boolean;
  onClose: () => void;
  redemptionId: string;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const idempotencyKey = useIdempotencyKey(open);
  const [payoutRef, setPayoutRef] = useState("");
  const [proofUrl, setProofUrl] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = settleRedemptionSchema.safeParse({ payoutRef, proofUrl });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      return api.post<RedemptionDto>(`/redemptions/${redemptionId}/settle`, parsed.data, { idempotencyKey });
    },
    onSuccess: () => {
      toast.push({ title: "Redemption settled", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["redemption", redemptionId] });
      void queryClient.invalidateQueries({ queryKey: ["redemptions"] });
      reset();
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function reset(): void {
    setPayoutRef("");
    setProofUrl(undefined);
    setError(undefined);
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    try {
      setProofUrl(await uploadViaPresign("/redemptions/proof-url", file));
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
      title="Mark redemption paid"
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button
            disabled={payoutRef.trim() === ""}
            onClick={() => { setError(undefined); mutation.mutate(); }}
            loading={mutation.isPending}
          >
            Confirm payout
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-mid">Records the offline cash payout and removes the credits from circulation.</p>
        <Field label="Payout reference" required>
          <Input value={payoutRef} onChange={(e) => { setPayoutRef(e.target.value); }} maxLength={120} />
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
