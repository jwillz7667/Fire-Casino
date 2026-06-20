import { Injectable } from "@nestjs/common";
import { bps, INFERNO_GAME_CODE } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { spin } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const INFERNO_ENGINE = INFERNO_GAME_CODE;

/**
 * Inferno Link — real server-side game math (a 5×4, 25-line hold-and-spin fire slot).
 * Outcomes are decided server-side over the provable-fairness stream: base line wins plus,
 * on 6+ fireballs, a lock-and-respin feature whose fireball values + jackpots are paid
 * verbatim. The client only renders what the server returned. Money stays integer minor
 * units via the shared `bps` helper.
 */
@Injectable()
export class InfernoLinkProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    const { totalWinBps, outcome } = spin(rng);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
