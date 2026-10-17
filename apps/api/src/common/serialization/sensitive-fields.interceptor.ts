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
    return next.handle().pipe(map((data: unknown) => strip(data, new WeakMap<object, unknown>())));
  }
}

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value !== null && typeof value === "object") {
    if (value instanceof Date) return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(strip(item, seen));
      return out;
    }
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key)) continue;
      out[key] = strip(val, seen);
    }
    return out;
  }
  return value;
}
