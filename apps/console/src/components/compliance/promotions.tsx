"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { createPromotionSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  Checkbox,
  type Column,
  DataTable,
  Field,
  Modal,
  MoneyInput,
  Panel,
  Input,
  StatusPill,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { Promotion } from "@/lib/types";
import { OPERATOR_CURRENCY } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { Money } from "@aureus/ui";

export function Promotions(): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const canManage = hasPermission(principal, "promotion.manage");

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [grantMinor, setGrantMinor] = useState<bigint | undefined>();
  const [isAmoe, setIsAmoe] = useState(false);
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [perPlayerLimit, setPerPlayerLimit] = useState("1");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | undefined>();

  const list = useQuery({
    queryKey: ["compliance", "promotions"],
    queryFn: () => api.get<Promotion[]>("/compliance/promotions"),
    enabled: hasPermission(principal, "compliance.view"),
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = createPromotionSchema.safeParse({
        code,
        description: description === "" ? undefined : description,
        currency: OPERATOR_CURRENCY,
        grantMinor: (grantMinor ?? 0n).toString(),
        isAmoe,
        maxRedemptions: maxRedemptions === "" ? undefined : Number(maxRedemptions),
        perPlayerLimit: perPlayerLimit === "" ? undefined : Number(perPlayerLimit),
        startsAt: startsAt === "" ? undefined : new Date(startsAt).toISOString(),
        endsAt: endsAt === "" ? undefined : new Date(endsAt).toISOString(),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid promotion");
      return api.post<Promotion>("/compliance/promotions", { ...parsed.data, grantMinor: (grantMinor ?? 0n).toString() });
    },
    onSuccess: () => {
      toast.push({ title: "Promotion created", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["compliance", "promotions"] });
      setOpen(false);
      setCode("");
      setDescription("");
      setGrantMinor(undefined);
      setIsAmoe(false);
      setMaxRedemptions("");
      setPerPlayerLimit("1");
      setStartsAt("");
      setEndsAt("");
    },
    onError: (err) => { setError(errorMessage(err)); },
  });

  const columns: Column<Promotion>[] = [
    { key: "code", header: "Code", render: (p) => <span className="font-mono text-text-hi">{p.code}</span> },
    {
      key: "grant",
      header: "Grant",
      numeric: true,
      render: (p) => <Money valueMinor={p.grantMinor} currency={p.currency} size="sm" />,
    },
    { key: "amoe", header: "AMoE", render: (p) => (p.isAmoe ? <Badge intent="info">No-purchase</Badge> : "—") },
    { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} /> },
  ];

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-mid">Promotions and no-purchase (AMoE) entry configuration.</span>
        {canManage ? (
          <Button size="sm" onClick={() => { setError(undefined); setOpen(true); }}>
            <Plus className="h-4 w-4" />
            New promotion
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={list.data ?? []}
        getRowId={(p) => p.id}
        loading={list.isLoading}
        emptyTitle="No promotions"
      />

      <Modal
        open={open}
        onClose={() => { setOpen(false); }}
        title="New promotion"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={() => { setError(undefined); create.mutate(); }} loading={create.isPending}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); }} maxLength={40} />
          </Field>
          <Field label="Description" hint="Optional">
            <Input value={description} onChange={(e) => { setDescription(e.target.value); }} maxLength={280} />
          </Field>
          <Field label="Grant amount" required>
            <MoneyInput valueMinor={grantMinor} onChangeMinor={setGrantMinor} currency={OPERATOR_CURRENCY} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max redemptions" hint="Total cap; blank = unlimited">
              <Input
                inputMode="numeric"
                value={maxRedemptions}
                onChange={(e) => { setMaxRedemptions(e.target.value.replace(/\D/g, "")); }}
                placeholder="∞"
              />
            </Field>
            <Field label="Per-player limit" hint="1–100">
              <Input
                inputMode="numeric"
                value={perPlayerLimit}
                onChange={(e) => { setPerPlayerLimit(e.target.value.replace(/\D/g, "")); }}
              />
            </Field>
            <Field label="Starts" hint="Optional">
              <Input type="datetime-local" value={startsAt} onChange={(e) => { setStartsAt(e.target.value); }} />
            </Field>
            <Field label="Ends" hint="Optional">
              <Input type="datetime-local" value={endsAt} onChange={(e) => { setEndsAt(e.target.value); }} />
            </Field>
          </div>
          <Checkbox checked={isAmoe} onChange={setIsAmoe} label="No-purchase (AMoE) entry" />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      </Modal>
    </Panel>
  );
}
