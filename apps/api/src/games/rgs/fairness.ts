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

/**
 * A single round needs more than one random draw (every reel cell, feature
 * trigger, free-spin sub-round, orb value). This derives an indexed, reproducible
 * stream of uniforms from the same committed seeds: each index is its own HMAC,
 * so a verifier with the revealed serverSeed recomputes every draw of the spin.
 * `index` salts the HMAC message alongside `${clientSeed}:${nonce}`.
 */
export function roundUniformAt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  index: number,
): number {
  const digest = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${String(nonce)}:${String(index)}`)
    .digest();
  let value = 0;
  for (let i = 0; i < 6; i++) {
    value = value * 256 + digest[i]!;
  }
  return value / 2 ** 48;
}

/** A stateful draw function over the round's deterministic uniform stream. */
export type RoundRng = () => number;

/** Build a sequential RNG that walks the round's uniform stream from index 0. */
export function createRoundRng(serverSeed: string, clientSeed: string, nonce: number): RoundRng {
  let index = 0;
  return () => roundUniformAt(serverSeed, clientSeed, nonce, index++);
}
