/**
 * A fresh idempotency key per form-open so retries / double-taps of a money
 * action don't double-fire (docs/07 §3). Generated lazily on the client where
 * crypto.randomUUID is always available in a secure context.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
