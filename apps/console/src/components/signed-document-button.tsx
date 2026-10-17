"use client";

import { type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

/** Fetch a scoped, short-lived read URL only when a reviewer opens a receipt. */
export function SignedDocumentButton({
  endpoint,
  label = "View proof",
}: {
  endpoint: string;
  label?: string;
}): ReactElement {
  const toast = useToast();
  const preview = useMutation({
    mutationFn: async () => {
      const result = await api.get<{ url: string }>(endpoint);
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error("This document could not be opened securely.");
      }
      return url.href;
    },
    onError: (error) => {
      toast.push({ title: "Preview failed", description: errorMessage(error), intent: "danger" });
    },
  });

  function openDocument(): void {
    // Open during the user's click so popup blockers do not swallow the result.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    preview.mutate(undefined, {
      onSuccess: (url) => {
        if (tab) tab.location.replace(url);
        else window.open(url, "_blank", "noopener,noreferrer");
      },
      onError: () => {
        tab?.close();
      },
    });
  }

  return (
    <Button size="sm" variant="ghost" loading={preview.isPending} onClick={openDocument}>
      <ExternalLink className="h-4 w-4" />
      {label}
    </Button>
  );
}
