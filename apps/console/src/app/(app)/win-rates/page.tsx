"use client";

import { type ReactElement, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ForbiddenState, Panel, SectionTitle, Skeleton, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { AgentRtpItem, AgentRtpResponse } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";

const pct = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

export default function WinRatesPage(): ReactElement {
  const principal = usePrincipal();
  const canManage = hasPermission(principal, "game.rtp_agent");

  const data = useQuery({
    queryKey: ["win-rates"],
    queryFn: () => api.get<AgentRtpResponse>("/games/rtp"),
    enabled: canManage,
    retry: false,
  });

  if (!canManage) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Win rates"
        subtitle="Tune the payout (RTP) per game for your players. Lower = more house edge."
      />
      <Panel className="flex flex-col gap-4">
        <SectionTitle>Per-game RTP</SectionTitle>
        {data.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data.data || data.data.items.length === 0 ? (
          <EmptyState title="No games" description="Active games will appear here." />
        ) : (
          <div className="flex flex-col divide-y divide-hairline">
            {data.data.items.map((item) => (
              <RtpRow key={item.code} item={item} minBps={data.data.minBps} maxBps={data.data.maxBps} />
            ))}
          </div>
        )}
      </Panel>
      <p className="text-xs text-text-lo">
        Changes apply to your players on their next spin. Per-player overrides are set from a player&rsquo;s detail page.
      </p>
    </div>
  );
}

function RtpRow({
  item,
  minBps,
  maxBps,
}: {
  item: AgentRtpItem;
  minBps: number;
  maxBps: number;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(item.effectiveRtpBps);

  // Re-sync the slider when the server data refreshes.
  useEffect(() => { setValue(item.effectiveRtpBps); }, [item.effectiveRtpBps]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["win-rates"] });
  const save = useMutation({
    mutationFn: () => api.put(`/games/rtp/${item.code}`, { rtpBps: value }),
    onSuccess: () => {
      toast.push({ title: `${item.name} win rate set to ${pct(value)}`, intent: "success" });
      void invalidate();
    },
    onError: (err) => { toast.push({ title: "Save failed", description: errorMessage(err), intent: "danger" }); },
  });
  const reset = useMutation({
    mutationFn: () => api.del(`/games/rtp/${item.code}`),
    onSuccess: () => {
      toast.push({ title: `${item.name} reverted to default`, intent: "success" });
      void invalidate();
    },
    onError: (err) => { toast.push({ title: "Reset failed", description: errorMessage(err), intent: "danger" }); },
  });

  const dirty = value !== item.effectiveRtpBps;

  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-hi">{item.name}</span>
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
        aria-label={`${item.name} RTP`}
      />
      <div className="flex items-center justify-between text-xs text-text-lo">
        <span>
          Default {pct(item.defaultRtpBps)}
          {item.agentRtpBps !== null ? ` · your override ${pct(item.agentRtpBps)}` : " · no override"}
        </span>
        <div className="flex gap-2">
          {item.agentRtpBps !== null ? (
            <Button variant="ghost" size="sm" onClick={() => { reset.mutate(); }} loading={reset.isPending}>
              Reset to default
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
