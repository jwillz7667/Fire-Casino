"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, RegionBlockedState } from "@aureus/ui";
import { playerLoginSchema } from "@aureus/shared";
import { useAuth } from "@/lib/auth-context";
import { ERROR_CODES, isErrorCode, messageForError } from "@/lib/errors";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { BrandSpinner } from "@/components/shell/BrandSpinner";

const AGE_KEY = "aureus.age_confirmed";
const pwAckKey = (playerId: string): string => `aureus.pw_ack.${playerId}`;

type Phase = "login" | "force-pw";

export default function LoginPage(): React.ReactElement {
  const { ready, isAuthenticated, player, login } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("login");
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const [regionBlocked, setRegionBlocked] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAgeConfirmed(localStorage.getItem(AGE_KEY) === "1");
  }, []);

  // A restored session goes straight home (unless mid forced-change).
  useEffect(() => {
    if (ready && isAuthenticated && phase === "login") router.replace("/");
  }, [ready, isAuthenticated, phase, router]);

  async function handleLogin(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(undefined);

    const parsed = playerLoginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError("Enter your username and password.");
      return;
    }

    setBusy(true);
    try {
      const summary = await login(parsed.data);
      const firstLogin = localStorage.getItem(pwAckKey(summary.playerId)) !== "1";
      if (firstLogin) {
        setPhase("force-pw");
      } else {
        router.replace("/");
      }
    } catch (err) {
      if (isErrorCode(err, ERROR_CODES.REGION_BLOCKED)) {
        setRegionBlocked(true);
        return;
      }
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  function completeFirstLogin(): void {
    if (player) localStorage.setItem(pwAckKey(player.playerId), "1");
    router.replace("/");
  }

  if (regionBlocked) return <RegionBlockedState />;

  if (ageConfirmed === null || (ready && isAuthenticated && phase === "login")) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <BrandSpinner />
      </div>
    );
  }

  if (!ageConfirmed) {
    return (
      <AgeGate
        onConfirm={() => {
          localStorage.setItem(AGE_KEY, "1");
          setAgeConfirmed(true);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandLogo size="xl" glow priority />
        <h1 className="font-display text-4xl font-semibold text-gold-light">Goldwave Casino</h1>
        <p className="text-sm text-text-mid">
          {phase === "force-pw"
            ? "Welcome! Set a password you'll remember."
            : "Sign in with the account your agent set up."}
        </p>
      </div>

      <Card className="p-5">
        {phase === "force-pw" ? (
          <div className="flex flex-col gap-4">
            <ChangePasswordForm onChanged={completeFirstLogin} submitLabel="Save & continue" />
            <button
              type="button"
              onClick={completeFirstLogin}
              className="text-center text-xs text-text-lo underline-offset-2 hover:text-text-mid hover:underline"
            >
              Skip for now
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Field label="Username">
              <Input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                }}
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect="off"
                required
              />
            </Field>
            <Field label="Password" error={error}>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
            <p className="text-center text-xs text-text-lo">
              Forgot your password? Ask the agent who set up your account.
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}

function AgeGate({ onConfirm }: { onConfirm: () => void }): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandLogo size="xl" glow />
      <h1 className="font-display text-3xl font-semibold text-text-hi">Are you 21 or older?</h1>
      <p className="max-w-xs text-sm text-text-mid">
        You must be 21+ to play. By continuing you confirm you meet the age requirement in your
        area.
      </p>
      <div className="flex w-full flex-col gap-3">
        <Button size="lg" onClick={onConfirm} className="w-full">
          Yes, I&apos;m 21 or older
        </Button>
        <a
          href="https://www.google.com"
          className="text-sm text-text-lo underline-offset-2 hover:text-text-mid hover:underline"
        >
          No, take me back
        </a>
      </div>
    </div>
  );
}
