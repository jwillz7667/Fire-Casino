import { Injectable } from "@nestjs/common";
import { bps, LEVIATHAN_GAME_CODE } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { spin } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const LEVIATHAN_ENGINE = LEVIATHAN_GAME_CODE;

/**
 * Leviathan's Deep slot — real server-side game math (6×5 ways-to-win, tumbling reels with a
 * rising cascade ladder, WILD on the interior reels, SCATTER → free spins under a persistent
 * MULT_ORB-fed "rising tide" multiplier, and a headline BONUS that awakens the Kraken for an
 * instant fixed 20×/75×/300×/1000× prize on 3+ anywhere). Outcomes are decided server-side over
 * the provable-fairness stream (commit serverSeed → HMAC per draw → reveal), so the client only
 * renders what the server returned. The engine yields a win in bps of total bet; money stays
 * integer minor units via the shared `bps` helper.
 */
@Injectable()
export class LeviathanProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    const { totalWinBps, outcome } = spin(rng);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
