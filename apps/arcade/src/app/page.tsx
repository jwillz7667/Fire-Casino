"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, SectionTitle } from "@aureus/ui";
import type { GameType } from "@aureus/shared";
import { AppShell } from "@/components/shell/AppShell";
import { BrandSpinner } from "@/components/shell/BrandSpinner";
import { AnnouncementBanner } from "@/components/lobby/AnnouncementBanner";
import { CategoryChips, type CategoryFilter } from "@/components/lobby/CategoryChips";
import { GameTile } from "@/components/lobby/GameTile";
import { useAuth } from "@/lib/auth-context";
import { useWallet } from "@/lib/hooks";
import { fetchGames, qk } from "@/lib/queries";
import { balanceFor, spendCurrency } from "@/lib/mode";

export default function LobbyPage(): React.ReactElement {
  return (
    <AppShell active="play">
      <Lobby />
    </AppShell>
  );
}

function Lobby(): React.ReactElement {
  const { mode } = useAuth();
  const currency = spendCurrency(mode);
  const wallet = useWallet();
  const [category, setCategory] = useState<CategoryFilter>("ALL");

  const gamesQuery = useQuery({
    queryKey: qk.games(currency),
    queryFn: () => fetchGames(currency),
  });

  const categories = useMemo<GameType[]>(() => {
    const seen = new Set<GameType>();
    for (const game of gamesQuery.data ?? []) seen.add(game.type);
    return [...seen];
  }, [gamesQuery.data]);

  const games = useMemo(() => {
    const all = gamesQuery.data ?? [];
    return category === "ALL" ? all : all.filter((g) => g.type === category);
  }, [gamesQuery.data, category]);

  const spendable = wallet.data ? balanceFor(wallet.data.wallets, currency) : "0";
  const isBroke = wallet.data !== undefined && BigInt(spendable) <= 0n;

  return (
    <div className="flex flex-col gap-4">
      <AnnouncementBanner />

      {isBroke ? (
        <Link
          href="/wallet"
          className="flex items-center justify-between gap-3 rounded-md border border-gold/40 bg-gold/10 px-4 py-3"
        >
          <div>
            <div className="text-sm font-semibold text-gold-light">Load credits to play</div>
            <div className="text-xs text-text-mid">Your balance is empty. Tap to top up.</div>
          </div>
          <span className="text-sm font-semibold text-gold-light">Load up →</span>
        </Link>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Games</SectionTitle>
        </div>

        {categories.length > 1 ? (
          <CategoryChips categories={categories} active={category} onChange={setCategory} />
        ) : null}

        {gamesQuery.isLoading ? (
          <BrandSpinner label="Loading games…" />
        ) : gamesQuery.isError ? (
          <EmptyState
            title="Couldn't load games"
            description="Pull to refresh, or try again in a moment."
          />
        ) : games.length === 0 ? (
          <EmptyState
            title="No games yet"
            description="Check back soon — your agent is setting things up."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {games.map((game) => (
              <GameTile key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
