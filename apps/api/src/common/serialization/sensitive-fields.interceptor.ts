import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";

/**
 * Credential fields that must NEVER appear in a response (docs/01 §8). This is a
 * global safety net behind the hand-maintained Prisma `select`s — if a future
 * handler returns a raw User/Player/RefreshToken, these are stripped anyway.
 * Deliberately narrow: `serverSeed` is intentionally revealed at session end, so
 * it is NOT redacted here.
 */
const REDACT_KEYS = new Set(["passwordHash", "mfaSecret", "tokenHash"]);

@Injectable()
export class SensitiveFieldsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => strip(data, new WeakSet<object>())));
  }
}

function strip(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, seen));
  if (value !== null && typeof value === "object") {
    if (value instanceof Date) return value;
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key)) continue;
      out[key] = strip(val, seen);
    }
    return out;
  }
  return value;
}
