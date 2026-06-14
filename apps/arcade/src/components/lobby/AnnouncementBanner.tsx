"use client";

import { Megaphone, X } from "lucide-react";
import { dismissAnnouncement, useAnnouncement } from "@/lib/announcements";

export function AnnouncementBanner(): React.ReactElement | null {
  const announcement = useAnnouncement();
  if (!announcement) return null;

  return (
    <div className="flex items-start gap-3 rounded-md border border-lumen/30 bg-lumen/10 px-3 py-2.5">
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-lumen" aria-hidden="true" />
      <div className="flex-1">
        <div className="text-sm font-medium text-text-hi">{announcement.title}</div>
        {announcement.body ? (
          <div className="mt-0.5 text-xs text-text-mid">{announcement.body}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismissAnnouncement}
        aria-label="Dismiss announcement"
        className="rounded-sm p-0.5 text-text-lo hover:text-text-hi"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
