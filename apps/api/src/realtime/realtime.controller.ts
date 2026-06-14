import { Controller, HttpCode, Post } from "@nestjs/common";
import { CurrentPrincipal } from "../common/auth/auth.decorators";
import { type Principal } from "../common/auth/principal";
import { RealtimeService } from "./realtime.service";

/**
 * POST /realtime/token serves both surfaces: no `@Auth` audience is declared, so
 * the global AccessTokenGuard still authenticates the caller (operator or
 * player) but imposes no audience restriction. The handler returns a fresh
 * socket handshake token plus the rooms the principal may auto-join.
 */
@Controller("realtime")
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post("token")
  @HttpCode(200)
  issueToken(@CurrentPrincipal() principal: Principal) {
    return this.realtime.issueToken(principal);
  }
}
