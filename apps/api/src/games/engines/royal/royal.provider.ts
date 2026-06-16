import { Injectable } from "@nestjs/common";
import { bps, ROYAL_GAME_CODE } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { spin } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const ROYAL_ENGINE = ROYAL_GAME_CODE;

/**
 * Royal Ascendant slot — real server-side game math (5×3, 243 ways, JOKER wild on
 * the interior reels, CHEST scatter → free spins with a deterministic rising
 * multiplier). Outcomes are decided server-side over the provable-fairness stream
 * (commit serverSeed → HMAC per draw → reveal), so the client only renders what the
 * server returned. The engine yields a win in bps of total bet; money stays integer
 * minor units via the shared `bps` helper.
 */
@Injectable()
export class RoyalAscendantProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    const { totalWinBps, outcome } = spin(rng);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
