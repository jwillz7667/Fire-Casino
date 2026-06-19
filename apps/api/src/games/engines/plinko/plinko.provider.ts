import { Injectable } from "@nestjs/common";
import { bps, PLINKO_GAME_CODE, toPlinkoRisk } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { drop } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const PLINKO_ENGINE = PLINKO_GAME_CODE;

/**
 * Plinko — real server-side game math (a provably-fair 12-row ball drop into 13 buckets).
 * The risk tier (LOW/MEDIUM/HIGH) selects the public payout curve; it comes from the
 * per-bet params (forwarded onto `config.risk` by the bet flow) and defaults to MEDIUM.
 * Outcomes are decided server-side over the provable-fairness stream, so the client only
 * animates the path the server returned. Money stays integer minor units via `bps`.
 */
@Injectable()
export class PlinkoProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    const risk = toPlinkoRisk(
      (req.params as { risk?: unknown }).risk ?? (req.config as { risk?: unknown }).risk,
    );
    const { totalWinBps, outcome } = drop(rng, risk);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
