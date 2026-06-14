import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Provable-fairness primitives (docs/05 §10). At session start the server commits
 * to sha256(serverSeed); each round's RNG is HMAC_SHA256(serverSeed,
 * `${clientSeed}:${nonce}`); at session end the serverSeed is revealed so anyone
 * can recompute every round. Pure and deterministic — unit-tested.
 */
export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/** Deterministic uniform value in [0, 1) for a round. */
export function roundUniform(serverSeed: string, clientSeed: string, nonce: number): number {
  const digest = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${String(nonce)}`)
    .digest();
  // Use the first 6 bytes (48 bits) for a well-distributed double in [0,1).
  let value = 0;
  for (let i = 0; i < 6; i++) {
    value = value * 256 + digest[i]!;
  }
  return value / 2 ** 48;
}
