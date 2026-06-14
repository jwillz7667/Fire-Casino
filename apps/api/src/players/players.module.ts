import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OperatorsModule } from "../operators/operators.module";
import { PlayersController } from "./players.controller";
import { PlayersService } from "./players.service";
import { WalletController } from "../wallet/wallet.controller";
import { WalletService } from "../wallet/wallet.service";

/**
 * Players, wallets, and recharge (docs/03 §4.3, docs/05 §4–5). Imports
 * AuthModule (PasswordService) and OperatorsModule (freeze check); ledger,
 * compliance, audit are global.
 */
@Module({
  imports: [AuthModule, OperatorsModule],
  controllers: [PlayersController, WalletController],
  providers: [PlayersService, WalletService],
  exports: [PlayersService],
})
export class PlayersModule {}
