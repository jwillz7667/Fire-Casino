"use client";

import { type ReactElement, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Field, Input, Panel, SectionTitle, useToast } from "@aureus/ui";
import { mfaConfirmSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";
import { CopyButton } from "@/components/copy-button";

interface MfaEnableResult {
  secret: string;
  otpauthUrl: string;
}

/**
 * TOTP enrollment: request a secret, show it for an authenticator app, confirm
 * with a code. Used both for forced enrollment (SUPER_ADMIN/ADMIN) and the
 * optional account-menu path. Calls reload() so requiresMfaEnrollment clears.
 */
export function MfaEnrollment({ onComplete }: { onComplete?: () => void }): ReactElement {
  const toast = useToast();
  const { reload } = useAuth();
  const [secret, setSecret] = useState<MfaEnableResult | null>(null);
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | undefined>();

  const enable = useMutation({
    mutationFn: () => api.post<MfaEnableResult>("/auth/operator/mfa/enable"),
    onSuccess: (data) => {
      setSecret({ secret: data.secret, otpauthUrl: data.otpauthUrl });
    },
    onError: (err) => {
      toast.push({ title: "Couldn't start enrollment", description: errorMessage(err), intent: "danger" });
    },
  });

  const confirm = useMutation({
    mutationFn: () => api.post<void>("/auth/operator/mfa/confirm", { totp }),
    onSuccess: async () => {
      toast.push({ title: "Two-factor enabled", intent: "success" });
      await reload();
      onComplete?.();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function submitConfirm(): void {
    setError(undefined);
    const parsed = mfaConfirmSchema.safeParse({ totp });
    if (!parsed.success) {
      setError("Enter the 6-digit code from your authenticator.");
      return;
    }
    confirm.mutate();
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionTitle>Two-factor authentication</SectionTitle>
        <p className="text-sm text-text-mid">
          Add a time-based code from an authenticator app to protect privileged actions.
        </p>
      </div>

      {!secret ? (
        <Button onClick={() => { enable.mutate(); }} loading={enable.isPending}>
          Begin enrollment
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-2 p-3">
            <span className="text-xs uppercase tracking-wide text-text-lo">Secret key</span>
            <div className="flex items-center justify-between gap-2">
              <code className="break-all font-mono text-sm text-gold-light">{secret.secret}</code>
              <CopyButton value={secret.secret} />
            </div>
            <span className="mt-1 text-xs text-text-lo">
              Or add via URL:&nbsp;
              <code className="break-all text-text-mid">{secret.otpauthUrl}</code>
            </span>
          </div>

          <Field label="Verification code" required error={error}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totp}
              maxLength={8}
              placeholder="123456"
              onChange={(e) => {
                setTotp(e.target.value.replace(/\D/g, ""));
              }}
              className="font-mono tracking-[0.3em]"
            />
          </Field>
          <Button onClick={submitConfirm} loading={confirm.isPending}>
            Confirm &amp; enable
          </Button>
        </div>
      )}
    </Panel>
  );
}
