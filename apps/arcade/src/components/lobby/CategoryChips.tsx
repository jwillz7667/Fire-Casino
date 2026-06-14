"use client";

import { cn } from "@aureus/ui";
import type { GameType } from "@aureus/shared";
import { gameTypeLabel } from "@/components/game/game-meta";

export type CategoryFilter = GameType | "ALL";

export function CategoryChips({
  categories,
  active,
  onChange,
}: {
  categories: GameType[];
  active: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
}): React.ReactElement {
  const chips: { key: CategoryFilter; label: string }[] = [
    { key: "ALL", label: "All" },
    ...categories.map((c) => ({ key: c, label: gameTypeLabel(c) })),
  ];

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => {
        const selected = chip.key === active;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => {
              onChange(chip.key);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "border-gold/40 bg-gold/15 text-gold-light"
                : "border-hairline bg-surface-2 text-text-mid hover:text-text-hi",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
