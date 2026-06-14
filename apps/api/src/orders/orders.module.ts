import { Module } from "@nestjs/common";
import { OperatorsModule } from "../operators/operators.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

/**
 * Offline credit-purchase workflow (docs/03 §9, docs/05 §3): request → ack →
 * mark-paid → issue (posts the ledger transfer/mint and links it to the order)
 * → reject/cancel. Imports OperatorsModule for the freeze check; ledger, audit,
 * and storage are global.
 */
@Module({
  imports: [OperatorsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
