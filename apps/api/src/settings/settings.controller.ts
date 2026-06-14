import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type UpdateNodeSettingsInput,
  updateNodeSettingsSchema,
  type UpdatePlatformSettingsInput,
  updatePlatformSettingsSchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SettingsService } from "./settings.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("settings")
@Auth("operator")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("platform")
  @RequirePermission("platform.settings")
  getPlatform() {
    return this.settings.getPlatform();
  }

  @Put("platform")
  @RequirePermission("platform.settings")
  updatePlatform(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(updatePlatformSettingsSchema)) body: UpdatePlatformSettingsInput,
    @Req() req: Request,
  ) {
    return this.settings.updatePlatform(caller, body, ctxOf(req));
  }

  @Get("node")
  @RequirePermission("settings.manage")
  getNode(@CurrentUser() caller: OperatorPrincipal) {
    return this.settings.getNode(caller);
  }

  @Put("node")
  @RequirePermission("settings.manage")
  updateNode(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(updateNodeSettingsSchema)) body: UpdateNodeSettingsInput,
    @Req() req: Request,
  ) {
    return this.settings.updateNode(caller, body, ctxOf(req));
  }
}
