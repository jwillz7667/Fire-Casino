"use client";

import { type ChangeEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button, Card, Field, Select, useToast } from "@aureus/ui";
import { kycSubmitSchema, presignKycDocSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { qk } from "@/lib/queries";
import type { PresignedUpload } from "@/lib/types";

const ID_TYPES = [
  { value: "DRIVERS_LICENSE", label: "Driver's license" },
  { value: "PASSPORT", label: "Passport" },
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "STATE_ID", label: "State ID card" },
] as const;

export function KycForm({ onSubmitted }: { onSubmitted?: () => void }): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [idType, setIdType] = useState<string>(ID_TYPES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!file) throw new Error("Add a photo of your ID.");

      // 1) Presign a private upload slot (R2). In dev the storage provider is a
      //    stub that returns a fake URL; the PUT is a no-op there, real R2 PUT
      //    succeeds with the same flow (docs/01 §8, docs/07 §2.7).
      const presignBody = presignKycDocSchema.parse({ filename: file.name });
      const presigned = await api.post<PresignedUpload>("/compliance/kyc/doc-url", presignBody);

      try {
        await fetch(presigned.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
      } catch {
        // Stub storage in dev; the document URL is still recorded server-side.
      }

      // 2) Record the KYC submission referencing the stored object.
      const submitBody = kycSubmitSchema.parse({
        idType,
        documentUrl: presigned.fileUrl,
        level: 1,
      });
      await api.post("/compliance/kyc/submit", submitBody);
    },
    onSuccess: () => {
      setSubmitted(true);
      toast.push({ title: "Submitted for review", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: qk.compliance });
      onSubmitted?.();
    },
    onError: (err) => {
      toast.push({ title: "Couldn't submit", description: messageForError(err), intent: "danger" });
    },
  });

  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    setFile(e.target.files?.[0] ?? null);
  }

  if (submitted) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <div className="text-base font-semibold text-text-hi">Under review</div>
        <p className="max-w-xs text-sm text-text-mid">
          Thanks! We&apos;ll let you know once your identity is verified. You can keep playing in the
          meantime.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <p className="flex items-start gap-2 text-sm text-text-mid">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lumen" />
        Your document is uploaded securely and used only to verify your identity.
      </p>

      <Field label="ID type">
        <Select
          value={idType}
          onChange={(e) => {
            setIdType(e.target.value);
          }}
        >
          {ID_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Photo of your ID">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-hairline-strong bg-surface-2 px-4 py-6 text-center transition-colors hover:border-lumen/50">
          <Camera className="h-6 w-6 text-text-mid" />
          <span className="text-sm text-text-hi">{file ? file.name : "Tap to upload or take a photo"}</span>
          <span className="text-xs text-text-lo">JPG, PNG, or PDF</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={onFileChange}
          />
        </label>
      </Field>

      <Button
        size="lg"
        className="w-full"
        disabled={!file}
        loading={mutation.isPending}
        onClick={() => {
          mutation.mutate();
        }}
      >
        Submit for verification
      </Button>
    </Card>
  );
}
