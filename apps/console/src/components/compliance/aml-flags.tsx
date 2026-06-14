"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveAmlFlagSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Field,
  Modal,
  Panel,
  Select,
  Textarea,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { AmlFlag, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";

type Resolution = "CLEARED" | "ESCALATED" | "REVIEWING";

const SEVERITY_INTENT = { LOW: "neutral", MEDIUM: "warning", HIGH: "danger" } as const;

export function AmlFlags(): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const canManage = hasPermission(principal, "compliance.manage");

  const [target, setTarget] = useState<AmlFlag | null>(null);
  const [resolution, setResolution] = useState<Resolution>("CLEARED");
  const [note, setNote] = useState("");

  const list = useCursorList<AmlFlag>(["aml", "flags"], (cursor) =>
    api.get<Page<AmlFlag>>(`/compliance/aml/flags?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canManage },
  );

  const resolve = useMutation({
    mutationFn: (flagId: string) => {
      const parsed = resolveAmlFlagSchema.safeParse({ resolution, note: note === "" ? undefined : note });
      if (!parsed.success) throw new Error("Invalid resolution");
      return api.post<AmlFlag>(`/compliance/aml/flags/${flagId}/resolve`, parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Flag updated", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["aml", "flags"] });
      setTarget(null);
      setNote("");
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" });
    },
  });

  const columns: Column<AmlFlag>[] = [
    { key: "rule", header: "Rule", render: (f) => <span className="font-mono text-text-hi">{f.ruleCode}</span> },
    { key: "subject", header: "Subject", render: (f) => `${f.subjectType} · ${f.subjectId.slice(0, 8)}` },
    {
      key: "severity",
      header: "Severity",
      render: (f) => <Badge intent={SEVERITY_INTENT[f.severity]}>{f.severity}</Badge>,
    },
    { key: "status", header: "Status", render: (f) => <Badge intent={f.status === "OPEN" ? "warning" : "neutral"}>{f.status}</Badge> },
    { key: "created", header: "Raised", render: (f) => formatDate(f.createdAt) },
  ];

  return (
    <Panel className="p-0">
      <DataTable
        columns={columns}
        rows={list.items}
        getRowId={(f) => f.id}
        loading={list.isLoading}
        emptyTitle="No AML flags"
        emptyDescription="No anti-money-laundering flags are open."
        rowActions={
          canManage
            ? (f) =>
                f.status === "OPEN" || f.status === "REVIEWING" ? (
                  <Button size="sm" variant="secondary" onClick={() => { setTarget(f); }}>
                    Resolve
                  </Button>
                ) : (
                  <span className="text-xs text-text-lo">—</span>
                )
            : undefined
        }
        nextCursor={list.nextCursor}
        onLoadMore={list.loadMore}
        loadingMore={list.isFetchingNextPage}
      />

      <Modal
        open={target !== null}
        onClose={() => { setTarget(null); }}
        title="Resolve AML flag"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setTarget(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (target) resolve.mutate(target.id);
              }}
              loading={resolve.isPending}
            >
              Submit
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Resolution" required>
            <Select value={resolution} onChange={(e) => { setResolution(e.target.value as Resolution); }}>
              <option value="CLEARED">Clear</option>
              <option value="REVIEWING">Mark reviewing</option>
              <option value="ESCALATED">Escalate</option>
            </Select>
          </Field>
          <Field label="Note" hint="Recorded in the audit log">
            <Textarea value={note} onChange={(e) => { setNote(e.target.value); }} maxLength={280} />
          </Field>
        </div>
      </Modal>
    </Panel>
  );
}
