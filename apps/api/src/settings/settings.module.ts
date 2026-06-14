import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

/**
 * Platform + node settings (docs/06 §3.14). AuditService, ENV and the system
 * Prisma client are global, so no further imports are needed.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
