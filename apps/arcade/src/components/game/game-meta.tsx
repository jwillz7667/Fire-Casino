import { Dices, Fish, Gamepad2, Grid3x3, Spade, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { GameType } from "@aureus/shared";

interface GameTypeMeta {
  label: string;
  Icon: LucideIcon;
  /** Tailwind gradient classes for the placeholder tile art. */
  gradient: string;
}

export const GAME_TYPE_META: Record<GameType, GameTypeMeta> = {
  FISH: { label: "Fish", Icon: Fish, gradient: "from-lumen/30 via-surface-2 to-abyss" },
  SLOT: { label: "Slots", Icon: Dices, gradient: "from-gold/30 via-surface-2 to-abyss" },
  KENO: { label: "Keno", Icon: Grid3x3, gradient: "from-ember/30 via-surface-2 to-abyss" },
  TABLE: { label: "Table", Icon: Spade, gradient: "from-success/25 via-surface-2 to-abyss" },
  OTHER: { label: "Arcade", Icon: Gamepad2, gradient: "from-info/25 via-surface-2 to-abyss" },
};

export function gameTypeLabel(type: GameType): string {
  return GAME_TYPE_META[type].label;
}

/** Placeholder game art (docs/07 §2.2 — tiles are placeholders behind the RGS). */
export function GameArt({
  type,
  className,
}: {
  type: GameType;
  className?: string;
}): React.ReactElement {
  const { Icon, gradient } = GAME_TYPE_META[type];
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${gradient} ${className ?? ""}`}
    >
      <Sparkles className="absolute right-2 top-2 h-3.5 w-3.5 text-text-hi/30" aria-hidden="true" />
      <Icon className="h-10 w-10 text-text-hi/80" aria-hidden="true" />
    </div>
  );
}
