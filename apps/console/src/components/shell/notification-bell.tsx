"use client";

import { type ReactElement, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState, IconButton, Skeleton } from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import type { NotificationRow, Page } from "@/lib/types";
import { timeAgo } from "@/lib/format";

/** Bell with unread count, fed by Notification rows (+ socket invalidation). */
export function NotificationBell(): ReactElement {
  const [open, setOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<Page<NotificationRow>>("/notifications?limit=20"),
    retry: false,
    refetchInterval: 60_000,
  });

  const items = notifications.data?.items ?? [];
  const unavailable = notifications.error instanceof ApiError;
  const unread = items.filter((n) => n.readAt === null).length;

  return (
    <div className="relative">
      <IconButton
        label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember px-1 text-[0.625rem] font-semibold text-text-on-ember">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => { setOpen(false); }} />
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-md border border-hairline-strong bg-surface-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <span className="text-sm font-medium text-text-hi">Notifications</span>
              {unread > 0 ? <Badge intent="ember">{unread} new</Badge> : null}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : unavailable || items.length === 0 ? (
                <EmptyState title="All caught up" description="You have no notifications." />
              ) : (
                <ul className="divide-y divide-hairline">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className={n.readAt === null ? "bg-surface-2/50 px-4 py-3" : "px-4 py-3"}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text-hi">{n.title}</span>
                        <span className="shrink-0 text-[0.6875rem] text-text-lo">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-mid">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
