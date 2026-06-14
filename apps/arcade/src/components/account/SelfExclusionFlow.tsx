"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";
import { Button, Card, Field, Modal, SectionTitle, Select, Textarea, useToast } from "@aureus/ui";
import { selfExcludeSchema } from "@aureus/shared";
import { useAuth } from "@/lib/auth-context";
import { useCompliance } from "@/lib/hooks";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { qk } from "@/lib/queries";

const PERIODS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "indefinite", label: "Indefinitely" },
] as const;

function untilFromPeriod(period: string): string | undefined {
  if (period === "indefinite") return undefined;
  const days = Number(period);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function SelfExclusionFlow(): React.ReactElement {
  const { refreshMe } = useAuth();
  const compliance = useCompliance();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<string>(PERIODS[1].value);
  const [reason, setReason] = useState("");

  const excluded = compliance.data?.selfExcluded === true;
  const until = compliance.data?.selfExclusionUntil;

  const mutation = useMutation({
    mutationFn: () => {
      const body = selfExcludeSchema.parse({
        until: untilFromPeriod(period),
        reason: reason.trim() || undefined,
      });
      return api.post("/compliance/self-exclude", body);
    },
    onSuccess: async () => {
      toast.push({ title: "Self-exclusion set", description: "Play and recharge are now paused.", intent: "success" });
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: qk.compliance });
      await refreshMe();
    },
    onError: (err) => {
      toast.push({ title: "Couldn't set self-exclusion", description: messageForError(err), intent: "danger" });
    },
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <ShieldOff className="h-4 w-4 text-danger" />
        <SectionTitle>Self-exclusion</SectionTitle>
      </div>

      {excluded ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          You&apos;re currently self-excluded
          {until ? ` until ${new Date(until).toLocaleDateString()}` : " indefinitely"}. Play and
          recharge are paused. Contact support to review.
        </p>
      ) : (
        <>
          <p className="text-xs text-text-mid">
            Take a break. This immediately blocks playing and loading credits for the period you
            choose.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              setOpen(true);
            }}
            className="w-full"
          >
            Self-exclude
          </Button>
        </>
      )}

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Self-exclude"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              onClick={() => {
                mutation.mutate();
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-mid">
            This pauses play and recharge for the selected period and is logged.
          </p>
          <Field label="Period">
            <Select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
              }}
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (optional)">
            <Textarea
              value={reason}
              maxLength={280}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
