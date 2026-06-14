"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Field,
  Input,
  Money,
  MoneyInput,
  SectionTitle,
  Select,
  useToast,
} from "@aureus/ui";
import {
  type Currency,
  type RgLimitType,
  type RgPeriod,
  setRgLimitSchema,
} from "@aureus/shared";
import { useCompliance } from "@/lib/hooks";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { qk } from "@/lib/queries";

const LIMIT_TYPES: { value: RgLimitType; label: string }[] = [
  { value: "DEPOSIT", label: "Deposit cap" },
  { value: "LOSS", label: "Loss cap" },
  { value: "WAGER", label: "Wager cap" },
  { value: "SESSION_TIME", label: "Session time" },
];

const PERIODS: { value: RgPeriod; label: string }[] = [
  { value: "DAILY", label: "Per day" },
  { value: "WEEKLY", label: "Per week" },
  { value: "MONTHLY", label: "Per month" },
  { value: "SESSION", label: "Per session" },
];

const TYPE_LABEL: Record<RgLimitType, string> = {
  DEPOSIT: "Deposit cap",
  LOSS: "Loss cap",
  WAGER: "Wager cap",
  SESSION_TIME: "Session time",
};

const PERIOD_LABEL: Record<RgPeriod, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  SESSION: "session",
};

export function RgLimitsForm({ spendCurrency }: { spendCurrency: Currency }): React.ReactElement {
  const compliance = useCompliance();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [type, setType] = useState<RgLimitType>("DEPOSIT");
  const [period, setPeriod] = useState<RgPeriod>("DAILY");
  const [valueMinor, setValueMinor] = useState<bigint | undefined>();
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | undefined>();

  const isTime = type === "SESSION_TIME";

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = setRgLimitSchema.safeParse({
        type,
        period,
        valueMinor: isTime ? undefined : valueMinor?.toString(),
        minutes: isTime ? Number(minutes) : undefined,
      });
      if (!parsed.success) throw new Error("Enter a valid limit.");
      return api.post("/compliance/rg-limits", parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Limit saved", intent: "success" });
      setValueMinor(undefined);
      setMinutes("");
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey: qk.compliance });
    },
    onError: (err) => {
      setError(messageForError(err));
    },
  });

  const limits = compliance.data?.rgLimits ?? [];

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <SectionTitle>Responsible gaming limits</SectionTitle>
        <p className="text-xs text-text-mid">Set your own caps. They apply immediately.</p>
      </div>

      {limits.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {limits.map((limit) => (
            <li
              key={`${limit.type}-${limit.period}`}
              className="flex items-center justify-between rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="text-text-mid">
                {TYPE_LABEL[limit.type]} · {PERIOD_LABEL[limit.period]}
              </span>
              <span className="font-medium text-text-hi">
                {limit.minutes !== null ? (
                  `${limit.minutes} min`
                ) : limit.valueMinor !== null ? (
                  <Money valueMinor={limit.valueMinor} currency={spendCurrency} size="sm" />
                ) : (
                  "—"
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Limit">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as RgLimitType);
            }}
          >
            {LIMIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period">
          <Select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as RgPeriod);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isTime ? (
        <Field label="Minutes" error={error}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
            }}
            placeholder="e.g. 60"
          />
        </Field>
      ) : (
        <Field label={`Amount (${spendCurrency})`} error={error}>
          <MoneyInput valueMinor={valueMinor} onChangeMinor={setValueMinor} currency={spendCurrency} />
        </Field>
      )}

      <Button
        onClick={() => {
          mutation.mutate();
        }}
        loading={mutation.isPending}
        disabled={isTime ? minutes.trim() === "" : valueMinor === undefined}
        className="w-full"
      >
        Save limit
      </Button>
    </Card>
  );
}
