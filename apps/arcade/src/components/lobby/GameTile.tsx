"use client";

import Link from "next/link";
import { Badge } from "@aureus/ui";
import type { GameDTO } from "@/lib/types";
import { GameArt, gameTypeLabel } from "@/components/game/game-meta";

/** A single game tile: placeholder art + name + category + optional RTP. */
export function GameTile({ game }: { game: GameDTO }): React.ReactElement {
  return (
    <Link
      href={`/play/${encodeURIComponent(game.code)}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-1 transition-transform active:scale-[0.98]"
    >
      <GameArt type={game.type} src={game.thumbnailUrl} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="truncate text-sm font-medium text-text-hi">{game.name}</span>
        <div className="flex items-center justify-between">
          <Badge intent="neutral">{gameTypeLabel(game.type)}</Badge>
          <span className="text-[0.625rem] font-medium uppercase tracking-wide text-text-lo">
            RTP {(game.rtpBps / 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </Link>
  );
}
