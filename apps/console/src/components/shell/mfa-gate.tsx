"use client";

import type { ReactElement } from "react";
import { MfaEnrollment } from "@/components/account/mfa-enrollment";
import { BrandLogo } from "./brand-logo";

/** Forced two-factor enrollment for tiers that require it before privileged use. */
export function MfaGate(): ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandLogo size="xl" glow priority />
          <h1 className="font-display text-2xl font-semibold text-text-hi">Secure your account</h1>
          <p className="text-sm text-text-mid">
            Your role requires two-factor authentication before you can continue.
          </p>
        </div>
        <MfaEnrollment />
      </div>
    </div>
  );
}
