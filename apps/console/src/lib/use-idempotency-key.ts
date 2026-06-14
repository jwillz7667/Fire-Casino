"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A stable idempotency key per form-open (docs/06 §4). Regenerated each time
 * `open` transitions to true so a retry/double-click reuses the same key, but a
 * fresh dialog starts a new operation.
 */
export function useIdempotencyKey(open: boolean): string {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) setKey(crypto.randomUUID());
    wasOpen.current = open;
  }, [open]);

  return key;
}
