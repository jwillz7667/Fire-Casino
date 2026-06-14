"use client";

import { useSyncExternalStore } from "react";

export interface Announcement {
  id: string;
  title: string;
  body?: string;
}

let current: Announcement | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Fed by the realtime layer on `announcement` events (docs/07 §2.8). */
export function pushAnnouncement(announcement: Announcement): void {
  current = announcement;
  emit();
}

export function dismissAnnouncement(): void {
  current = null;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useAnnouncement(): Announcement | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
