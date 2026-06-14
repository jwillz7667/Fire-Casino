"use client";

import { type ReactElement, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { passwordChangeSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

export function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => api.post<void>("/auth/password/change", { currentPassword, newPassword }),
    onSuccess: () => {
      toast.push({ title: "Password changed", intent: "success" });
      reset();
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function reset(): void {
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setError(undefined);
  }

  function submit(): void {
    setError(undefined);
    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    const parsed = passwordChangeSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Change password"
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
          <Button onClick={submit} loading={mutation.isPending}>
            Update password
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Current password" required>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
            }}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" required hint="At least 8 characters.">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
            }}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" required error={error}>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </Modal>
  );
}
