"use client";

import { type ReactElement, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@aureus/ui";

/** Copy a short string to the clipboard with a transient confirmation. */
export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="secondary"
      size={size}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
