"use client";

import { Badge, Money } from "@aureus/ui";
import type { Currency } from "@aureus/shared";
import type { BetResponse } from "@/lib/types";

/**
 * Honest, generic outcome render (docs/07 §2.3): win/loss + amount, marked
 * demo. The client never computes the result — it renders what the server
 * returned.
 */
export function OutcomeDisplay({
  result,
  currency,
}: {
  result: BetResponse | null;
  currency: Currency;
}): React.ReactElement {
  if (!result) {
    return (
      <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-1 text-center">
        <span className="text-sm text-text-mid">Place a bet and tap Play.</span>
      </div>
    );
  }

  const win = BigInt(result.round.winMinor);
  const isWin = win > 0n;
  const demo = result.round.outcome.demo === true;

  return (
    <div
      className={`flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-lg border text-center transition-colors ${
        isWin ? "border-gold/50 bg-gold/10" : "border-hairline bg-surface-1"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-text-lo">
          {isWin ? "You won" : "No win this round"}
        </span>
        {demo ? <Badge intent="info">Demo</Badge> : null}
      </div>

      {isWin ? (
        <Money
          valueMinor={result.round.winMinor}
          currency={currency}
          signed
          size="xl"
          className="motion-safe:animate-[slideIn_240ms_ease-out]"
        />
      ) : (
        <span className="font-display text-3xl text-text-mid">—</span>
      )}

      <div className="flex items-center gap-3 text-xs text-text-mid">
        <span>
          Bet <Money valueMinor={result.round.betMinor} currency={currency} size="sm" />
        </span>
        <span className="text-text-lo">·</span>
        <span>Round #{result.round.nonce}</span>
      </div>
    </div>
  );
}
