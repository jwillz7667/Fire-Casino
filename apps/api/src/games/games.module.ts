import { Module } from "@nestjs/common";
import { GamesController } from "./games.controller";
import { SessionsController } from "./sessions.controller";
import { GamesService } from "./games.service";
import { CosmicSpinsProvider } from "./engines/cosmic/cosmic.provider";
import { DragonHoardProvider } from "./engines/dragon/dragon.provider";
import { PhoenixAscendantProvider } from "./engines/phoenix/phoenix.provider";
import { PlinkoProvider } from "./engines/plinko/plinko.provider";
import { RoyalAscendantProvider } from "./engines/royal/royal.provider";
import { FortuneWheelProvider } from "./engines/wheel/wheel.provider";
import { CompositeGameProvider } from "./rgs/composite.provider";
import { PlaceholderRgsProvider } from "./rgs/placeholder.provider";
import { GAME_PROVIDER } from "./rgs/provider";

/**
 * Games: catalog + server-authoritative play (docs/05 §10). The GameProvider is a
 * dispatcher: real engines (Phoenix Ascendant) run their own math, everything else
 * falls back to the RTP-honouring placeholder. Ledger, compliance, audit are global.
 */
@Module({
  controllers: [GamesController, SessionsController],
  providers: [
    GamesService,
    PlaceholderRgsProvider,
    PhoenixAscendantProvider,
    RoyalAscendantProvider,
    DragonHoardProvider,
    FortuneWheelProvider,
    CosmicSpinsProvider,
    PlinkoProvider,
    { provide: GAME_PROVIDER, useClass: CompositeGameProvider },
  ],
  exports: [GamesService],
})
export class GamesModule {}
