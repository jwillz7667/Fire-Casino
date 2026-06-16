import { Injectable } from "@nestjs/common";
import { PHOENIX_ENGINE, PhoenixAscendantProvider } from "../engines/phoenix/phoenix.provider";
import { ROYAL_ENGINE, RoyalAscendantProvider } from "../engines/royal/royal.provider";
import { PlaceholderRgsProvider } from "./placeholder.provider";
import { type GameProvider, type RoundRequest, type RoundResult } from "./provider";

/**
 * Routes each round to the right game engine. A game opts into a real engine via
 * `config.engine` (preferred) or by matching game code; everything else falls back
 * to the RTP-honouring placeholder. New engines register here behind the same
 * GameProvider token — `games.service` is unaware of which engine ran.
 */
@Injectable()
export class CompositeGameProvider implements GameProvider {
  private readonly engines: Record<string, GameProvider>;

  constructor(
    private readonly placeholder: PlaceholderRgsProvider,
    phoenix: PhoenixAscendantProvider,
    royal: RoyalAscendantProvider,
  ) {
    this.engines = { [PHOENIX_ENGINE]: phoenix, [ROYAL_ENGINE]: royal };
  }

  play(req: RoundRequest): RoundResult {
    const key =
      typeof req.config.engine === "string" ? req.config.engine : req.gameCode;
    const engine = this.engines[key] ?? this.placeholder;
    return engine.play(req);
  }
}
