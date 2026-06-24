"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { upsertGeoRuleSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { GeoRule } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";

export function GeoRules(): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const canManage = hasPermission(principal, "platform.settings");

  const [addOpen, setAddOpen] = useState(false);
  const [removeRegion, setRemoveRegion] = useState<string | null>(null);
  const [region, setRegion] = useState("");
  const [action, setAction] = useState<"ALLOW" | "BLOCK">("BLOCK");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();

  const rules = useQuery({
    queryKey: ["compliance", "geo"],
    queryFn: () => api.get<GeoRule[]>("/compliance/geo"),
    enabled: hasPermission(principal, "compliance.view"),
  });

  const upsert = useMutation({
    mutationFn: () => {
      const parsed = upsertGeoRuleSchema.safeParse({ region, action, reason: reason === "" ? undefined : reason });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid rule");
      return api.post<GeoRule>("/compliance/geo", parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Geo rule saved", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["compliance", "geo"] });
      setAddOpen(false);
      setRegion("");
      setReason("");
    },
    onError: (err) => { setError(errorMessage(err)); },
  });

  const remove = useMutation({
    mutationFn: (r: string) => api.del<void>(`/compliance/geo/${r}`),
    onSuccess: () => {
      toast.push({ title: "Geo rule removed", intent: "info" });
      void queryClient.invalidateQueries({ queryKey: ["compliance", "geo"] });
      setRemoveRegion(null);
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" });
      setRemoveRegion(null);
    },
  });

  const columns: Column<GeoRule>[] = [
    { key: "region", header: "Region", render: (r) => <span className="font-mono text-text-hi">{r.region}</span> },
    {
      key: "action",
      header: "Action",
      render: (r) => <Badge intent={r.action === "BLOCK" ? "danger" : "success"}>{r.action}</Badge>,
    },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
    { key: "updated", header: "Updated", render: (r) => formatDate(r.updatedAt) },
  ];

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-mid">Allow/block lists enforced at login and redemption.</span>
        {canManage ? (
          <Button size="sm" onClick={() => { setError(undefined); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add rule
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={rules.data ?? []}
        getRowId={(r) => r.id}
        loading={rules.isLoading}
        emptyTitle="No geo rules"
        emptyDescription="All regions are allowed by default."
        rowActions={
          canManage
            ? (r) => (
                <Button size="sm" variant="ghost" onClick={() => { setRemoveRegion(r.region); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )
            : undefined
        }
      />

      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); }}
        title="Add geo rule"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setAddOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={() => { setError(undefined); upsert.mutate(); }} loading={upsert.isPending}>
              Save rule
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Region code" required hint="ISO country/region code, e.g. US, CA, GB">
            <Input value={region} onChange={(e) => { setRegion(e.target.value.toUpperCase()); }} maxLength={10} />
          </Field>
          <Field label="Action" required>
            <Select value={action} onChange={(e) => { setAction(e.target.value as "ALLOW" | "BLOCK"); }}>
              <option value="BLOCK">Block</option>
              <option value="ALLOW">Allow</option>
            </Select>
          </Field>
          <Field label="Reason" hint="Optional">
            <Input value={reason} onChange={(e) => { setReason(e.target.value); }} maxLength={280} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={removeRegion !== null}
        onClose={() => { setRemoveRegion(null); }}
        onConfirm={() => {
          if (removeRegion) remove.mutate(removeRegion);
        }}
        title="Remove geo rule?"
        description={removeRegion ? `Remove the rule for ${removeRegion}?` : undefined}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
      />
    </Panel>
  );
}
