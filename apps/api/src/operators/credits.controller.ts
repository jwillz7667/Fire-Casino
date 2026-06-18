import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import {
  type IssueCreditsInput,
  issueCreditsSchema,
  type TransferCreditsInput,
  transferCreditsSchema,
} from "@aureus/shared";
import {
  Auth,
  CurrentUser,
  RequirePermission,
  ScopeCheck,
} from "../common/auth/auth.decorators";
import { IdempotencyKey } from "../common/auth/idempotency.decorator";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MONEY_RATE_LIMIT } from "../common/throttler/throttler.config";
import { CreditsService } from "./credits.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Auth("operator")
@Throttle(MONEY_RATE_LIMIT)
@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Post("issue")
  @HttpCode(200)
  @RequirePermission("credit.mint")
  @ScopeCheck({ operatorIdFrom: [{ source: "body", key: "operatorId" }] })
  issue(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(issueCreditsSchema)) body: IssueCreditsInput,
    @IdempotencyKey() idempotencyKey: string,
    @Req() req: Request,
  ) {
    return this.credits.issue(caller, body, idempotencyKey, ctxOf(req));
  }

  @Post("transfer")
  @HttpCode(200)
  @RequirePermission("credit.transfer_down")
  @ScopeCheck({ operatorIdFrom: [{ source: "body", key: "toOperatorId" }] })
  transfer(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(transferCreditsSchema)) body: TransferCreditsInput,
    @IdempotencyKey() idempotencyKey: string,
    @Req() req: Request,
  ) {
    return this.credits.transfer(caller, body, idempotencyKey, ctxOf(req));
  }
}
