import { Module } from "@nestjs/common";
import { OperatorsModule } from "../operators/operators.module";
import { RedemptionsController } from "./redemptions.controller";
import { RedemptionsService } from "./redemptions.service";

/**
 * The cashout workflow (docs/03 §4.5, docs/05 §7): request → approve (hold) →
 * settle (drain to mint), with reject/withdraw/cancel branches. Imports
 * OperatorsModule for the freeze check; ledger, compliance, audit, and storage
 * are global.
 */
@Module({
  imports: [OperatorsModule],
  controllers: [RedemptionsController],
  providers: [RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
