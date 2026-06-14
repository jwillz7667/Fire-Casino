import {
  operatorCurrency,
  type PlatformMode,
  redeemableCurrency,
  walletCurrencies,
} from "@aureus/shared";

// The platform legal model (OPERATOR single-credit vs COMPLIANCE sweeps) is a
// deploy-time decision (docs/03). The console reads it from a public env var so
// money framing (single CREDIT vs PLAY purchase + PRIZE bonus) renders right.
// Defaults to OPERATOR when unset.
export const PLATFORM_MODE: PlatformMode =
  process.env.NEXT_PUBLIC_PLATFORM_MODE === "COMPLIANCE" ? "COMPLIANCE" : "OPERATOR";

export const isComplianceMode = PLATFORM_MODE === "COMPLIANCE";

export const OPERATOR_CURRENCY = operatorCurrency(PLATFORM_MODE);
export const REDEEMABLE_CURRENCY = redeemableCurrency(PLATFORM_MODE);
export const WALLET_CURRENCIES = walletCurrencies(PLATFORM_MODE);
