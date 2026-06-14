"use client";

import { type ReactElement, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, ShieldCheck, UserCircle2 } from "lucide-react";
import { Badge, Modal } from "@aureus/ui";
import { useAuth } from "@/lib/auth-context";
import { humanize } from "@/lib/format";
import { ChangePasswordDialog } from "@/components/account/change-password-dialog";
import { MfaEnrollment } from "@/components/account/mfa-enrollment";

export function AccountMenu(): ReactElement {
  const router = useRouter();
  const { principal, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);

  if (!principal) return <></>;

  const initials = principal.displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-lumen/70"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-gold-light">
          {initials || <UserCircle2 className="h-5 w-5" />}
        </span>
        <span className="hidden flex-col leading-tight sm:flex">
          <span className="text-sm font-medium text-text-hi">{principal.displayName}</span>
          <span className="text-[0.6875rem] text-text-lo">{humanize(principal.tier)}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-text-lo" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => { setOpen(false); }} />
          <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-md border border-hairline-strong bg-surface-1 shadow-2xl">
            <div className="border-b border-hairline px-4 py-3">
              <div className="text-sm font-medium text-text-hi">{principal.displayName}</div>
              <div className="text-xs text-text-lo">@{principal.username}</div>
              <div className="mt-2 flex items-center gap-1.5">
                <Badge intent="gold">{humanize(principal.tier)}</Badge>
                {principal.mfaEnabled ? (
                  <Badge intent="success">2FA on</Badge>
                ) : (
                  <Badge intent="warning">2FA off</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-col py-1">
              <MenuButton
                icon={<KeyRound className="h-4 w-4" />}
                label="Change password"
                onClick={() => {
                  setOpen(false);
                  setPwOpen(true);
                }}
              />
              {!principal.mfaEnabled ? (
                <MenuButton
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Enable two-factor"
                  onClick={() => {
                    setOpen(false);
                    setMfaOpen(true);
                  }}
                />
              ) : null}
              <MenuButton
                icon={<LogOut className="h-4 w-4" />}
                label="Sign out"
                onClick={() => {
                  setOpen(false);
                  void logout().then(() => {
                    router.push("/login");
                  });
                }}
              />
            </div>
          </div>
        </>
      ) : null}

      <ChangePasswordDialog open={pwOpen} onClose={() => { setPwOpen(false); }} />
      <Modal open={mfaOpen} onClose={() => { setMfaOpen(false); }} title="Two-factor authentication">
        <MfaEnrollment onComplete={() => { setMfaOpen(false); }} />
      </Modal>
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2 text-sm text-text-mid transition-colors hover:bg-surface-3 hover:text-text-hi"
    >
      {icon}
      {label}
    </button>
  );
}
