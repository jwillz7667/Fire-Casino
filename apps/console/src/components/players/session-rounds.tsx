"use client";

import { type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Money, Skeleton } from "@aureus/ui";
import { api } from "@/lib/api";
import type { SessionRoundsPage } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

/** Round-by-round drill-down inside a play session (GET /players/:id/sessions/:sid/rounds). */
export function SessionRounds({ playerId, sessionId }: { playerId: string; sessionId: string }): ReactElement {
  const rounds = useQuery({
    queryKey: ["player", playerId, "session", sessionId, "rounds"],
    queryFn: () =>
      api.get<SessionRoundsPage>(`/players/${playerId}/sessions/${sessionId}/rounds?limit=50`),
    retry: false,
  });

  if (rounds.isLoading) return <Skeleton className="my-2 h-20 w-full" />;
  if (rounds.isError || !rounds.data) {
    return <p className="py-2 text-xs text-text-lo">Could not load rounds for this session.</p>;
  }

  const { session, items } = rounds.data;
  const currency = session.currency;

  return (
    <div className="my-2 rounded-md border border-hairline bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-text-lo">
        <span>
          <span className="text-text-mid">{session.gameName}</span> · {items.length} round{items.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono" title="Server seed hash (provably fair)">
          hash {session.serverSeedHash.slice(0, 12)}…
        </span>
        {session.serverSeed ? (
          <span className="font-mono text-success" title="Revealed server seed">
            seed {session.serverSeed.slice(0, 12)}…
          </span>
        ) : (
          <span className="text-text-lo">seed sealed</span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-2 text-xs text-text-lo">No rounds were played in this session.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-lo">
              <th className="py-1 pr-3 font-medium">#</th>
              <th className="py-1 pr-3 font-medium">Bet</th>
              <th className="py-1 pr-3 font-medium">Win</th>
              <th className="py-1 pr-3 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const win = BigInt(r.winMinor) > 0n;
              return (
                <tr key={r.id} className="border-t border-hairline/60">
                  <td className="py-1 pr-3 font-mono text-text-mid">{r.nonce}</td>
                  <td className="py-1 pr-3">
                    <Money valueMinor={r.betMinor} currency={currency} size="sm" />
                  </td>
                  <td className={`py-1 pr-3 ${win ? "text-success" : "text-text-lo"}`}>
                    <Money valueMinor={r.winMinor} currency={currency} size="sm" />
                  </td>
                  <td className="py-1 pr-3 text-right text-text-lo">{formatDateTime(r.at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {rounds.data.nextCursor ? (
        <Button variant="ghost" size="sm" disabled className="mt-2">
          Showing latest 50 rounds
        </Button>
      ) : null}
    </div>
  );
}
