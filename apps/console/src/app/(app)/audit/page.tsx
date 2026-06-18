"use client";

import { type ReactElement, useState } from "react";
import { Badge, type Column, DataTable, Drawer, Field, ForbiddenState, Input, Panel, Select } from "@aureus/ui";
import { auditQuerySchema } from "@aureus/shared";
import { api, toQuery } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { AuditLogRow, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";

export default function AuditPage(): ReactElement {
  const principal = usePrincipal();
  const canView = hasPermission(principal, "audit.view");

  const [actorType, setActorType] = useState("all");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const toIso = (d: string): string | undefined => {
    if (d === "") return undefined;
    const parsed = new Date(d);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  };

  const queryParams = auditQuerySchema.partial().parse({
    actorType: actorType === "all" ? undefined : (actorType as "USER" | "PLAYER" | "SYSTEM"),
    action: action === "" ? undefined : action,
    targetType: targetType === "" ? undefined : targetType,
    from: toIso(from),
    to: toIso(to),
  });

  const list = useCursorList<AuditLogRow>(["audit", actorType, action, targetType, from, to], (cursor) =>
    api.get<Page<AuditLogRow>>(
      `/audit${toQuery({
        actorType: queryParams.actorType,
        action: queryParams.action,
        targetType: queryParams.targetType,
        from: queryParams.from,
        to: queryParams.to,
        limit: 50,
        cursor,
      })}`,
    ),
    { enabled: canView },
  );

  const columns: Column<AuditLogRow>[] = [
    { key: "action", header: "Action", render: (r) => <span className="font-mono text-text-hi">{r.action}</span> },
    { key: "actor", header: "Actor", render: (r) => <Badge intent="neutral">{r.actorType}</Badge> },
    {
      key: "target",
      header: "Target",
      render: (r) => (r.targetType ? `${r.targetType}${r.targetId ? ` · ${r.targetId.slice(0, 8)}` : ""}` : "—"),
    },
    { key: "ip", header: "IP", render: (r) => r.ip ?? "—" },
    { key: "when", header: "When", render: (r) => formatDateTime(r.createdAt) },
  ];

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" subtitle="Append-only record of privileged actions. Read-only." />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Actor type" className="w-40">
          <Select value={actorType} onChange={(e) => { setActorType(e.target.value); }}>
            <option value="all">All</option>
            <option value="USER">User</option>
            <option value="PLAYER">Player</option>
            <option value="SYSTEM">System</option>
          </Select>
        </Field>
        <Field label="Action" className="w-56">
          <Input value={action} onChange={(e) => { setAction(e.target.value); }} placeholder="e.g. ledger.transfer" />
        </Field>
        <Field label="Target type" className="w-48">
          <Input value={targetType} onChange={(e) => { setTargetType(e.target.value); }} placeholder="e.g. Operator" />
        </Field>
        <Field label="From" className="w-44">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); }} />
        </Field>
        <Field label="To" className="w-44">
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); }} />
        </Field>
      </div>

      <Panel className="p-0">
        <DataTable
          columns={columns}
          rows={list.items}
          getRowId={(r) => r.id}
          loading={list.isLoading}
          emptyTitle="No audit entries"
          emptyDescription="Nothing matches these filters."
          onRowClick={(r) => { setSelected(r); }}
          nextCursor={list.nextCursor}
          onLoadMore={list.loadMore}
          loadingMore={list.isFetchingNextPage}
        />
      </Panel>

      <Drawer open={selected !== null} onClose={() => { setSelected(null); }} title="Audit entry">
        {selected ? (
          <div className="flex flex-col gap-4 text-sm">
            <Detail label="Action" value={selected.action} mono />
            <Detail label="Actor" value={`${selected.actorType}${selected.actorId ? ` · ${selected.actorId}` : ""}`} mono />
            <Detail
              label="Target"
              value={selected.targetType ? `${selected.targetType} · ${selected.targetId ?? ""}` : "—"}
              mono
            />
            <Detail label="When" value={formatDateTime(selected.createdAt)} />
            <Detail label="IP" value={selected.ip ?? "—"} />
            <JsonBlock label="Before" value={selected.before} />
            <JsonBlock label="After" value={selected.after} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{label}</span>
      <span className={mono ? "break-all font-mono text-xs text-text-hi" : "text-text-hi"}>{value}</span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }): ReactElement {
  if (value === null || value === undefined) {
    return <Detail label={label} value="—" />;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{label}</span>
      <pre className="overflow-x-auto rounded-md border border-hairline bg-surface-2 p-3 font-mono text-xs text-text-mid">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
