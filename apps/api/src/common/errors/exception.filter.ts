import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@aureus/db";
import type { Request, Response } from "express";
import { AppError } from "./domain-error";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Global exception filter. Maps typed domain errors and framework exceptions to
 * the stable `{ error: { code, message, details? } }` shape (docs/05 §0). Prisma
 * errors are translated to safe codes and never leaked; unknown errors become a
 * generic 500 and are logged with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body, logIt } = this.resolve(exception);
    if (logIt) {
      this.logger.error(
        `${req.method} ${req.url} -> ${String(status)} ${body.error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody; logIt: boolean } {
    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
        logIt: exception.httpStatus >= 500,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: { error: { code: this.codeForStatus(status), message: this.httpMessage(exception) } },
        logIt: status >= 500,
      };
    }

    return {
      status: 500,
      body: { error: { code: "INTERNAL", message: "Internal server error" } },
      logIt: true,
    };
  }

  private fromPrisma(
    e: Prisma.PrismaClientKnownRequestError,
  ): { status: number; body: ErrorBody; logIt: boolean } {
    switch (e.code) {
      case "P2002":
        return { status: 409, body: { error: { code: "CONFLICT", message: "Resource already exists" } }, logIt: false };
      case "P2025":
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } }, logIt: false };
      default:
        return { status: 500, body: { error: { code: "INTERNAL", message: "Database error" } }, logIt: true };
    }
  }

  private httpMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
      const message = response.message;
      return Array.isArray(message) ? message.map(String).join(", ") : String(message);
    }
    return exception.message;
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return "VALIDATION_ERROR";
      case 401:
        return "UNAUTHORIZED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "CONFLICT";
      case 429:
        return "RATE_LIMITED";
      default:
        return "INTERNAL";
    }
  }
}
