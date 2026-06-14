import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Params } from "nestjs-pino";
import { type Env } from "@aureus/shared";

/**
 * Fields that must never reach the logs (docs/01 §8: never log secrets/PII).
 * pino redacts these paths in every request/response line.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.tempPassword",
  "req.body.totp",
  "req.body.payoutDetails",
];

const HEALTH_PATHS = new Set(["/healthz", "/readyz"]);

/**
 * Structured JSON logging config (docs/01 §11: pino, request id + principal id
 * on every line). A request id is read from `x-request-id` or generated and
 * echoed back; nestjs-pino binds it (and any `logger.assign({ principalId })`
 * from the auth guard) to every log line emitted during the request via its
 * AsyncLocalStorage. Health probes are not auto-logged to keep noise down.
 */
export function buildLoggerParams(env: Env): Params {
  const isProd = env.NODE_ENV === "production";
  return {
    pinoHttp: {
      level: isProd ? "info" : "debug",
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const header = req.headers["x-request-id"];
        const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      autoLogging: {
        ignore: (req: IncomingMessage): boolean => HEALTH_PATHS.has(req.url ?? ""),
      },
      base: { mode: env.PLATFORM_MODE },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      transport: isProd
        ? undefined
        : { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } },
    },
  };
}
