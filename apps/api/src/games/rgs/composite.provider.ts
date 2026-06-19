import { Injectable } from "@nestjs/common";
import { COSMIC_ENGINE, CosmicSpinsProvider } from "../engines/cosmic/cosmic.provider";
import { DRAGON_ENGINE, DragonHoardProvider } from "../engines/dragon/dragon.provider";
import { PHOENIX_ENGINE, PhoenixAscendantProvider } from "../engines/phoenix/phoenix.provider";
import { PLINKO_ENGINE, PlinkoProvider } from "../engines/plinko/plinko.provider";
import { ROYAL_ENGINE, RoyalAscendantProvider } from "../engines/royal/royal.provider";
import { WHEEL_ENGINE, FortuneWheelProvider } from "../engines/wheel/wheel.provider";
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
    dragon: DragonHoardProvider,
    wheel: FortuneWheelProvider,
    cosmic: CosmicSpinsProvider,
    plinko: PlinkoProvider,
  ) {
    this.engines = {
      [PHOENIX_ENGINE]: phoenix,
      [ROYAL_ENGINE]: royal,
      [DRAGON_ENGINE]: dragon,
      [WHEEL_ENGINE]: wheel,
      [COSMIC_ENGINE]: cosmic,
      [PLINKO_ENGINE]: plinko,
    };
  }

  play(req: RoundRequest): RoundResult {
    const key =
      typeof req.config.engine === "string" ? req.config.engine : req.gameCode;
    const engine = this.engines[key] ?? this.placeholder;
    return engine.play(req);
  }
}
