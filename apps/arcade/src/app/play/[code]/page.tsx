"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge, Card, CoinSpinner, EmptyState, Money, useToast } from "@aureus/ui";
import { PHOENIX_GAME_CODE, startSessionSchema } from "@aureus/shared";
import { AppShell } from "@/components/shell/AppShell";
import { BetControls } from "@/components/game/BetControls";
import { OutcomeDisplay } from "@/components/game/OutcomeDisplay";
import { PhoenixSlot } from "@/components/game/PhoenixSlot";
import { FairnessDrawer } from "@/components/game/FairnessDrawer";
import { gameTypeLabel } from "@/components/game/game-meta";
import { useAuth } from "@/lib/auth-context";
import { useCompliance, useWallet } from "@/lib/hooks";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { newIdempotencyKey } from "@/lib/idempotency";
import { fetchGame, qk } from "@/lib/queries";
import { balanceFor, currencyLabel, spendCurrency } from "@/lib/mode";
import type {
  BetResponse,
  EndSessionResponse,
  StartSessionResponse,
  WalletResponse,
} from "@/lib/types";

export default function GamePage(): React.ReactElement {
  return (
    <AppShell active="play">
      <GameScreen />
    </AppShell>
  );
}

function GameScreen(): React.ReactElement {
  const params = useParams();
  const rawCode = params.code;
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;

  const { mode, player } = useAuth();
  const currency = spendCurrency(mode);
  const toast = useToast();
  const queryClient = useQueryClient();

  const wallet = useWallet();
  const compliance = useCompliance();

  const gameQuery = useQuery({
    queryKey: qk.game(code ?? ""),
    queryFn: () => fetchGame(code ?? ""),
    enabled: Boolean(code),
  });

  const [session, setSession] = useState<StartSessionResponse | null>(null);
  const [betMinor, setBetMinor] = useState<bigint | undefined>();
  const [lastResult, setLastResult] = useState<BetResponse | null>(null);
  const [lastNonce, setLastNonce] = useState<number | null>(null);
  const [revealedServerSeed, setRevealedServerSeed] = useState<string | null>(null);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  const startMutation = useMutation({
    mutationFn: (gameCode: string): Promise<StartSessionResponse> => {
      const body = startSessionSchema.parse({
        gameCode,
        currency,
        clientSeed: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      });
      return api.post<StartSessionResponse>("/sessions", body);
    },
  });

  const betMutation = useMutation({
    mutationFn: (args: { sessionId: string; amount: bigint }): Promise<BetResponse> =>
      api.post<BetResponse>(
        `/sessions/${args.sessionId}/bet`,
        { betMinor: args.amount.toString() },
        { idempotencyKey: newIdempotencyKey() },
      ),
  });

  const endMutation = useMutation({
    mutationFn: (sessionId: string): Promise<EndSessionResponse> =>
      api.post<EndSessionResponse>(`/sessions/${sessionId}/end`),
  });

  const selfExcluded =
    compliance.data?.selfExcluded === true || player?.status === "SELF_EXCLUDED";

  const game = gameQuery.data;
  const supportsCurrency = game ? game.supportedCurrencies.includes(currency) : true;
  const isActive = game ? game.status === "ACTIVE" : true;

  const spendable = wallet.data ? balanceFor(wallet.data.wallets, currency) : "0";
  const playing = startMutation.isPending || betMutation.isPending;

  function patchWalletBalance(balanceAfterMinor: string): void {
    queryClient.setQueryData<WalletResponse>(qk.wallet, (prev) =>
      prev
        ? {
            wallets: prev.wallets.map((w) =>
              w.currency === currency ? { ...w, balanceMinor: balanceAfterMinor } : w,
            ),
          }
        : prev,
    );
  }

  async function play(): Promise<void> {
    if (!code || betMinor === undefined) return;
    setActionError(undefined);

    try {
      let active = session;
      // A revealed (ended) session can't take more rounds — open a fresh one.
      if (!active || revealedServerSeed) {
        active = await startMutation.mutateAsync(code);
        setSession(active);
        setRevealedServerSeed(null);
        setLastResult(null);
        setLastNonce(null);
      }

      const res = await betMutation.mutateAsync({
        sessionId: active.sessionId,
        amount: betMinor,
      });
      setLastResult(res);
      setLastNonce(res.round.nonce);
      patchWalletBalance(res.balanceAfterMinor);
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.walletHistory });
    } catch (err) {
      const message = messageForError(err);
      setActionError(message);
      toast.push({ title: "Can't play that round", description: message, intent: "danger" });
    }
  }

  async function reveal(): Promise<void> {
    if (!session) return;
    try {
      const res = await endMutation.mutateAsync(session.sessionId);
      setRevealedServerSeed(res.serverSeed);
    } catch (err) {
      toast.push({ title: "Couldn't reveal seed", description: messageForError(err), intent: "danger" });
    }
  }

  if (gameQuery.isLoading) {
    return <CoinSpinner label="Loading game…" />;
  }

  if (gameQuery.isError || !game) {
    return (
      <EmptyState
        title="Game unavailable"
        description="This game can't be opened right now."
        action={
          <Link href="/" className="text-sm font-medium text-gold-light">
            Back to lobby
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GameHeader name={game.name} category={gameTypeLabel(game.type)} />

      <div className="flex items-center justify-between rounded-md border border-hairline bg-surface-1 px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-text-lo">
          {currencyLabel(currency)} balance
        </span>
        <Money valueMinor={spendable} currency={currency} size="lg" />
      </div>

      {game.code === PHOENIX_GAME_CODE ? (
        <PhoenixSlot result={lastResult} currency={currency} spinning={playing} />
      ) : (
        <OutcomeDisplay result={lastResult} currency={currency} />
      )}

      {selfExcluded ? (
        <GateNotice message="You've self-excluded. Play is paused. Manage this in Me → Responsible gaming." />
      ) : !isActive ? (
        <GateNotice message="This game is temporarily unavailable." />
      ) : !supportsCurrency ? (
        <GateNotice message={`This game doesn't accept your ${currencyLabel(currency)} balance.`} />
      ) : (
        <Card className="p-4">
          <BetControls
            currency={currency}
            minMinor={BigInt(game.minBetMinor)}
            maxMinor={BigInt(game.maxBetMinor)}
            balanceMinor={BigInt(spendable)}
            betMinor={betMinor}
            onBetChange={setBetMinor}
            onPlay={() => {
              void play();
            }}
            playing={playing}
            disabled={selfExcluded}
          />
          {actionError ? <p className="mt-3 text-xs text-danger">{actionError}</p> : null}
        </Card>
      )}

      <button
        type="button"
        onClick={() => {
          setFairnessOpen(true);
        }}
        className="mx-auto flex items-center gap-1.5 text-xs font-medium text-text-mid hover:text-text-hi"
      >
        <ShieldCheck className="h-4 w-4 text-lumen" />
        Provably fair
      </button>

      <FairnessDrawer
        open={fairnessOpen}
        onClose={() => {
          setFairnessOpen(false);
        }}
        session={session}
        lastNonce={lastNonce}
        revealedServerSeed={revealedServerSeed}
        onReveal={() => {
          void reveal();
        }}
        revealing={endMutation.isPending}
      />
    </div>
  );
}

function GameHeader({ name, category }: { name: string; category: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/"
        aria-label="Back to lobby"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-mid transition-colors hover:bg-surface-3 hover:text-text-hi"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="flex flex-col">
        <h1 className="text-lg font-semibold text-text-hi">{name}</h1>
        <Badge intent="neutral">{category}</Badge>
      </div>
    </div>
  );
}

function GateNotice({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
      {message}
    </div>
  );
}
