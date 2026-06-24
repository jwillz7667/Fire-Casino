import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  type MfaConfirmInput,
  mfaConfirmSchema,
  type OperatorLoginInput,
  operatorLoginSchema,
  type OperatorSummary,
  type PasswordChangeInput,
  passwordChangeSchema,
  type PlayerLoginInput,
  playerLoginSchema,
  type PlayerSummary,
  type Env,
} from "@aureus/shared";
import {
  AllowMfaEnrollment,
  Auth,
  CurrentPrincipal,
  CurrentUser,
  Public,
} from "../common/auth/auth.decorators";
import { type OperatorPrincipal, type Principal } from "../common/auth/principal";
import { UnauthorizedError } from "../common/errors/domain-error";
import { regionFromRequest } from "../common/http/region";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AUTH_RATE_LIMIT } from "../common/throttler/throttler.config";
import { ComplianceService } from "../compliance/compliance.service";
import { ENV } from "../config/config.module";
import { type AuthContext, AuthService } from "./auth.service";
import { REFRESH_COOKIE, refreshCookieOptions } from "./cookies";

function contextOf(req: Request): AuthContext {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly compliance: ComplianceService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(AUTH_RATE_LIMIT)
  @Post("operator/login")
  @HttpCode(200)
  async operatorLogin(
    @Body(new ZodValidationPipe(operatorLoginSchema)) body: OperatorLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number; operator: OperatorSummary }> {
    const { refreshToken, ...rest } = await this.auth.operatorLogin(body, contextOf(req));
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.env));
    return rest;
  }

  @Public()
  @Throttle(AUTH_RATE_LIMIT)
  @Post("player/login")
  @HttpCode(200)
  async playerLogin(
    @Body(new ZodValidationPipe(playerLoginSchema)) body: PlayerLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number; player: PlayerSummary }> {
    // LOGIN-1: enforce the geo gate at player login (when GEO_ENFORCED) BEFORE any
    // credential check or token issuance, so a blocked/unverifiable region never
    // establishes a session. Fails closed via ComplianceService.assertRegionAllowed.
    await this.compliance.checkLogin(regionFromRequest(req));
    const { refreshToken, ...rest } = await this.auth.playerLogin(body, contextOf(req));
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.env));
    return rest;
  }

  @Public()
  @Throttle(AUTH_RATE_LIMIT)
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const current = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!current) throw new UnauthorizedError("No session");
    const { refreshToken, ...rest } = await this.auth.refresh(current, contextOf(req));
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.env));
    return rest;
  }

  @AllowMfaEnrollment()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const current = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (current) await this.auth.logout(current);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.env));
  }

  @AllowMfaEnrollment()
  @Post("password/change")
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(passwordChangeSchema)) body: PasswordChangeInput,
  ): Promise<void> {
    await this.auth.changePassword(principal, body);
  }

  @AllowMfaEnrollment()
  @Auth("operator")
  @Post("operator/mfa/enable")
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: OperatorPrincipal): Promise<{ secret: string; otpauthUrl: string }> {
    return this.auth.mfaEnable(user);
  }

  @AllowMfaEnrollment()
  @Auth("operator")
  @Post("operator/mfa/confirm")
  @HttpCode(204)
  async mfaConfirm(
    @CurrentUser() user: OperatorPrincipal,
    @Body(new ZodValidationPipe(mfaConfirmSchema)) body: MfaConfirmInput,
  ): Promise<void> {
    await this.auth.mfaConfirm(user, body.totp);
  }

  @AllowMfaEnrollment()
  @Get("me")
  me(@CurrentPrincipal() principal: Principal): Promise<OperatorSummary | PlayerSummary> {
    return principal.kind === "operator"
      ? this.auth.operatorMe(principal)
      : this.auth.playerMe(principal);
  }
}
