"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Money } from "@aureus/ui";
import {
  isPhoenixOutcome,
  PHOENIX_HIGH_SYMBOLS,
  PHOENIX_SYMBOLS,
  type Currency,
  type PhoenixGrid,
  type PhoenixOutcome,
  type PhoenixSpinResult,
  type PhoenixSymbol,
} from "@aureus/shared";
import type { BetResponse } from "@/lib/types";

const ASSET_BASE = "/games/phoenix-ascendant";
const REELS = 5;
const ROWS = 3;
const SPIN_MS = 520; // base reel settle time; each reel is staggered after it
const REEL_STAGGER_MS = 140;

function symbolSrc(sym: PhoenixSymbol): string {
  return `${ASSET_BASE}/symbols/${sym}.png`;
}

function isHigh(sym: PhoenixSymbol): boolean {
  return (PHOENIX_HIGH_SYMBOLS as readonly string[]).includes(sym);
}

/** A pleasant, deterministic idle board so the reels aren't blank before a spin. */
const IDLE_GRID: PhoenixGrid = [
  ["GOLD", "CREST", "TEAL"],
  ["EMBER", "TALON", "VIOLET"],
  ["SCATTER", "EGG", "GOLD"],
  ["TEAL", "FEATHER", "EMBER"],
  ["VIOLET", "CREST", "TEAL"],
];

function randomSymbol(): PhoenixSymbol {
  // Math.random only drives the cosmetic spin blur — the board that lands is the
  // server's. The outcome is never decided on the client.
  const i = Math.floor(Math.random() * PHOENIX_SYMBOLS.length);
  return PHOENIX_SYMBOLS[i] ?? "VIOLET";
}

function randomGrid(): PhoenixGrid {
  return Array.from({ length: REELS }, () =>
    Array.from({ length: ROWS }, () => randomSymbol()),
  );
}

/** "reel:row" keys of cells that are part of a win, for the glow highlight. */
function winningCells(spin: PhoenixSpinResult): Set<string> {
  const cells = new Set<string>();
  for (const w of spin.waysWins) {
    for (let reel = 0; reel < w.count; reel++) {
      spin.grid[reel]?.forEach((s, row) => {
        if (s === w.symbol) cells.add(`${reel}:${row}`);
      });
    }
  }
  if (spin.scatterCount >= 3) {
    spin.grid.forEach((col, reel) =>
      col.forEach((s, row) => {
        if (s === "SCATTER") cells.add(`${reel}:${row}`);
      }),
    );
  }
  return cells;
}

function Cell({
  sym,
  win,
  spinning,
}: {
  sym: PhoenixSymbol;
  win: boolean;
  spinning: boolean;
}): React.ReactElement {
  return (
    <div
      className={`relative flex aspect-square items-center justify-center rounded-md border transition-all duration-200 ${
        win
          ? "border-gold bg-gold/15 shadow-[0_0_18px_-2px] shadow-gold/60"
          : isHigh(sym)
            ? "border-hairline bg-abyss/60"
            : "border-hairline bg-abyss/40"
      } ${spinning ? "motion-safe:blur-[1.5px]" : ""}`}
    >
      <img
        src={symbolSrc(sym)}
        alt={sym}
        draggable={false}
        className={`h-[82%] w-[82%] select-none object-contain transition-transform ${
          win ? "motion-safe:animate-[slideIn_240ms_ease-out] scale-105" : ""
        }`}
      />
      {win ? <span className="absolute inset-0 rounded-md ring-1 ring-gold/70" /> : null}
    </div>
  );
}

/**
 * Phoenix Ascendant reel view. Renders ONLY what the server returned: the cosmetic
 * blur cycles random symbols while the bet is in flight, then every reel settles to
 * the authoritative base grid with a left-to-right stagger; wins glow, and the
 * scatter / free-spins / ORB-multiplier detail is summarised below.
 */
export function PhoenixSlot({
  result,
  currency,
  spinning,
}: {
  result: BetResponse | null;
  currency: Currency;
  spinning: boolean;
}): React.ReactElement {
  const outcome: PhoenixOutcome | null =
    result && isPhoenixOutcome(result.round.outcome) ? result.round.outcome : null;

  const [board, setBoard] = useState<PhoenixGrid>(IDLE_GRID);
  const [settledReels, setSettledReels] = useState(REELS); // reels that have stopped
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastNonceRef = useRef<number | null>(null);

  function clearTimers(): void {
    if (cycleRef.current) clearInterval(cycleRef.current);
    cycleRef.current = null;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  // Cosmetic spin while the request is in flight.
  useEffect(() => {
    if (!spinning) return;
    setSettledReels(0);
    cycleRef.current = setInterval(() => {
      setBoard(randomGrid());
    }, 70);
    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current);
      cycleRef.current = null;
    };
  }, [spinning]);

  // Settle to the server's board when a new round resolves.
  useEffect(() => {
    if (!outcome || !result) return;
    if (lastNonceRef.current === result.round.nonce) return;
    lastNonceRef.current = result.round.nonce;

    clearTimers();
    const finalGrid = outcome.base.grid;
    // Reveal reels left-to-right; until a reel settles it keeps cycling.
    setSettledReels(0);
    cycleRef.current = setInterval(() => {
      setBoard((prev) =>
        prev.map((col, reel) => (reel < currentSettled.value ? finalGrid[reel]! : col.map(randomSymbol))),
      );
    }, 70);
    const currentSettled = { value: 0 };
    for (let reel = 0; reel < REELS; reel++) {
      const t = setTimeout(
        () => {
          currentSettled.value = reel + 1;
          setSettledReels(reel + 1);
          if (reel === REELS - 1) {
            clearTimers();
            setBoard(finalGrid);
          }
        },
        SPIN_MS + reel * REEL_STAGGER_MS,
      );
      timersRef.current.push(t);
    }
    return clearTimers;
  }, [outcome, result]);

  useEffect(() => clearTimers, []);

  const isSettling = spinning || settledReels < REELS;
  const wins = useMemo(
    () => (outcome && !isSettling ? winningCells(outcome.base) : new Set<string>()),
    [outcome, isSettling],
  );

  const totalWinMinor = outcome ? result?.round.winMinor : undefined;
  const isWin = outcome ? outcome.win && !isSettling : false;
  const freeSpins = outcome?.freeSpins ?? null;

  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      <div
        className="relative bg-cover bg-center p-3"
        style={{
          backgroundImage: `url(${ASSET_BASE}/${freeSpins && !isSettling ? "bg-fs.png" : "bg.png"})`,
        }}
      >
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {Array.from({ length: REELS }, (_, reel) => (
            <div key={reel} className="flex flex-col gap-1.5 sm:gap-2">
              {Array.from({ length: ROWS }, (_, row) => {
                const sym = board[reel]?.[row] ?? "VIOLET";
                const reelSpinning = isSettling && reel >= settledReels;
                return (
                  <Cell
                    key={`${reel}:${row}`}
                    sym={sym}
                    win={wins.has(`${reel}:${row}`)}
                    spinning={reelSpinning}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Win / feature banner */}
        <div className="mt-3 flex min-h-[2.25rem] items-center justify-center gap-2 text-center">
          {!result ? (
            <span className="text-sm text-text-mid">Set your bet and spin the reels.</span>
          ) : isSettling ? (
            <span className="text-sm font-medium text-gold-light">Spinning…</span>
          ) : isWin ? (
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-text-lo">Win</span>
              <Money
                valueMinor={totalWinMinor ?? "0"}
                currency={currency}
                signed
                size="lg"
                className="motion-safe:animate-[slideIn_240ms_ease-out]"
              />
              {outcome && outcome.base.multiplier > 1 ? (
                <Badge intent="warning">{outcome.base.multiplier}×</Badge>
              ) : null}
              <Badge intent="info">Demo</Badge>
            </div>
          ) : (
            <span className="text-sm text-text-mid">No win — spin again.</span>
          )}
        </div>

        {freeSpins && !isSettling ? <FreeSpinsPanel currency={currency} fs={freeSpins} /> : null}
      </div>
    </div>
  );
}

function FreeSpinsPanel({
  currency,
  fs,
}: {
  currency: Currency;
  fs: NonNullable<PhoenixOutcome["freeSpins"]>;
}): React.ReactElement {
  const totalOrbs = fs.spins.reduce((n, s) => n + s.orbValues.length, 0);
  return (
    <div className="mt-3 rounded-lg border border-gold/30 bg-abyss/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold tracking-wide text-gold-light">
          ✦ Free Spins — {fs.totalSpins}
        </span>
        <div className="flex items-center gap-2 text-xs">
          <Badge intent="warning">{fs.endMultiplier}× final</Badge>
          {totalOrbs > 0 ? <Badge intent="neutral">{totalOrbs} orbs</Badge> : null}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {fs.spins.map((s, i) => (
          <div
            key={i}
            className="flex min-w-[3.5rem] shrink-0 flex-col items-center gap-0.5 rounded-md border border-hairline bg-surface-1/60 px-2 py-1.5"
            title={`Spin ${i + 1}${s.orbValues.length ? ` · orbs ${s.orbValues.join("+")}` : ""}`}
          >
            <span className="text-[0.6rem] uppercase tracking-wide text-text-lo">#{i + 1}</span>
            {s.spinWinBps > 0 ? (
              <Money valueMinor={String(s.spinWinBps)} currency={currency} size="sm" />
            ) : (
              <span className="text-xs text-text-lo">—</span>
            )}
            {s.multiplier > 1 ? (
              <span className="text-[0.6rem] font-medium text-gold-light">{s.multiplier}×</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
