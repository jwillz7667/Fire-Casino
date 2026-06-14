import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import {
  type AmlFlagsQuery,
  amlFlagsQuerySchema,
  type CreatePromotionInput,
  createPromotionSchema,
  type KycDecisionInput,
  kycDecisionSchema,
  type KycQueueQuery,
  kycQueueQuerySchema,
  type KycSubmitInput,
  kycSubmitSchema,
  type PresignKycDocInput,
  presignKycDocSchema,
  type RedeemPromoInput,
  redeemPromoSchema,
  type ResolveAmlFlagInput,
  resolveAmlFlagSchema,
  type SelfExcludeInput,
  selfExcludeSchema,
  type SetRgLimitInput,
  setRgLimitSchema,
  type UpsertGeoRuleInput,
  upsertGeoRuleSchema,
} from "@aureus/shared";
import {
  Auth,
  CurrentPlayer,
  CurrentUser,
  RequirePermission,
  ScopeCheck,
} from "../common/auth/auth.decorators";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MONEY_RATE_LIMIT } from "../common/throttler/throttler.config";
import { ComplianceService } from "./compliance.service";
import { GeoService } from "./geo.service";
import { KycService } from "./kyc.service";
import { AmlService } from "./aml.service";
import { RgService } from "./rg.service";
import { PromotionsService } from "./promotions.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

const SCOPE_PLAYER_ID = { playerIdFrom: [{ source: "params" as const, key: "id" }] };

/**
 * Compliance management surface (docs/05 §8): geo rules, KYC, responsible
 * gaming, self-exclusion, AML flags, promotions, and the per-player compliance
 * state. A single audience per handler (method-level @Auth): admin routes are
 * gated by compliance.manage/compliance.view and @ScopeCheck'd to the caller's
 * subtree; player self routes act only on the caller's own id. The enforcement
 * gates (ComplianceService) read the records these endpoints write.
 */
@Controller("compliance")
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly geo: GeoService,
    private readonly kyc: KycService,
    private readonly aml: AmlService,
    private readonly rg: RgService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---- geo (admin) -----------------------------------------------------------

  @Get("geo")
  @Auth("operator")
  @RequirePermission("compliance.view")
  listGeo() {
    return this.geo.list();
  }

  @Post("geo")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("compliance.manage")
  upsertGeo(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(upsertGeoRuleSchema)) body: UpsertGeoRuleInput,
    @Req() req: Request,
  ) {
    return this.geo.upsert(caller, body, ctxOf(req));
  }

  @Delete("geo/:region")
  @Auth("operator")
  @RequirePermission("compliance.manage")
  removeGeo(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("region") region: string,
    @Req() req: Request,
  ) {
    return this.geo.remove(caller, region, ctxOf(req));
  }

  // ---- KYC: player self ------------------------------------------------------

  @Post("kyc/submit")
  @HttpCode(200)
  @Auth("player")
  submitMyKyc(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(kycSubmitSchema)) body: KycSubmitInput,
    @Req() req: Request,
  ) {
    return this.kyc.submit(player, player.playerId, body, ctxOf(req));
  }

  @Post("kyc/doc-url")
  @HttpCode(200)
  @Auth("player")
  presignMyKycDoc(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(presignKycDocSchema)) body: PresignKycDocInput,
  ) {
    return this.kyc.presignDoc(player, player.playerId, body);
  }

  // ---- KYC: admin ------------------------------------------------------------

  @Get("kyc/queue")
  @Auth("operator")
  @RequirePermission("compliance.manage")
  kycQueue(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(kycQueueQuerySchema)) query: KycQueueQuery,
  ) {
    return this.kyc.queue(caller, query);
  }

  // ---- responsible gaming: player self ---------------------------------------

  @Get("rg-limits")
  @Auth("player")
  myRgLimits(@CurrentPlayer() player: PlayerPrincipal) {
    return this.rg.getLimits(player.playerId);
  }

  @Post("rg-limits")
  @HttpCode(200)
  @Auth("player")
  setMyRgLimit(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(setRgLimitSchema)) body: SetRgLimitInput,
    @Req() req: Request,
  ) {
    return this.rg.setLimit(player, player.playerId, body, ctxOf(req));
  }

  @Post("self-exclude")
  @HttpCode(200)
  @Auth("player")
  selfExcludeMe(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(selfExcludeSchema)) body: SelfExcludeInput,
    @Req() req: Request,
  ) {
    return this.rg.selfExclude(player, player.playerId, body, ctxOf(req));
  }

  // ---- AML (admin) -----------------------------------------------------------

  @Get("aml/flags")
  @Auth("operator")
  @RequirePermission("compliance.manage")
  amlFlags(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(amlFlagsQuerySchema)) query: AmlFlagsQuery,
  ) {
    return this.aml.listFlags(caller, query);
  }

  @Post("aml/flags/:id/resolve")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("compliance.manage")
  resolveAmlFlag(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveAmlFlagSchema)) body: ResolveAmlFlagInput,
    @Req() req: Request,
  ) {
    return this.aml.resolve(caller, id, body, ctxOf(req));
  }

  // ---- promotions ------------------------------------------------------------

  @Post("promotions")
  @Auth("operator")
  @RequirePermission("compliance.manage")
  createPromotion(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createPromotionSchema)) body: CreatePromotionInput,
    @Req() req: Request,
  ) {
    return this.promotions.create(caller, body, ctxOf(req));
  }

  @Get("promotions")
  @Auth("operator")
  @RequirePermission("compliance.view")
  listPromotions() {
    return this.promotions.list();
  }

  @Post("promotions/redeem")
  @HttpCode(200)
  @Auth("player")
  @UseGuards(ThrottlerGuard)
  @Throttle(MONEY_RATE_LIMIT)
  redeemPromotion(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(redeemPromoSchema)) body: RedeemPromoInput,
    @Req() req: Request,
  ) {
    return this.promotions.redeem(player, body, ctxOf(req));
  }

  // ---- self compliance state -------------------------------------------------

  @Get("me")
  @Auth("player")
  myComplianceState(@CurrentPlayer() player: PlayerPrincipal) {
    return this.compliance.getState(player.playerId);
  }

  // ---- per-player admin routes (scoped to caller subtree) --------------------

  @Get("players/:id/state")
  @Auth("operator")
  @RequirePermission("compliance.view")
  @ScopeCheck(SCOPE_PLAYER_ID)
  playerComplianceState(@Param("id") id: string) {
    return this.compliance.getState(id);
  }

  @Post("players/:id/kyc/submit")
  @HttpCode(200)
  @Auth("operator")
  @ScopeCheck(SCOPE_PLAYER_ID)
  submitPlayerKyc(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(kycSubmitSchema)) body: KycSubmitInput,
    @Req() req: Request,
  ) {
    return this.kyc.submit(caller, id, body, ctxOf(req));
  }

  @Post("players/:id/kyc/doc-url")
  @HttpCode(200)
  @Auth("operator")
  @ScopeCheck(SCOPE_PLAYER_ID)
  presignPlayerKycDoc(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(presignKycDocSchema)) body: PresignKycDocInput,
  ) {
    return this.kyc.presignDoc(caller, id, body);
  }

  @Post("players/:id/kyc/decision")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("compliance.manage")
  @ScopeCheck(SCOPE_PLAYER_ID)
  decidePlayerKyc(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(kycDecisionSchema)) body: KycDecisionInput,
    @Req() req: Request,
  ) {
    return this.kyc.decision(caller, id, body, ctxOf(req));
  }

  @Get("players/:id/rg-limits")
  @Auth("operator")
  @RequirePermission("compliance.view")
  @ScopeCheck(SCOPE_PLAYER_ID)
  playerRgLimits(@Param("id") id: string) {
    return this.rg.getLimits(id);
  }

  @Post("players/:id/rg-limits")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("compliance.manage")
  @ScopeCheck(SCOPE_PLAYER_ID)
  setPlayerRgLimit(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setRgLimitSchema)) body: SetRgLimitInput,
    @Req() req: Request,
  ) {
    return this.rg.setLimit(caller, id, body, ctxOf(req));
  }

  @Post("players/:id/self-exclude")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("compliance.manage")
  @ScopeCheck(SCOPE_PLAYER_ID)
  selfExcludePlayer(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(selfExcludeSchema)) body: SelfExcludeInput,
    @Req() req: Request,
  ) {
    return this.rg.selfExclude(caller, id, body, ctxOf(req));
  }
}
