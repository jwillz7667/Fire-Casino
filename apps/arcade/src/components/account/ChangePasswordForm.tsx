"use client";

import { type FormEvent, useState } from "react";
import { Button, Field, Input, useToast } from "@aureus/ui";
import { passwordChangeSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";

/** Change password (docs/07 §2.6). Reused for the first-login forced change. */
export function ChangePasswordForm({
  onChanged,
  submitLabel = "Update password",
}: {
  onChanged?: () => void;
  submitLabel?: string;
}): React.ReactElement {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(undefined);

    if (newPassword !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    const parsed = passwordChangeSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      await api.post("/auth/password/change", parsed.data);
      toast.push({ title: "Password updated", intent: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      onChanged?.();
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Current password">
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
          }}
          required
        />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
          }}
          required
        />
      </Field>
      <Field label="Confirm new password" error={error}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
          }}
          required
        />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
