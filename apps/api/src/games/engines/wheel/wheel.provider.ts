import { Injectable } from "@nestjs/common";
import { bps, toWheelRisk, WHEEL_GAME_CODE } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { type GameProvider, type RoundRequest, type RoundResult } from "../../rgs/provider";
import { spin } from "./engine";

/** Game code / config.engine value that routes a round to this engine. */
export const WHEEL_ENGINE = WHEEL_GAME_CODE;

/**
 * Fortune Wheel — real server-side game math (a single provably-fair landing over 30
 * equal segments). The risk tier (LOW/MEDIUM/HIGH) selects the public wheel layout; it
 * comes from the per-bet params (forwarded onto `config.risk` by the bet flow) and
 * defaults to MEDIUM. Outcomes are decided server-side over the provable-fairness stream,
 * so the client only renders what the server returned. Money stays integer minor units
 * via the shared `bps` helper.
 */
@Injectable()
export class FortuneWheelProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce);
    // Per-bet risk (forwarded by the client) wins; fall back to a catalog default, then MEDIUM.
    const risk = toWheelRisk(
      (req.params as { risk?: unknown }).risk ?? (req.config as { risk?: unknown }).risk,
    );
    const { totalWinBps, outcome } = spin(rng, risk);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };
  }
}
