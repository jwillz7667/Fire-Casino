import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  type CreateGameInput,
  createGameSchema,
  currencySchema,
  type SetGameStatusInput,
  setGameStatusSchema,
  type UpdateGameInput,
  updateGameSchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
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
