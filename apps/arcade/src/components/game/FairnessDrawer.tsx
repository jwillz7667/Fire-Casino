"use client";

import { ShieldCheck } from "lucide-react";
import { Button, Drawer } from "@aureus/ui";
import type { StartSessionResponse } from "@/lib/types";

interface FairnessDrawerProps {
  open: boolean;
  onClose: () => void;
  session: StartSessionResponse | null;
  lastNonce: number | null;
  revealedServerSeed: string | null;
  onReveal: () => void;
  revealing: boolean;
}

/**
 * Provable-fairness panel (docs/05 §10, docs/07 §2.3): server seed hash, client
 * seed, and the latest nonce. Revealing ends the session and exposes the server
 * seed so the player (or a verifier) can recompute every round.
 */
export function FairnessDrawer({
  open,
  onClose,
  session,
  lastNonce,
  revealedServerSeed,
  onReveal,
  revealing,
}: FairnessDrawerProps): React.ReactElement {
  return (
    <Drawer open={open} onClose={onClose} title="Provably fair">
      {session ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 text-sm text-text-mid">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-lumen" />
            Each round is decided from a secret server seed committed before you play. Reveal it any
            time to verify nothing changed.
          </p>

          <SeedRow label="Server seed hash" value={session.serverSeedHash} />
          <SeedRow label="Client seed" value={session.clientSeed ?? "(server default)"} />
          <SeedRow label="Latest round (nonce)" value={lastNonce !== null ? String(lastNonce) : "—"} />

          {revealedServerSeed ? (
            <SeedRow label="Revealed server seed" value={revealedServerSeed} highlight />
          ) : (
            <Button variant="secondary" onClick={onReveal} loading={revealing} className="w-full">
              Reveal server seed &amp; end session
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-mid">Start a round to see fairness details.</p>
      )}
    </Drawer>
  );
}

function SeedRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-text-lo">
        {label}
      </span>
      <code
        className={`break-all rounded-sm border border-hairline px-2 py-1.5 font-mono text-xs ${
          highlight ? "bg-gold/10 text-gold-light" : "bg-surface-3 text-text-mid"
        }`}
      >
        {value}
      </code>
    </div>
  );
}
