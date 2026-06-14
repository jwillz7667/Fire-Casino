"use client";

import { type ReactElement, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { operatorLoginSchema } from "@aureus/shared";
import { Button, Card, CoinMark, Field, Input } from "@aureus/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const { status, login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const mutation = useMutation({
    mutationFn: () =>
      login({
        identifier,
        password,
        totp: totp.trim() === "" ? undefined : totp.trim(),
      }),
    onSuccess: () => {
      router.replace("/");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") {
        setMfaNeeded(true);
        setError("Enter your authenticator code to continue.");
        return;
      }
      setError(errorMessage(err));
    },
  });

  function submit(): void {
    setError(undefined);
    const parsed = operatorLoginSchema.safeParse({
      identifier,
      password,
      totp: totp.trim() === "" ? undefined : totp.trim(),
    });
    if (!parsed.success) {
      setError("Enter your username and password.");
      return;
    }
    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <CoinMark size="xl" glow />
          <h1 className="font-display text-3xl font-semibold text-text-hi">Goldwave Console</h1>
          <p className="text-sm text-text-mid">Sign in to your operator account.</p>
        </div>

        <Card className="p-6">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Username or email" required>
              <Input
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                }}
                autoComplete="username"
                autoFocus
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                autoComplete="current-password"
              />
            </Field>
            {mfaNeeded ? (
              <Field label="Authenticator code" required hint="6-digit code from your app.">
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
                  autoFocus
                />
              </Field>
            ) : null}

            {error ? <p className="text-sm text-danger">{error}</p> : null}

            <Button type="submit" size="lg" loading={mutation.isPending} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
