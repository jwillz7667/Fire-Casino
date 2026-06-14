import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type CreateAnnouncementInput,
  createAnnouncementSchema,
  type ListAnnouncementsQuery,
  listAnnouncementsQuerySchema,
} from "@aureus/shared";
import { Auth, CurrentPrincipal, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal, type Principal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AnnouncementsService } from "./announcements.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Any authenticated principal reads the announcements targeting it. */
  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(listAnnouncementsQuerySchema)) query: ListAnnouncementsQuery,
  ) {
    return this.announcements.list(principal, query);
  }

  @Post()
  @HttpCode(201)
  @Auth("operator")
  @RequirePermission("announcement.manage")
  create(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createAnnouncementSchema)) body: CreateAnnouncementInput,
    @Req() req: Request,
  ) {
    return this.announcements.create(caller, body, ctxOf(req));
  }

  @Delete(":id")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("announcement.manage")
  deactivate(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.announcements.deactivate(caller, id, ctxOf(req));
  }
}
