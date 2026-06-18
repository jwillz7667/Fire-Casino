"use client";

import { type ReactElement, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Panel, SectionTitle, Skeleton, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { PlayerRtpItem, PlayerRtpResponse } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

const pct = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

/** Per-player win-rate overrides (docs/06 §6.1). Overrides the agent-level rate for this one player. */
export function PlayerRtpPanel({ playerId }: { playerId: string }): ReactElement {
  const data = useQuery({
    queryKey: ["player", playerId, "rtp"],
    queryFn: () => api.get<PlayerRtpResponse>(`/games/rtp/players/${playerId}`),
    retry: false,
  });

  return (
    <Panel className="flex flex-col gap-4">
      <SectionTitle>Win rates</SectionTitle>
      {data.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data.data || data.data.items.length === 0 ? (
        <EmptyState title="No games" />
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {data.data.items.map((item) => (
            <PlayerRtpRow key={item.code} playerId={playerId} item={item} minBps={data.data.minBps} maxBps={data.data.maxBps} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function PlayerRtpRow({
  playerId,
  item,
  minBps,
  maxBps,
}: {
  playerId: string;
  item: PlayerRtpItem;
  minBps: number;
  maxBps: number;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(item.effectiveRtpBps);
  useEffect(() => { setValue(item.effectiveRtpBps); }, [item.effectiveRtpBps]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["player", playerId, "rtp"] });
  const save = useMutation({
    mutationFn: () => api.put(`/games/rtp/${item.code}/players/${playerId}`, { rtpBps: value }),
    onSuccess: () => { toast.push({ title: `${item.name}: ${pct(value)} for this player`, intent: "success" }); void invalidate(); },
    onError: (err) => { toast.push({ title: "Save failed", description: errorMessage(err), intent: "danger" }); },
  });
  const reset = useMutation({
    mutationFn: () => api.del(`/games/rtp/${item.code}/players/${playerId}`),
    onSuccess: () => { toast.push({ title: `${item.name}: reverted to agent/default`, intent: "success" }); void invalidate(); },
    onError: (err) => { toast.push({ title: "Reset failed", description: errorMessage(err), intent: "danger" }); },
  });

  const dirty = value !== item.effectiveRtpBps;
  const baseLabel =
    item.agentRtpBps !== null ? `agent ${pct(item.agentRtpBps)}` : `default ${pct(item.defaultRtpBps)}`;

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-hi">{item.name}</span>
        <span className="font-mono text-sm text-gold-light">{pct(value)}</span>
      </div>
      <input
        type="range"
        min={minBps}
        max={maxBps}
        step={50}
        value={value}
        onChange={(e) => { setValue(Number(e.target.value)); }}
        className="w-full accent-gold"
        aria-label={`${item.name} RTP for this player`}
      />
      <div className="flex items-center justify-between text-xs text-text-lo">
        <span>
          {item.playerRtpBps !== null ? `player override ${pct(item.playerRtpBps)}` : `inherits ${baseLabel}`}
        </span>
        <div className="flex gap-2">
          {item.playerRtpBps !== null ? (
            <Button variant="ghost" size="sm" onClick={() => { reset.mutate(); }} loading={reset.isPending}>
              Clear
            </Button>
          ) : null}
          <Button size="sm" onClick={() => { save.mutate(); }} loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
