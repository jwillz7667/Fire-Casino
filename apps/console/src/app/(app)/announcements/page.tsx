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
import { formatDate, humanize } from "@/lib/format";

type Audience = "PLAYERS" | "OPERATORS" | "BOTH";

export default function AnnouncementsPage(): ReactElement {
  const principal = usePrincipal();
  const toast = useToast();
  const canManage = hasPermission(principal, "announcement.manage");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("PLAYERS");
  const [error, setError] = useState<string | undefined>();

  const list = useCursorList<Announcement>(["announcements", "list"], (cursor) =>
    api.get<Page<Announcement>>(`/announcements?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canManage },
  );

  const create = useMutation({
    mutationFn: () => {
      const parsed = createAnnouncementSchema.safeParse({ title, body, audience });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid announcement");
      return api.post<Announcement>("/announcements", parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Announcement published", intent: "success" });
      setTitle("");
      setBody("");
      list.refetch();
    },
    onError: (err) => { setError(errorMessage(err)); },
  });

  const columns: Column<Announcement>[] = [
    { key: "title", header: "Title", render: (a) => <span className="font-medium text-text-hi">{a.title}</span> },
    { key: "audience", header: "Audience", render: (a) => <Badge intent="info">{humanize(a.audience)}</Badge> },
    { key: "active", header: "State", render: (a) => <Badge intent={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Ended"}</Badge> },
    { key: "created", header: "Published", render: (a) => formatDate(a.createdAt) },
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
          <Field label="Message" required error={error}>
            <Textarea value={body} onChange={(e) => { setBody(e.target.value); }} maxLength={2000} className="min-h-[120px]" />
          </Field>
          <Button
            onClick={() => { setError(undefined); create.mutate(); }}
            loading={create.isPending}
            disabled={title.trim() === "" || body.trim() === ""}
          >
            <Send className="h-4 w-4" />
            Publish
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
            nextCursor={list.nextCursor}
            onLoadMore={list.loadMore}
            loadingMore={list.isFetchingNextPage}
          />
        </Panel>
      </div>
    </div>
  );
}
