import {
  type Currency,
  operatorCurrency,
  type PlatformMode,
  redeemableCurrency,
} from "@aureus/shared";
import type { WalletBalance } from "./types";

/**
 * The arcade infers the platform mode from the player's wallet currencies:
 * COMPLIANCE wallets carry PLAY + PRIZE, OPERATOR wallets carry a single CREDIT
 * (docs/03 §2). No extra endpoint needed — the wallet shape is authoritative.
 */
export function detectMode(wallets: Pick<WalletBalance, "currency">[]): PlatformMode {
  return wallets.some((w) => w.currency === "PRIZE") ? "COMPLIANCE" : "OPERATOR";
}

/** The currency a player spends to play (PLAY in compliance, CREDIT otherwise). */
export function spendCurrency(mode: PlatformMode): Currency {
  return operatorCurrency(mode);
}

/** The redeemable currency (PRIZE in compliance, CREDIT otherwise). */
export function cashoutCurrency(mode: PlatformMode): Currency {
  return redeemableCurrency(mode);
}

const LABELS: Record<Currency, string> = {
  PLAY: "Play",
  PRIZE: "Prize",
  CREDIT: "Credit",
};

export function currencyLabel(currency: Currency): string {
  return LABELS[currency];
}

export function balanceFor(wallets: WalletBalance[], currency: Currency): string {
  return wallets.find((w) => w.currency === currency)?.balanceMinor ?? "0";
}
