import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import {
  type CancelRedemptionInput,
  cancelRedemptionSchema,
  type CreateRedemptionInput,
  createRedemptionSchema,
  type ListRedemptionsQuery,
  listRedemptionsQuerySchema,
  type PresignProofInput,
  presignProofSchema,
  type RedemptionQueueQuery,
  redemptionQueueQuerySchema,
  type RejectRedemptionInput,
  rejectRedemptionSchema,
  type SettleRedemptionInput,
  settleRedemptionSchema,
} from "@aureus/shared";
import { Auth, CurrentPlayer, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MONEY_RATE_LIMIT } from "../common/throttler/throttler.config";
import { RedemptionsService } from "./redemptions.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("redemptions")
export class RedemptionsController {
  constructor(private readonly redemptions: RedemptionsService) {}

  // ---- player surface --------------------------------------------------------

  @Post()
  @HttpCode(201)
  @Auth("player")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  request(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(createRedemptionSchema)) body: CreateRedemptionInput,
    @Req() req: Request,
  ) {
    return this.redemptions.request(player, body, ctxOf(req));
  }

  @Get()
  @Auth("player")
  listMine(
    @CurrentPlayer() player: PlayerPrincipal,
    @Query(new ZodValidationPipe(listRedemptionsQuerySchema)) query: ListRedemptionsQuery,
  ) {
    return this.redemptions.listMine(player, query);
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @Auth("player")
  withdraw(
    @CurrentPlayer() player: PlayerPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelRedemptionSchema)) body: CancelRedemptionInput,
    @Req() req: Request,
  ) {
    return this.redemptions.withdraw(player, id, body, ctxOf(req));
  }

  // ---- operator surface (static paths declared before :id) -------------------

  @Get("queue")
  @Auth("operator")
  @RequirePermission("redemption.view")
  queue(@Query(new ZodValidationPipe(redemptionQueueQuerySchema)) query: RedemptionQueueQuery) {
    return this.redemptions.queue(query);
  }

  @Post("proof-url")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("redemption.settle")
  presignProof(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(presignProofSchema)) body: PresignProofInput,
  ) {
    return this.redemptions.presignProof(caller, body.filename);
  }

  @Get(":id")
  @Auth("operator")
  @RequirePermission("redemption.view")
  get(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string) {
    return this.redemptions.get(caller, id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Auth("operator")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  @RequirePermission("redemption.approve")
  approve(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.redemptions.approve(caller, id, ctxOf(req));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("redemption.approve")
  reject(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectRedemptionSchema)) body: RejectRedemptionInput,
    @Req() req: Request,
  ) {
    return this.redemptions.reject(caller, id, body, ctxOf(req));
  }

  @Post(":id/settle")
  @HttpCode(200)
  @Auth("operator")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  @RequirePermission("redemption.settle")
  settle(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(settleRedemptionSchema)) body: SettleRedemptionInput,
    @Req() req: Request,
  ) {
    return this.redemptions.settle(caller, id, body, ctxOf(req));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Auth("operator")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  @RequirePermission("redemption.approve")
  cancel(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelRedemptionSchema)) body: CancelRedemptionInput,
    @Req() req: Request,
  ) {
    return this.redemptions.cancel(caller, id, body, ctxOf(req));
  }
}
