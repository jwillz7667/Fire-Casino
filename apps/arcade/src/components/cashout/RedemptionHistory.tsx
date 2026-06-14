"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Money, SectionTitle, Skeleton, StatusPill, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { fetchRedemptions, qk } from "@/lib/queries";
import type { RedemptionDTO } from "@/lib/types";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RedemptionHistory(): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: qk.redemptions,
    queryFn: ({ pageParam }) => fetchRedemptions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api.post(`/redemptions/${id}/withdraw`, { reason: "Withdrawn by player" }),
    onSuccess: () => {
      toast.push({ title: "Request withdrawn", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: qk.redemptions });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (err) => {
      toast.push({ title: "Couldn't withdraw", description: messageForError(err), intent: "danger" });
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Cash out history</SectionTitle>

      {query.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No cash outs yet" description="Your redemption requests will appear here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <RedemptionRow
              key={item.id}
              item={item}
              onWithdraw={() => {
                withdraw.mutate(item.id);
              }}
              withdrawing={withdraw.isPending && withdraw.variables === item.id}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function RedemptionRow({
  item,
  onWithdraw,
  withdrawing,
}: {
  item: RedemptionDTO;
  onWithdraw: () => void;
  withdrawing: boolean;
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-1 p-3">
      <div className="flex items-center justify-between">
        <Money valueMinor={item.amountMinor} currency={item.currency} size="lg" />
        <StatusPill status={item.status} />
      </div>
      <div className="flex items-center justify-between text-xs text-text-lo">
        <span>
          {item.method ?? "—"} · {formatWhen(item.createdAt)}
        </span>
        {item.status === "PENDING" ? (
          <Button variant="ghost" size="sm" loading={withdrawing} onClick={onWithdraw}>
            Withdraw
          </Button>
        ) : null}
      </div>
      {item.status === "REJECTED" && item.rejectionReason ? (
        <p className="text-xs text-danger">{item.rejectionReason}</p>
      ) : null}
    </li>
  );
}
