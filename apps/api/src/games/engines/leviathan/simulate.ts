/* eslint-disable no-console -- dev-only CLI probe; output is the whole point. */
/**
 * Monte-Carlo RTP / behaviour probe for the Leviathan's Deep engine. Run ad hoc:
 *   pnpm --filter api exec tsx src/games/engines/leviathan/simulate.ts [spins]
 * Uses a seeded PRNG (not the provable-fairness stream) purely to measure the model's intrinsic
 * RTP, hit rate, free-spin frequency, bonus frequency, anticipation teases and tail.
 *
 * Calibration note: the Kraken Awakens prize is FIXED (unscaled), so its RTP slice is governed by
 * the BONUS reel weight, not PAYOUT_SCALAR_BPS. The probe separates the scaled slice (base ways +
 * free spins) from the unscaled Kraken slice and suggests the scalar that lands the COMBINED RTP on
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

const spins = Number(process.argv[2] ?? 1_000_000);
const rng = mulberry32(0x9e3779b9);

let sumBps = 0n;
let sumBonusBps = 0n;
let wins = 0;
let fsTriggers = 0;
let bonusTriggers = 0;
let scatter3 = 0; // exactly 3 scatters on the base grid (one short of the 4 trigger)
let bonus2 = 0; // exactly 2 BONUS on the base grid (one short of the 3 trigger)
let maxWinBps = 0;
const buckets = { dead: 0, small: 0, mid: 0, big: 0, huge: 0 };

for (let i = 0; i < spins; i++) {
  const { totalWinBps, outcome } = spin(rng);
  sumBps += BigInt(totalWinBps);
  if (outcome.bonus) {
    sumBonusBps += BigInt(outcome.bonus.awardBps);
    bonusTriggers++;
  } else if (outcome.base.bonusCount === 2) bonus2++;
  if (outcome.freeSpins) fsTriggers++;
  else if (outcome.base.scatterCount === 3) scatter3++;
  if (totalWinBps > 0) wins++;
  if (totalWinBps > maxWinBps) maxWinBps = totalWinBps;
  if (totalWinBps === 0) buckets.dead++;
  else if (totalWinBps < 10_000) buckets.small++;
  else if (totalWinBps < 100_000) buckets.mid++;
  else if (totalWinBps < 1_000_000) buckets.big++;
  else buckets.huge++;
}

const rtp = Number(sumBps) / (spins * 10_000);
const bonusRtp = Number(sumBonusBps) / (spins * 10_000);
const scaledRtp = rtp - bonusRtp; // the slice PAYOUT_SCALAR_BPS actually scales
const pct = (n: number) => ((n / spins) * 100).toFixed(3);

console.log(`spins:            ${spins.toLocaleString()}`);
console.log(`PAYOUT_SCALAR_BPS ${PAYOUT_SCALAR_BPS}`);
console.log(`measured RTP:     ${(rtp * 100).toFixed(3)}%   (target ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%)`);
console.log(`  · scaled slice: ${(scaledRtp * 100).toFixed(3)}%  (base ways + free spins)`);
console.log(`  · kraken slice: ${(bonusRtp * 100).toFixed(3)}%  (fixed, unscaled)`);
console.log(`hit frequency:    ${pct(wins)}%`);
console.log(`free-spin rate:   ${pct(fsTriggers)}%  (1 in ${(spins / Math.max(fsTriggers, 1)).toFixed(0)})`);
console.log(`bonus rate:       ${pct(bonusTriggers)}%  (1 in ${(spins / Math.max(bonusTriggers, 1)).toFixed(0)})`);
console.log(`scatter anticipation (exactly 3): ${pct(scatter3)}%`);
console.log(`bonus anticipation (exactly 2):   ${pct(bonus2)}%`);
console.log(`max win:          ${(maxWinBps / 10_000).toFixed(1)}x`);
console.log(`buckets: dead ${pct(buckets.dead)}% | <1x ${pct(buckets.small)}% | 1-10x ${pct(buckets.mid)}% | 10-100x ${pct(buckets.big)}% | 100x+ ${pct(buckets.huge)}%`);

// The scaled slice is linear in PAYOUT_SCALAR_BPS; the Kraken slice is fixed. So the scalar that
// lands the COMBINED RTP on the certified target is:
//   scalar' = scalar × (target − bonusRtp) / scaledRtp
const target = CERTIFIED_RTP_BPS / 10_000;
const suggested = Math.round((PAYOUT_SCALAR_BPS * (target - bonusRtp)) / scaledRtp);
console.log(`→ to hit ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%, set PAYOUT_SCALAR_BPS = ${suggested}`);
