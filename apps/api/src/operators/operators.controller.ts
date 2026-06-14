import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import {
  type CreateOperatorInput,
  createOperatorSchema,
  type ListOperatorsQuery,
  listOperatorsQuerySchema,
  type SetOperatorGrantsInput,
  setOperatorGrantsSchema,
  type UpdateOperatorInput,
  updateOperatorSchema,
  type WalletHistoryQuery,
  walletHistoryQuerySchema,
} from "@aureus/shared";
import {
  Auth,
  CurrentUser,
  RequirePermission,
  ScopeCheck,
} from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { OperatorsService } from "./operators.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Auth("operator")
@Controller("operators")
export class OperatorsController {
  constructor(private readonly operators: OperatorsService) {}

  @Post()
  @RequirePermission("operator.create_child")
  @ScopeCheck({ operatorIdFrom: [{ source: "body", key: "parentId" }] })
  create(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createOperatorSchema)) body: CreateOperatorInput,
    @Req() req: Request,
  ) {
    return this.operators.createChild(caller, body, ctxOf(req));
  }

  @Get()
  @RequirePermission("operator.view_subtree")
  @ScopeCheck({ operatorIdFrom: [{ source: "query", key: "parentId" }] })
  list(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(listOperatorsQuerySchema)) query: ListOperatorsQuery,
  ) {
    if (query.scope === "children" && !query.parentId) {
      return this.operators.listChildren(caller.operatorId, query);
    }
    return this.operators.list(query);
  }

  @Get(":id")
  @RequirePermission("operator.view_subtree")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  get(@Param("id") id: string) {
    return this.operators.get(id);
  }

  @Get(":id/tree")
  @RequirePermission("operator.view_subtree")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  tree(@Param("id") id: string, @Query("depth") depth?: string) {
    const parsed = depth ? Number.parseInt(depth, 10) : 3;
    return this.operators.getTree(id, Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : 3);
  }

  @Patch(":id")
  @RequirePermission("operator.set_pricing")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  update(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOperatorSchema)) body: UpdateOperatorInput,
    @Req() req: Request,
  ) {
    return this.operators.update(caller, id, body, ctxOf(req));
  }

  /**
   * Confer per-operator permission grants on a descendant. The coarse gate is
   * `operator.create_child` (management tiers); the fine-grained authority rules
   * (grant-only, no self, never exceed the granter) live in the service.
   */
  @Put(":id/grants")
  @HttpCode(200)
  @RequirePermission("operator.create_child")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  setGrants(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setOperatorGrantsSchema)) body: SetOperatorGrantsInput,
    @Req() req: Request,
  ) {
    return this.operators.setGrants(caller, id, body.permissions, ctxOf(req));
  }

  @Post(":id/suspend")
  @RequirePermission("operator.suspend")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  suspend(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.operators.suspend(caller, id, ctxOf(req));
  }

  @Post(":id/activate")
  @RequirePermission("operator.suspend")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  activate(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.operators.activate(caller, id, ctxOf(req));
  }

  @Post(":id/close")
  @RequirePermission("operator.suspend")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  close(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.operators.close(caller, id, ctxOf(req));
  }

  @Get(":id/balance")
  @RequirePermission("operator.view_subtree")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  balance(@Param("id") id: string) {
    return this.operators.getBalances(id);
  }

  @Get(":id/stats")
  @RequirePermission("report.view")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  stats(@Param("id") id: string) {
    return this.operators.getStats(id);
  }

  @Get(":id/ledger")
  @RequirePermission("operator.view_subtree")
  @ScopeCheck({ operatorIdFrom: [{ source: "params", key: "id" }] })
  ledger(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(walletHistoryQuerySchema)) query: WalletHistoryQuery,
  ) {
    return this.operators.getCreditHistory(id, query.cursor, query.limit);
  }
}
