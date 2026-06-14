"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  canCreateChildTier,
  createOperatorSchema,
  type OperatorTier,
  operatorTierSchema,
} from "@aureus/shared";
import { Badge, Button, Field, Input, Modal, Select, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { CreateOperatorResult } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { humanize } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CreateOperatorDialog({
  open,
  onClose,
  parent,
}: {
  open: boolean;
  onClose: () => void;
  parent: { id?: string; tier: OperatorTier; displayName: string };
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const allowedTiers = operatorTierSchema.options.filter((t) => canCreateChildTier(parent.tier, t));
  const [tier, setTier] = useState<OperatorTier>(allowedTiers[0] ?? "STORE");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [tempPassword, setTempPassword] = useState(generatePassword);
  const [buyUnitPriceCents, setBuyUnitPriceCents] = useState("");
  const [sellUnitPriceCents, setSellUnitPriceCents] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  function reset(): void {
    setTier(allowedTiers[0] ?? "STORE");
    setDisplayName("");
    setUsername("");
    setTempPassword(generatePassword());
    setBuyUnitPriceCents("");
    setSellUnitPriceCents("");
    setError(undefined);
    setCreated(null);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        tier,
        displayName,
        username,
        tempPassword,
        parentId: parent.id,
        buyUnitPriceCents: buyUnitPriceCents === "" ? undefined : Number(buyUnitPriceCents),
        sellUnitPriceCents: sellUnitPriceCents === "" ? undefined : Number(sellUnitPriceCents),
      };
      const parsed = createOperatorSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid operator details");
      }
      return api.post<CreateOperatorResult>("/operators", parsed.data);
    },
    onSuccess: () => {
      setCreated({ username, password: tempPassword });
      void queryClient.invalidateQueries({ queryKey: ["operators"] });
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
      toast.push({ title: "Operator created", intent: "success" });
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function close(): void {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? "Operator created" : "Add operator"}
      size="md"
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setError(undefined);
                mutation.mutate();
              }}
              loading={mutation.isPending}
            >
              Create operator
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-mid">
            Share these credentials with the new operator now — the password is shown once and they must change it on
            first login.
          </p>
          <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-2 p-3">
            <CredRow label="Username" value={created.username} />
            <CredRow label="Temp password" value={created.password} mono />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-lo">
            New node under <span className="text-text-mid">{parent.displayName}</span> · one tier below.
          </p>
          <Field label="Tier" required>
            <Select
              value={tier}
              onChange={(e) => {
                setTier(e.target.value as OperatorTier);
              }}
            >
              {allowedTiers.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Display name" required>
            <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} />
          </Field>
          <Field label="Login username" required>
            <Input value={username} onChange={(e) => { setUsername(e.target.value); }} autoComplete="off" />
          </Field>
          <Field label="Temporary password" required>
            <div className="flex gap-2">
              <Input
                value={tempPassword}
                onChange={(e) => { setTempPassword(e.target.value); }}
                className="font-mono"
              />
              <Button
                variant="secondary"
                onClick={() => { setTempPassword(generatePassword()); }}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                New
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buy price ¢" hint="Optional · margin reporting">
              <Input
                inputMode="numeric"
                value={buyUnitPriceCents}
                onChange={(e) => { setBuyUnitPriceCents(e.target.value.replace(/\D/g, "")); }}
              />
            </Field>
            <Field label="Sell price ¢" hint="Optional">
              <Input
                inputMode="numeric"
                value={sellUnitPriceCents}
                onChange={(e) => { setSellUnitPriceCents(e.target.value.replace(/\D/g, "")); }}
              />
            </Field>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {allowedTiers.length === 0 ? (
            <Badge intent="warning">This node cannot create child operators.</Badge>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function CredRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-text-lo">{label}</span>
      <div className="flex items-center gap-2">
        <code className={mono ? "font-mono text-sm text-gold-light" : "text-sm text-text-hi"}>{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
