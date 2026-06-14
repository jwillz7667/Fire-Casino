"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchWalletHistory, qk } from "@/lib/queries";
import { HistoryList } from "./HistoryList";

/** Infinite, cursor-paginated activity feed over the player's ledger entries. */
export function HistoryFeed({
  emptyTitle,
  emptyDescription,
}: {
  emptyTitle?: string;
  emptyDescription?: string;
}): React.ReactElement {
  const query = useInfiniteQuery({
    queryKey: qk.walletHistory,
    queryFn: ({ pageParam }) => fetchWalletHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <HistoryList
      items={items}
      loading={query.isLoading}
      hasMore={Boolean(query.hasNextPage)}
      onLoadMore={() => {
        void query.fetchNextPage();
      }}
      loadingMore={query.isFetchingNextPage}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  );
}
