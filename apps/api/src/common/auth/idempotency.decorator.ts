import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { ValidationError } from "../errors/domain-error";

/**
 * Extracts the required `Idempotency-Key` header for money mutations (hard rule
 * #3). The service namespaces it with the action + actor before posting.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  const value = req.headers["idempotency-key"];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0) {
    throw new ValidationError(undefined, "Idempotency-Key header is required");
  }
  const trimmed = key.trim();
  // Bound the key so it can't bloat the idempotency store (VAL).
  if (trimmed.length > 200) {
    throw new ValidationError(undefined, "Idempotency-Key is too long");
  }
  return trimmed;
});
