"use client";

import { type ReactElement, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { resetPlayerPasswordSchema } from "@aureus/shared";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { CopyButton } from "@/components/copy-button";

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function ResetPasswordDialog({
  open,
  onClose,
  playerId,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
}): ReactElement {
  const toast = useToast();
  const [tempPassword, setTempPassword] = useState(generatePassword);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = resetPlayerPasswordSchema.safeParse({ tempPassword });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid password");
      return api.post<void>(`/players/${playerId}/reset-password`, parsed.data);
    },
    onSuccess: () => {
      setDone(true);
      toast.push({ title: "Password reset", intent: "success" });
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function close(): void {
    setTempPassword(generatePassword());
    setDone(false);
    setError(undefined);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Reset player password"
      footer={
        done ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => { setError(undefined); mutation.mutate(); }} loading={mutation.isPending}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-mid">Share the new temporary password — the player signs out everywhere.</p>
          <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-2 p-3">
            <code className="font-mono text-sm text-gold-light">{tempPassword}</code>
            <CopyButton value={tempPassword} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="New temporary password" required>
            <div className="flex gap-2">
              <Input value={tempPassword} onChange={(e) => { setTempPassword(e.target.value); }} className="font-mono" />
              <Button variant="secondary" type="button" onClick={() => { setTempPassword(generatePassword()); }}>
                <RefreshCw className="h-4 w-4" />
                New
              </Button>
            </div>
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
