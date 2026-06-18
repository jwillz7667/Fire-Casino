import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type CreatePlayerInput,
  createPlayerSchema,
  type ListPlayersQuery,
  listPlayersQuerySchema,
  type PlayerHistoryQuery,
  playerHistoryQuerySchema,
  type ResetPlayerPasswordInput,
  resetPlayerPasswordSchema,
  type TransferPlayerInput,
  transferPlayerSchema,
  type UpdatePlayerInput,
  updatePlayerSchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission, ScopeCheck } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlayersService } from "./players.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Auth("operator")
@Controller("players")
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Post()
  @RequirePermission("player.create")
  create(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createPlayerSchema)) body: CreatePlayerInput,
    @Req() req: Request,
  ) {
    return this.players.create(caller, body, ctxOf(req));
  }

  @Get()
  @RequirePermission("player.view")
  @ScopeCheck({ operatorIdFrom: [{ source: "query", key: "operatorId" }] })
  list(@Query(new ZodValidationPipe(listPlayersQuerySchema)) query: ListPlayersQuery) {
    return this.players.list(query);
  }

  @Get(":id")
  @RequirePermission("player.view")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "id" }] })
  get(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string) {
    return this.players.get(caller, id);
  }

  @Get(":id/history")
  @RequirePermission("player.view")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "id" }] })
  history(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(playerHistoryQuerySchema)) query: PlayerHistoryQuery,
  ) {
    return this.players.history(caller, id, query);
  }

  @Patch(":id")
  @RequirePermission("player.suspend")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "id" }] })
  update(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlayerSchema)) body: UpdatePlayerInput,
    @Req() req: Request,
  ) {
    return this.players.update(caller, id, body, ctxOf(req));
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermission("player.suspend")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "id" }] })
  suspend(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.players.suspend(caller, id, ctxOf(req));
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  @RequirePermission("player.suspend")
  @ScopeCheck({ playerIdFrom: [{ source: "params", key: "id" }] })
  async resetPassword(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resetPlayerPasswordSchema)) body: ResetPlayerPasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.players.resetPassword(caller, id, body, ctxOf(req));
  }

  @Post(":id/transfer")
  @HttpCode(200)
  @RequirePermission("player.view")
  @ScopeCheck({
    playerIdFrom: [{ source: "params", key: "id" }],
    operatorIdFrom: [{ source: "body", key: "toOperatorId" }],
  })
  transfer(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(transferPlayerSchema)) body: TransferPlayerInput,
    @Req() req: Request,
  ) {
    return this.players.transfer(caller, id, body.toOperatorId, ctxOf(req));
  }
}
