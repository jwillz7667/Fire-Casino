import { Injectable } from "@nestjs/common";
import { bps, COSMIC_GAME_CODE } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { spin } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const COSMIC_ENGINE = COSMIC_GAME_CODE;

/**
 * Cosmic Spins slot — real server-side game math (5×3, 25 fixed paylines, WILD on the
 * interior reels, SCATTER → free spins with a deterministic rising multiplier, and a
 * headline BONUS that pays an instant 20×/100×/500× credit prize on 3+ anywhere).
 * Outcomes are decided server-side over the provable-fairness stream (commit serverSeed →
 * HMAC per draw → reveal), so the client only renders what the server returned. The engine
 * yields a win in bps of total bet; money stays integer minor units via the shared `bps`
 * helper.
 */
@Injectable()
export class CosmicSpinsProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    const { totalWinBps, outcome } = spin(rng);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
