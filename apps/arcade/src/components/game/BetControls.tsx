"use client";

import { useMemo } from "react";
import { Button, cn, Money, MoneyInput } from "@aureus/ui";
import type { Currency } from "@aureus/shared";

/** Bet amount selector (within game min/max) + the Play button (docs/07 §2.3). */
export function BetControls({
  currency,
  minMinor,
  maxMinor,
  balanceMinor,
  betMinor,
  onBetChange,
  onPlay,
  playing,
  disabled,
}: {
  currency: Currency;
  minMinor: bigint;
  maxMinor: bigint;
  balanceMinor: bigint;
  betMinor: bigint | undefined;
  onBetChange: (next: bigint | undefined) => void;
  onPlay: () => void;
  playing: boolean;
  disabled: boolean;
}): React.ReactElement {
  const quickAmounts = useMemo(() => {
    const candidates = [minMinor, minMinor * 2n, minMinor * 5n, minMinor * 10n, maxMinor];
    const seen = new Set<string>();
    const out: bigint[] = [];
    for (const c of candidates) {
      const clamped = c > maxMinor ? maxMinor : c;
      const key = clamped.toString();
      if (clamped >= minMinor && clamped <= maxMinor && !seen.has(key)) {
        seen.add(key);
        out.push(clamped);
      }
    }
    return out;
  }, [minMinor, maxMinor]);

  const tooLow = betMinor !== undefined && betMinor < minMinor;
  const tooHigh = betMinor !== undefined && betMinor > maxMinor;
  const insufficient = betMinor !== undefined && betMinor > balanceMinor;
  const canPlay = betMinor !== undefined && !tooLow && !tooHigh && !insufficient && !disabled;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-text-mid">
        <span>
          Bet range <Money valueMinor={minMinor} currency={currency} size="sm" /> –{" "}
          <Money valueMinor={maxMinor} currency={currency} size="sm" />
        </span>
      </div>

      <MoneyInput
        valueMinor={betMinor}
        onChangeMinor={onBetChange}
        currency={currency}
        minMinor={minMinor}
        maxMinor={maxMinor}
        disabled={disabled}
      />

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickAmounts.map((amount) => (
          <button
            key={amount.toString()}
            type="button"
            disabled={disabled}
            onClick={() => {
              onBetChange(amount);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              betMinor === amount
                ? "border-gold/40 bg-gold/15 text-gold-light"
                : "border-hairline bg-surface-2 text-text-mid hover:text-text-hi",
              disabled && "opacity-50",
            )}
          >
            <Money valueMinor={amount} currency={currency} size="sm" />
          </button>
        ))}
      </div>

      {insufficient ? (
        <p className="text-xs text-danger">Not enough balance for that bet.</p>
      ) : null}

      <Button size="lg" onClick={onPlay} loading={playing} disabled={!canPlay} className="w-full">
        Play
      </Button>
    </div>
  );
}
