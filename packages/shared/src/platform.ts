import { type PlatformMode } from "./env";
import { type Currency } from "./enums";

/**
 * The currency operators transact in. OPERATOR mode uses the single fungible
 * CREDIT; COMPLIANCE mode uses PLAY (entertainment) — PRIZE lives only in player
 * wallets and clearing (docs/03 §2).
 */
export function operatorCurrency(mode: PlatformMode): Currency {
  return mode === "COMPLIANCE" ? "PLAY" : "CREDIT";
}

/**
 * The redeemable currency. OPERATOR mode redeems CREDIT; COMPLIANCE mode redeems
 * only PRIZE (docs/03 §4.5).
 */
export function redeemableCurrency(mode: PlatformMode): Currency {
  return mode === "COMPLIANCE" ? "PRIZE" : "CREDIT";
}
