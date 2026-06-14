import { Injectable } from "@nestjs/common";
import { bps, type GameType } from "@aureus/shared";
import { roundUniform } from "./fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "./provider";

interface Tier {
  multBps: number; // payout multiplier in basis points (20000 = 2x)
  weight: number; // relative frequency among wins
}

/**
 * Prize tables per game type — different "feel", all converge to the configured
 * RTP. With average win-multiplier A and target RTP r, the win probability is
 * P(win) = r / A, so E[payout/bet] = P(win) * A = r exactly. Slots are high
 * variance (rare, big), fish steadier (frequent, small).
 */
const TABLES: Record<GameType, Tier[]> = {
  SLOT: [
    { multBps: 20_000, weight: 60 },
    { multBps: 50_000, weight: 25 },
    { multBps: 200_000, weight: 12 },
    { multBps: 1_000_000, weight: 3 },
  ],
  FISH: [
    { multBps: 12_000, weight: 50 },
    { multBps: 15_000, weight: 30 },
    { multBps: 30_000, weight: 15 },
    { multBps: 100_000, weight: 5 },
  ],
  KENO: [
    { multBps: 20_000, weight: 50 },
    { multBps: 40_000, weight: 30 },
    { multBps: 80_000, weight: 15 },
    { multBps: 300_000, weight: 5 },
  ],
  TABLE: [
    { multBps: 20_000, weight: 50 },
    { multBps: 40_000, weight: 50 },
  ],
  OTHER: [
    { multBps: 20_000, weight: 60 },
    { multBps: 50_000, weight: 40 },
  ],
};

/**
 * Placeholder remote game server (docs/05 §10). Decides outcomes server-side
 * against the configured RTP using provable-fairness RNG. Every outcome is
 * marked demo:true. Real game math drops in behind GameProvider unchanged.
 */
@Injectable()
export class PlaceholderRgsProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const table = TABLES[req.gameType];
    const totalWeight = table.reduce((sum, t) => sum + t.weight, 0);
    const avgMultBps = table.reduce((sum, t) => sum + t.weight * t.multBps, 0) / totalWeight;
    // P(win) so that E[payout] == RTP. Bounded < 1 (avgMult always > 1x here).
    const winProbability = Math.min(req.rtpBps / avgMultBps, 0.999);

    const r = roundUniform(req.serverSeed, req.clientSeed, req.nonce);
    if (r >= winProbability) {
      return { winMinor: 0n, outcome: { kind: "placeholder", demo: true, win: false, r } };
    }

    // Map the win region [0, winProbability) onto the weighted tiers.
    const position = (r / winProbability) * totalWeight;
    let cumulative = 0;
    let chosen = table[table.length - 1]!;
    for (const tier of table) {
      cumulative += tier.weight;
      if (position < cumulative) {
        chosen = tier;
        break;
      }
    }
    const winMinor = bps(req.betMinor, chosen.multBps);
    return {
      winMinor,
      outcome: { kind: "placeholder", demo: true, win: true, multBps: chosen.multBps, r },
    };
  }
}
