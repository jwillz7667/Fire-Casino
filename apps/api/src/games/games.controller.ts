import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  type CreateGameInput,
  createGameSchema,
  currencySchema,
  type SetGameStatusInput,
  setGameStatusSchema,
  type SetRtpOverrideInput,
  setRtpOverrideSchema,
  type UpdateGameInput,
  updateGameSchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission, ScopeCheck } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { GamesService } from "./games.service";

@Controller("games")
export class GamesController {
  constructor(private readonly games: GamesService) {}

  // Catalog reads: any authenticated principal (operator or player).
  @Get()
  list(@Query("currency") currency?: string) {
    const parsed = currency ? currencySchema.safeParse(currency) : undefined;
    return this.games.listCatalog(parsed?.success ? parsed.data : undefined);
  }

  // ---- win-rate overrides (declared before :code so "rtp" isn't read as a code) ----

  @Get("rtp")
  @Auth("operator")
  @RequirePermission("game.rtp_agent")
  listRtp(@CurrentUser() caller: OperatorPrincipal) {
    return this.games.listAgentRtp(caller);
  }

  @Put("rtp/:code")
  @Auth("operator")
  @RequirePermission("game.rtp_agent")
  setAgentRtp(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("code") code: string,
    @Body(new ZodValidationPipe(setRtpOverrideSchema)) body: SetRtpOverrideInput,
  ) {
    return this.games.setRtpOverride(caller, code, body.rtpBps, null);
  }

  @Delete("rtp/:code")
  @Auth("operator")
  @RequirePermission("game.rtp_agent")
  clearAgentRtp(@CurrentUser() caller: OperatorPrincipal, @Param("code") code: string) {
    return this.games.clearRtpOverride(caller, code, null);
  }

  @Put("rtp/:code/players/:playerId")
  @Auth("operator")
  @RequirePermission("game.rtp_agent")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "playerId" }] })
  setPlayerRtp(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("code") code: string,
    @Param("playerId") playerId: string,
    @Body(new ZodValidationPipe(setRtpOverrideSchema)) body: SetRtpOverrideInput,
  ) {
    return this.games.setRtpOverride(caller, code, body.rtpBps, playerId);
  }

  @Delete("rtp/:code/players/:playerId")
  @Auth("operator")
  @RequirePermission("game.rtp_agent")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "playerId" }] })
  clearPlayerRtp(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("code") code: string,
    @Param("playerId") playerId: string,
  ) {
    return this.games.clearRtpOverride(caller, code, playerId);
  }

  @Get(":code")
  get(@Param("code") code: string) {
    return this.games.getByCode(code);
  }

  @Post()
  @Auth("operator")
  @RequirePermission("game.configure")
  create(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createGameSchema)) body: CreateGameInput,
  ) {
    return this.games.createGame(caller, body);
  }

  @Patch(":id")
  @Auth("operator")
  @RequirePermission("game.configure")
  update(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGameSchema)) body: UpdateGameInput,
  ) {
    return this.games.updateGame(caller, id, body);
  }

  @Post(":id/status")
  @HttpCode(200)
  @Auth("operator")
  @RequirePermission("game.configure")
  setStatus(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setGameStatusSchema)) body: SetGameStatusInput,
  ) {
    return this.games.setStatus(caller, id, body);
  }
}
