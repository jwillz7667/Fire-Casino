import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OperatorsController } from "./operators.controller";
import { OperatorsService } from "./operators.service";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

/**
 * The distribution tree (docs/04) and the credit issue/transfer flows
 * (docs/03 §4.1–4.2). Imports AuthModule for PasswordService (child creation);
 * the ledger and audit are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [OperatorsController, CreditsController],
  providers: [OperatorsService, CreditsService],
  exports: [OperatorsService],
})
export class OperatorsModule {}
