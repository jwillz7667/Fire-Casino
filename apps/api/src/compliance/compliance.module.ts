import { Global, Module } from "@nestjs/common";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";
import { GeoService } from "./geo.service";
import { KycService } from "./kyc.service";
import { AmlService } from "./aml.service";
import { RgService } from "./rg.service";
import { PromotionsService } from "./promotions.service";

/**
 * Compliance (hard rule #7): the enforcement gates (ComplianceService) and the
 * management surface that writes the records they read — geo, KYC, RG limits,
 * self-exclusion, AML flags, and promotions. Global so the gates inject
 * everywhere; AmlService is exported so detection rules elsewhere can raise
 * flags via createFlag. Ledger/audit/storage are global.
 */
@Global()
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, GeoService, KycService, AmlService, RgService, PromotionsService],
  exports: [ComplianceService, AmlService],
})
export class ComplianceModule {}
