import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  type CreateOrderInput,
  createOrderSchema,
  type ListOrdersQuery,
  listOrdersQuerySchema,
  type MarkOrderPaidInput,
  markOrderPaidSchema,
  type PresignProofInput,
  presignProofSchema,
  type RejectOrderInput,
  rejectOrderSchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { OrdersService } from "./orders.service";

function ctxOf(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}

@Auth("operator")
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequirePermission("order.request_up")
  request(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @Req() req: Request,
  ) {
    return this.orders.request(caller, body, ctxOf(req));
  }

  @Post("proof-url")
  @HttpCode(200)
  @RequirePermission("order.request_up")
  proofUrl(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(presignProofSchema)) body: PresignProofInput,
  ) {
    return this.orders.presignProof(caller, body);
  }

  @Get()
  @RequirePermission("order.view")
  list(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ) {
    return this.orders.list(caller, query);
  }

  @Get(":id")
  @RequirePermission("order.view")
  get(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string) {
    return this.orders.get(caller, id);
  }

  @Post(":id/awaiting-payment")
  @HttpCode(200)
  @RequirePermission("order.fulfill")
  acknowledge(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.orders.acknowledge(caller, id, ctxOf(req));
  }

  @Post(":id/mark-paid")
  @HttpCode(200)
  @RequirePermission("order.fulfill")
  markPaid(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(markOrderPaidSchema)) body: MarkOrderPaidInput,
    @Req() req: Request,
  ) {
    return this.orders.markPaid(caller, id, body, ctxOf(req));
  }

  @Post(":id/issue")
  @HttpCode(200)
  @RequirePermission("order.fulfill")
  issue(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.orders.issue(caller, id, ctxOf(req));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission("order.fulfill")
  reject(
    @CurrentUser() caller: OperatorPrincipal,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectOrderSchema)) body: RejectOrderInput,
    @Req() req: Request,
  ) {
    return this.orders.reject(caller, id, body, ctxOf(req));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("order.view")
  cancel(@CurrentUser() caller: OperatorPrincipal, @Param("id") id: string, @Req() req: Request) {
    return this.orders.cancel(caller, id, ctxOf(req));
  }
}
