/**
 * BigInt JSON serialization safety net (hard rule #1).
 *
 * Money is represented as BigInt minor units everywhere. JSON has no BigInt
 * type, and `JSON.stringify(1n)` throws by default. Installing `toJSON` makes
 * every BigInt serialize to its integer string form ("1500000"), so no code
 * path — HTTP response, Socket.io payload, log line, accidental raw return —
 * can ever throw on serialization.
 *
 * This is a safety net, NOT the contract. The contract is the explicit zod
 * response schemas (zMinorOut) that produce integer strings deliberately. This
 * module must be imported as the FIRST line of every process entrypoint
 * (api main.ts/worker.ts, db seed, Next.js instrumentation).
 *
 * Import side-effect only:  import "@aureus/shared/bigint";  (or via the barrel)
 */

declare global {
  interface BigInt {
    toJSON: () => string;
  }
}

if (typeof BigInt.prototype.toJSON !== "function") {
  Object.defineProperty(BigInt.prototype, "toJSON", {
    value: function toJSON(this: bigint): string {
      return this.toString();
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

export {};
