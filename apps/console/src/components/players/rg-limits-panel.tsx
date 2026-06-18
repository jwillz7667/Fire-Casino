"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { Button, Field, Input, MoneyInput, Panel, SectionTitle, Select, useToast } from "@aureus/ui";
import { rgLimitTypeSchema, rgPeriodSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import type { PlayerComplianceState } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { humanize } from "@/lib/format";

/** Responsible-gaming limit editor + self-exclusion (docs/06 §3.11, CR5/CA1). */
export function RgLimitsPanel({
  playerId,
  state,
}: {
  playerId: string;
  state: PlayerComplianceState;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState("DEPOSIT");
  const [period, setPeriod] = useState("DAILY");
  const [valueMinor, setValueMinor] = useState<bigint | undefined>(undefined);
  const [minutes, setMinutes] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["player", playerId, "compliance"] });
  const isSession = type === "SESSION_TIME";

  const setLimit = useMutation({
    mutationFn: () =>
      api.post(`/compliance/players/${playerId}/rg-limits`, {
        type,
        period,
        ...(isSession ? { minutes: Number(minutes) } : { valueMinor: valueMinor?.toString() }),
      }),
    onSuccess: () => {
      toast.push({ title: "Limit set", intent: "success" });
      void invalidate();
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });
  const selfExclude = useMutation({
    mutationFn: () => api.post(`/compliance/players/${playerId}/self-exclude`, {}),
    onSuccess: () => {
      toast.push({ title: "Player self-excluded", intent: "success" });
      void invalidate();
    },
    onError: (err) => { toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" }); },
  });

  const canSubmit = isSession ? minutes !== "" : valueMinor !== undefined && valueMinor > 0n;

  return (
    <Panel className="flex flex-col gap-4">
      <SectionTitle>Responsible gaming</SectionTitle>

      {state.rgLimits.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline text-sm">
          {state.rgLimits.map((l, i) => (
            <li key={`${l.type}-${l.period}-${i}`} className="flex items-center justify-between py-2">
              <span className="text-text-hi">
                {humanize(l.type)} · {humanize(l.period)}
              </span>
              <span className="font-mono text-text-mid">
                {l.minutes !== null ? `${l.minutes} min` : l.valueMinor !== null ? l.valueMinor : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-text-lo">No limits set.</span>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Limit type">
          <Select value={type} onChange={(e) => { setType(e.target.value); }}>
            {rgLimitTypeSchema.options.map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Period">
          <Select value={period} onChange={(e) => { setPeriod(e.target.value); }}>
            {rgPeriodSchema.options.map((p) => (
              <option key={p} value={p}>{humanize(p)}</option>
            ))}
          </Select>
        </Field>
        {isSession ? (
          <Field label="Minutes">
            <Input inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, "")); }} />
          </Field>
        ) : (
          <Field label="Amount">
            <MoneyInput valueMinor={valueMinor} onChangeMinor={setValueMinor} />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setLimit.mutate(); }} loading={setLimit.isPending} disabled={!canSubmit}>
          Set limit
        </Button>
        {!state.selfExcluded ? (
          <Button variant="ghost" onClick={() => { selfExclude.mutate(); }} loading={selfExclude.isPending}>
            <Ban className="h-4 w-4" />
            Self-exclude
          </Button>
        ) : (
          <span className="self-center text-sm text-ember">Self-excluded</span>
        )}
      </div>
    </Panel>
  );
}
