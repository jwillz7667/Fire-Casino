"use client";

import { type ReactElement, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { announcementAudienceSchema, createAnnouncementSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  type Column,
  DataTable,
  Field,
  ForbiddenState,
  Input,
  type Intent,
  Panel,
  SectionTitle,
  Select,
  Textarea,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { Announcement, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate, formatDateTime, humanize } from "@/lib/format";

type Audience = "PLAYERS" | "OPERATORS" | "BOTH";

/** Lifecycle state derived from active + the optional schedule window. */
function announcementState(a: Announcement): { label: string; intent: Intent } {
  if (!a.active) return { label: "Ended", intent: "neutral" };
  const now = Date.now();
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return { label: "Scheduled", intent: "info" };
  if (a.endsAt && new Date(a.endsAt).getTime() < now) return { label: "Expired", intent: "warning" };
  return { label: "Active", intent: "success" };
}

/** datetime-local value (no zone) → ISO 8601 with offset for the API, or undefined. */
function toIso(localValue: string): string | undefined {
  if (!localValue) return undefined;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function AnnouncementsPage(): ReactElement {
  const principal = usePrincipal();
  const toast = useToast();
  const canManage = hasPermission(principal, "announcement.manage");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("PLAYERS");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [toEnd, setToEnd] = useState<Announcement | null>(null);

  const list = useCursorList<Announcement>(["announcements", "list"], (cursor) =>
    api.get<Page<Announcement>>(`/announcements?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canManage },
  );

  const create = useMutation({
    mutationFn: () => {
      const parsed = createAnnouncementSchema.safeParse({
        title,
        body,
        audience,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid announcement");
      return api.post<Announcement>("/announcements", parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Announcement published", intent: "success" });
      setTitle("");
      setBody("");
      setStartsAt("");
      setEndsAt("");
      list.refetch();
    },
    onError: (err) => { setError(errorMessage(err)); },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.del(`/announcements/${id}`),
    onSuccess: () => {
      toast.push({ title: "Announcement ended", intent: "success" });
      setToEnd(null);
      list.refetch();
    },
    onError: (err) => {
      toast.push({ title: "Failed", description: errorMessage(err), intent: "danger" });
      setToEnd(null);
    },
  });

  const columns: Column<Announcement>[] = [
    { key: "title", header: "Title", sortAccessor: (a) => a.title, render: (a) => <span className="font-medium text-text-hi">{a.title}</span> },
    { key: "audience", header: "Audience", render: (a) => <Badge intent="info">{humanize(a.audience)}</Badge> },
    {
      key: "window",
      header: "Window",
      render: (a) =>
        a.startsAt || a.endsAt ? (
          <span className="text-xs text-text-mid">
            {a.startsAt ? formatDateTime(a.startsAt) : "now"} → {a.endsAt ? formatDateTime(a.endsAt) : "∞"}
          </span>
        ) : (
          <span className="text-xs text-text-lo">Always on</span>
        ),
    },
    {
      key: "state",
      header: "State",
      render: (a) => {
        const s = announcementState(a);
        return <Badge intent={s.intent}>{s.label}</Badge>;
      },
    },
    { key: "created", header: "Published", sortAccessor: (a) => a.createdAt, render: (a) => formatDate(a.createdAt) },
  ];

  if (!canManage) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Announcements" subtitle="Broadcast to your subtree." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="flex flex-col gap-4 lg:col-span-1">
          <SectionTitle>Compose</SectionTitle>
          <Field label="Title" required>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); }} maxLength={160} />
          </Field>
          <Field label="Audience" required>
            <Select value={audience} onChange={(e) => { setAudience(e.target.value as Audience); }}>
              {announcementAudienceSchema.options.map((a) => (
                <option key={a} value={a}>
                  {humanize(a)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" hint="Optional">
              <Input type="datetime-local" value={startsAt} onChange={(e) => { setStartsAt(e.target.value); }} />
            </Field>
            <Field label="Ends" hint="Optional">
              <Input type="datetime-local" value={endsAt} onChange={(e) => { setEndsAt(e.target.value); }} />
            </Field>
          </div>
          <Field label="Message" required error={error}>
            <Textarea value={body} onChange={(e) => { setBody(e.target.value); }} maxLength={2000} className="min-h-[120px]" />
          </Field>
          <Button
            onClick={() => { setError(undefined); create.mutate(); }}
            loading={create.isPending}
            disabled={title.trim() === "" || body.trim() === ""}
          >
            <Send className="h-4 w-4" />
            {startsAt ? "Schedule" : "Publish"}
          </Button>
        </Panel>

        <Panel className="p-0 lg:col-span-2">
          <DataTable
            columns={columns}
            rows={list.items}
            getRowId={(a) => a.id}
            loading={list.isLoading}
            emptyTitle="No announcements"
            emptyDescription="Published announcements appear here."
            rowActions={(a) =>
              a.active ? (
                <Button size="sm" variant="ghost" onClick={() => { setToEnd(a); }}>
                  End
                </Button>
              ) : (
                <span className="text-xs text-text-lo">—</span>
              )
            }
            nextCursor={list.nextCursor}
            onLoadMore={list.loadMore}
            loadingMore={list.isFetchingNextPage}
          />
        </Panel>
      </div>

      <ConfirmDialog
        open={toEnd !== null}
        onClose={() => { setToEnd(null); }}
        onConfirm={() => { if (toEnd) deactivate.mutate(toEnd.id); }}
        title="End this announcement?"
        description={toEnd ? `"${toEnd.title}" will stop showing to its audience.` : undefined}
        confirmLabel="End announcement"
        danger
        loading={deactivate.isPending}
      />
    </div>
  );
}
