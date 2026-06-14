import { Module } from "@nestjs/common";
import { GamesController } from "./games.controller";
import { SessionsController } from "./sessions.controller";
import { GamesService } from "./games.service";
import { PlaceholderRgsProvider } from "./rgs/placeholder.provider";
import { GAME_PROVIDER } from "./rgs/provider";

/**
 * Games: catalog + server-authoritative play on the stubbed RGS (docs/05 §10).
 * The GameProvider is bound to the placeholder; a real game registers behind the
 * same token. Ledger, compliance, and audit are global.
 */
@Module({
  controllers: [GamesController, SessionsController],
  providers: [GamesService, { provide: GAME_PROVIDER, useClass: PlaceholderRgsProvider }],
  exports: [GamesService],
})
export class GamesModule {}
