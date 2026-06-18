"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import { Button, type Column, DataTable, Panel, ReasonDialog, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { KycQueueItem, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";

/** Only http(s) URLs are safe to render into an href (defense-in-depth vs the API). */
function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const proto = new URL(value).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

export function KycQueue(): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const canManage = hasPermission(principal, "compliance.manage");

  const [approve, setApprove] = useState<KycQueueItem | null>(null);
  const [reject, setReject] = useState<KycQueueItem | null>(null);

  const list = useCursorList<KycQueueItem>(["compliance", "kyc"], (cursor) =>
    api.get<Page<KycQueueItem>>(`/compliance/kyc/queue?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canManage },
  );

  const decide = useMutation({
    mutationFn: (input: { playerId: string; decision: "VERIFIED" | "REJECTED"; reason?: string }) =>
      api.post<unknown>(`/compliance/players/${input.playerId}/kyc/decision`, {
        decision: input.decision,
        reason: input.reason,
      }),
    onSuccess: (_data, input) => {
      toast.push({ title: input.decision === "VERIFIED" ? "KYC verified" : "KYC rejected", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["compliance", "kyc"] });
      setApprove(null);
      setReject(null);
    },
    onError: (err) => {
      toast.push({ title: "Decision failed", description: errorMessage(err), intent: "danger" });
      setApprove(null);
      setReject(null);
    },
  });

  const columns: Column<KycQueueItem>[] = [
    { key: "player", header: "Player", render: (k) => <span className="text-text-hi">{k.playerUsername}</span> },
    { key: "idType", header: "ID type", render: (k) => k.idType },
    { key: "level", header: "Level", numeric: true, render: (k) => `L${k.level}` },
    {
      key: "doc",
      header: "Document",
      render: (k) =>
        isHttpUrl(k.documentUrl) ? (
          <a
            href={k.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-lumen hover:underline"
          >
            View <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          "—"
        ),
    },
    { key: "submitted", header: "Submitted", render: (k) => formatDate(k.createdAt) },
  ];

  return (
    <Panel className="p-0">
      <DataTable
        columns={columns}
        rows={list.items}
        getRowId={(k) => k.id}
        loading={list.isLoading}
        emptyTitle="KYC queue is clear"
        emptyDescription="No pending identity reviews."
        rowActions={
          canManage
            ? (k) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => { setApprove(k); }}>
                    <Check className="h-4 w-4" />
                    Verify
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setReject(k); }}>
                    <X className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              )
            : undefined
        }
        nextCursor={list.nextCursor}
        onLoadMore={list.loadMore}
        loadingMore={list.isFetchingNextPage}
      />

      <ConfirmDialog
        open={approve !== null}
        onClose={() => { setApprove(null); }}
        onConfirm={() => {
          if (approve) decide.mutate({ playerId: approve.playerId, decision: "VERIFIED" });
        }}
        title="Verify identity"
        description={approve ? `Approve KYC for ${approve.playerUsername}? This unblocks redemption.` : undefined}
        confirmLabel="Verify"
        loading={decide.isPending}
      />
      <ReasonDialog
        open={reject !== null}
        onClose={() => { setReject(null); }}
        onConfirm={(reason) => {
          if (reject) decide.mutate({ playerId: reject.playerId, decision: "REJECTED", reason });
        }}
        title="Reject identity"
        confirmLabel="Reject"
        loading={decide.isPending}
        danger
      />
    </Panel>
  );
}
