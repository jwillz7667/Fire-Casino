import { clsx, type ClassValue } from "clsx";

/** Conditional className composer used across the design system. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// The component library (Money, CoinMark, BalanceChip, DataTable,
// ConfirmMoneyDialog, ...) is built in Phase 11 on these tokens (theme.css).
export const UI_THEMES = ["console", "arcade"] as const;
export type UiTheme = (typeof UI_THEMES)[number];
