import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type RechargeInput,
  rechargeSchema,
  type RechargeRequestInput,
  rechargeRequestSchema,
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
  rechargeRequest(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(rechargeRequestSchema)) body: RechargeRequestInput,
    @Req() req: Request,
  ) {
    return this.wallet.rechargeRequest(player, body, ctxOf(req));
  }
}
