"use client";

import { type ReactElement, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Store, Users } from "lucide-react";
import { Badge } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { OperatorNode, Page, PlayerListItem } from "@/lib/types";
import { humanize } from "@/lib/format";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/** Topbar search across players and operators in the caller's subtree. */
export function GlobalSearch(): ReactElement {
  const router = useRouter();
  const principal = usePrincipal();
  const canSeePlayers = hasPermission(principal, "player.view");
  const canSeeOperators = hasPermission(principal, "operator.view_subtree");

  const [raw, setRaw] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the typed value into the query term.
  useEffect(() => {
    const t = setTimeout(() => { setTerm(raw.trim()); }, DEBOUNCE_MS);
    return () => { clearTimeout(t); };
  }, [raw]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("mousedown", onClick); };
  }, []);

  const enabled = term.length >= MIN_CHARS;
  const players = useQuery({
    queryKey: ["search", "players", term],
    queryFn: () => api.get<Page<PlayerListItem>>(`/players?q=${encodeURIComponent(term)}&limit=6`),
    enabled: enabled && canSeePlayers,
    retry: false,
  });
  const operators = useQuery({
    queryKey: ["search", "operators", term],
    queryFn: () =>
      api.get<Page<OperatorNode>>(`/operators?scope=subtree&q=${encodeURIComponent(term)}&limit=6`),
    enabled: enabled && canSeeOperators,
    retry: false,
  });

  const isLoading = (players.isFetching && canSeePlayers) || (operators.isFetching && canSeeOperators);
  const playerHits = players.data?.items ?? [];
  const operatorHits = operators.data?.items ?? [];
  const hasResults = playerHits.length > 0 || operatorHits.length > 0;

  function go(href: string) {
    setOpen(false);
    setRaw("");
    setTerm("");
    router.push(href);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 focus-within:border-lumen">
        <Search className="h-4 w-4 text-text-lo" />
        <input
          type="text"
          value={raw}
          placeholder="Search players or operators…"
          onChange={(e) => { setRaw(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="w-full bg-transparent text-sm text-text-hi placeholder:text-text-lo focus:outline-none"
        />
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-text-lo" /> : null}
      </div>

      {open && enabled ? (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-md border border-hairline bg-surface-1 shadow-lg">
          {!hasResults && !isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-text-lo">No matches for “{term}”.</p>
          ) : null}

          {operatorHits.length > 0 ? (
            <div>
              <Group icon={<Store className="h-3.5 w-3.5" />} label="Operators" />
              {operatorHits.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { go(`/operators/${o.id}`); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <span className="truncate text-sm text-text-hi">{o.displayName}</span>
                  <Badge intent="gold">{humanize(o.tier)}</Badge>
                </button>
              ))}
            </div>
          ) : null}

          {playerHits.length > 0 ? (
            <div>
              <Group icon={<Users className="h-3.5 w-3.5" />} label="Players" />
              {playerHits.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { go(`/players/${p.id}`); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <span className="truncate text-sm text-text-hi">{p.username}</span>
                  <span className="truncate text-xs text-text-lo">{p.owningAgentName}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Group({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <div className="flex items-center gap-1.5 border-b border-hairline/60 bg-surface-2 px-3 py-1.5 text-[0.625rem] uppercase tracking-wide text-text-lo">
      {icon}
      {label}
    </div>
  );
}
