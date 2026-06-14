import { Module } from "@nestjs/common";
import { AnnouncementsController } from "./announcements.controller";
import { AnnouncementsService } from "./announcements.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Announcements (subtree broadcasts, docs/06 §3.13) + the per-principal
 * notification inbox (docs/06 §1, docs/07 §2.8). Audit is global; reads are
 * scoped to the principal.
 */
@Module({
  controllers: [AnnouncementsController, NotificationsController],
  providers: [AnnouncementsService, NotificationsService],
  exports: [AnnouncementsService, NotificationsService],
})
export class NotificationsModule {}
