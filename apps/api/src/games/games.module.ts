import { Module } from "@nestjs/common";
import { GamesController } from "./games.controller";
import { SessionsController } from "./sessions.controller";
import { GamesService } from "./games.service";
import { PhoenixAscendantProvider } from "./engines/phoenix/phoenix.provider";
import { RoyalAscendantProvider } from "./engines/royal/royal.provider";
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
    { provide: GAME_PROVIDER, useClass: CompositeGameProvider },
  ],
  exports: [GamesService],
})
export class GamesModule {}
