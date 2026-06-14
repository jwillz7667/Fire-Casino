"use client";

import { cn, Money } from "@aureus/ui";
import { type Currency, MINOR } from "@aureus/shared";

const PACKAGE_CREDITS = [5, 10, 20, 50, 100, 200] as const;

/** Quick recharge package tiers (docs/07 §2.4). Amounts are whole credits. */
export function PackageTiles({
  currency,
  selected,
  onSelect,
}: {
  currency: Currency;
  selected: bigint | undefined;
  onSelect: (amountMinor: bigint) => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PACKAGE_CREDITS.map((credits) => {
        const amountMinor = BigInt(credits) * MINOR;
        const isSelected = selected === amountMinor;
        return (
          <button
            key={credits}
            type="button"
            onClick={() => {
              onSelect(amountMinor);
            }}
            className={cn(
              "flex items-center justify-center rounded-md border px-2 py-3 text-sm font-semibold transition-colors",
              isSelected
                ? "border-gold/50 bg-gold/15 text-gold-light"
                : "border-hairline bg-surface-2 text-text-hi hover:border-gold/30",
            )}
          >
            <Money valueMinor={amountMinor} currency={currency} size="sm" />
          </button>
        );
      })}
    </div>
  );
}
