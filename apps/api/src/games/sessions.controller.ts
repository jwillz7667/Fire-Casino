import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type PlaceBetInput,
  placeBetSchema,
  type StartSessionInput,
  startSessionSchema,
} from "@aureus/shared";
import { Auth, CurrentPlayer } from "../common/auth/auth.decorators";
import { IdempotencyKey } from "../common/auth/idempotency.decorator";
import { type PlayerPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { regionFromRequest } from "../common/http/region";
import { GamesService } from "./games.service";

@Auth("player")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly games: GamesService) {}

  @Post()
  @HttpCode(200)
  start(
    @CurrentPlayer() player: PlayerPrincipal,
    @Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionInput,
    @Req() req: Request,
  ) {
    return this.games.startSession(player, body, regionFromRequest(req));
  }

  @Post(":id/bet")
  @HttpCode(200)
  bet(
    @CurrentPlayer() player: PlayerPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(placeBetSchema)) body: PlaceBetInput,
    @IdempotencyKey() idempotencyKey: string,
    @Req() req: Request,
  ) {
    return this.games.placeBet(player, id, body.betMinor, idempotencyKey, body.params ?? {}, regionFromRequest(req));
  }

  @Post(":id/end")
  @HttpCode(200)
  end(@CurrentPlayer() player: PlayerPrincipal, @Param("id") id: string) {
    return this.games.endSession(player, id);
  }

  @Get(":id")
  get(@CurrentPlayer() player: PlayerPrincipal, @Param("id") id: string) {
    return this.games.getSession(player, id);
  }
}
