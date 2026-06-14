import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";

/**
 * The ledger is global: every module that moves credits posts through
 * LedgerService. No balance is written anywhere else (hard rule #2).
 */
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
