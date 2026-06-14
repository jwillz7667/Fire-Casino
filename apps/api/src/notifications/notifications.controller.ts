import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
} from "@aureus/shared";
import { CurrentPrincipal } from "../common/auth/auth.decorators";
import { type Principal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Own inbox (operator or player), most recent first, with the unread count. */
  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.notifications.list(principal, query);
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentPrincipal() principal: Principal) {
    return this.notifications.markAllRead(principal);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@CurrentPrincipal() principal: Principal, @Param("id") id: string) {
    return this.notifications.markRead(principal, id);
  }
}
