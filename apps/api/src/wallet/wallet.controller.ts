import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import {
  type RechargeInput,
  rechargeSchema,
  type RechargeRequestInput,
  rechargeRequestSchema,
  type RemoveCreditsInput,
  removeCreditsSchema,
  type WalletHistoryQuery,
  walletHistoryQuerySchema,
} from "@aureus/shared";
import {
  Auth,
  CurrentPlayer,
  CurrentUser,
  RequirePermission,
  ScopeCheck,
} from "../common/auth/auth.decorators";
import { IdempotencyKey } from "../common/auth/idempotency.decorator";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MONEY_RATE_LIMIT } from "../common/throttler/throttler.config";
import { WalletService } from "./wallet.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Post("recharge")
  @HttpCode(200)
  @Auth("operator")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  @RequirePermission("player.recharge")
  @ScopeCheck({ playerIdFrom: [{ source: "body", key: "playerId" }] })
  recharge(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(rechargeSchema)) body: RechargeInput,
    @IdempotencyKey() idempotencyKey: string,
    @Req() req: Request,
  ) {
    return this.wallet.recharge(caller, body, idempotencyKey, ctxOf(req));
  }

  @Post("remove")
  @HttpCode(200)
  @Auth("operator")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  @RequirePermission("player.deduct")
  @ScopeCheck({ playerIdFrom: [{ source: "body", key: "playerId" }] })
  removeCredits(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(removeCreditsSchema)) body: RemoveCreditsInput,
    @IdempotencyKey() idempotencyKey: string,
    @Req() req: Request,
  ) {
    return this.wallet.removeCredits(caller, body, idempotencyKey, ctxOf(req));
  }

  @Get()
  @Auth("player")
  getWallet(@CurrentPlayer() player: PlayerPrincipal) {
    return this.wallet.getWallet(player);
  }

  @Get("history")
  @Auth("player")
  getHistory(
    @CurrentPlayer() player: PlayerPrincipal,
    @Query(new ZodValidationPipe(walletHistoryQuerySchema)) query: WalletHistoryQuery,
  ) {
    return this.wallet.getHistory(player, query);
  }

  @Post("recharge-request")
  @HttpCode(200)
  @Auth("player")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  rechargeRequest(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(rechargeRequestSchema)) body: RechargeRequestInput,
    @Req() req: Request,
  ) {
    return this.wallet.rechargeRequest(player, body, ctxOf(req));
  }
}
