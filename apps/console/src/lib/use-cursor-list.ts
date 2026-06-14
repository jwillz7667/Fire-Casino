"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { Page } from "./types";

interface CursorListResult<T> {
  items: T[];
  nextCursor: string | undefined;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  loadMore: () => void;
  refetch: () => void;
}

/** Cursor-paginated list backed by useInfiniteQuery, flattened for DataTable. */
export function useCursorList<T>(
  queryKey: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options?: { enabled?: boolean },
): CursorListResult<T> {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options?.enabled,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const nextCursor = query.hasNextPage ? "more" : undefined;

  return {
    items,
    nextCursor,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    error: query.error,
    loadMore: () => {
      void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}
