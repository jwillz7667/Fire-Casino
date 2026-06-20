/* eslint-disable no-console -- dev-only CLI probe; output is the whole point. */
/**
 * Monte-Carlo RTP / behaviour probe for the Inferno Link engine. Run ad hoc:
 *   pnpm --filter api exec tsx src/games/engines/inferno/simulate.ts [spins]
 * The feature pays VERBATIM (fireball values + GRAND), so its RTP slice is governed by the
 * fireball weight + value table, not PAYOUT_SCALAR_BPS. The probe separates the scaled line
 * slice from the fixed feature slice and suggests the scalar that lands the COMBINED RTP on
 * the certified target.
 */
import { spin } from "./engine";
import { CERTIFIED_RTP_BPS, PAYOUT_SCALAR_BPS } from "./math";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spins = Number(process.argv[2] ?? 3_000_000);
const rng = mulberry32(0x9e3779b9);

let sumBps = 0n;
let sumFeatureBps = 0n;
let wins = 0;
let triggers = 0;
let fills = 0;
let near5 = 0; // exactly 5 fireballs on base (anticipation)
let maxWinBps = 0;
const buckets = { dead: 0, small: 0, mid: 0, big: 0, huge: 0 };

for (let i = 0; i < spins; i++) {
  const { totalWinBps, outcome } = spin(rng);
  sumBps += BigInt(totalWinBps);
  if (outcome.holdSpin) {
    triggers++;
    sumFeatureBps += BigInt(outcome.holdSpin.bonusBps);
    if (outcome.holdSpin.filledAll) fills++;
  } else if (outcome.baseFireballCount === 5) {
    near5++;
  }
  if (totalWinBps > 0) wins++;
  if (totalWinBps > maxWinBps) maxWinBps = totalWinBps;
  if (totalWinBps === 0) buckets.dead++;
  else if (totalWinBps < 10_000) buckets.small++;
  else if (totalWinBps < 100_000) buckets.mid++;
  else if (totalWinBps < 1_000_000) buckets.big++;
  else buckets.huge++;
}

const rtp = Number(sumBps) / (spins * 10_000);
const featureRtp = Number(sumFeatureBps) / (spins * 10_000);
const lineRtp = rtp - featureRtp;
const pct = (n: number) => ((n / spins) * 100).toFixed(3);

console.log(`spins:            ${spins.toLocaleString()}`);
console.log(`PAYOUT_SCALAR_BPS ${PAYOUT_SCALAR_BPS}`);
console.log(`measured RTP:     ${(rtp * 100).toFixed(3)}%   (target ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%)`);
console.log(`  · line slice:   ${(lineRtp * 100).toFixed(3)}%  (scaled)`);
console.log(`  · feature slice:${(featureRtp * 100).toFixed(3)}%  (verbatim)`);
console.log(`hit frequency:    ${pct(wins)}%`);
console.log(`trigger rate:     ${pct(triggers)}%  (1 in ${(spins / Math.max(triggers, 1)).toFixed(0)})`);
console.log(`full-screen fills:${fills}  (1 in ${(spins / Math.max(fills, 1)).toFixed(0)})`);
console.log(`anticipation (5): ${pct(near5)}%`);
console.log(`max win:          ${(maxWinBps / 10_000).toFixed(1)}x`);
console.log(`buckets: dead ${pct(buckets.dead)}% | <1x ${pct(buckets.small)}% | 1-10x ${pct(buckets.mid)}% | 10-100x ${pct(buckets.big)}% | 100x+ ${pct(buckets.huge)}%`);

// Line slice is linear in the scalar; feature slice is fixed. Scalar that hits the target:
const target = CERTIFIED_RTP_BPS / 10_000;
const suggested = Math.round((PAYOUT_SCALAR_BPS * (target - featureRtp)) / lineRtp);
console.log(`→ to hit ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%, set PAYOUT_SCALAR_BPS = ${suggested}`);
