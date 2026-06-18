/* eslint-disable no-console -- dev-only CLI probe; output is the whole point. */
/**
 * Monte-Carlo RTP / behaviour probe for the Cosmic Spins engine. Run ad hoc:
 *   pnpm --filter api exec tsx src/games/engines/cosmic/simulate.ts [spins]
 * Uses a seeded PRNG (not the provable-fairness stream) purely to measure the model's
 * intrinsic RTP, hit rate, free-spin frequency, bonus frequency and tail. The certified
 * RTP pinned in math.ts / the catalog comes from this measurement.
 *
 * Calibration note: the BONUS prize is FIXED (unscaled), so its RTP slice is governed by
 * the bonus reel weight, not PAYOUT_SCALAR_BPS. The probe separates the scaled slice
 * (lines + scatter + free spins) from the unscaled bonus slice and suggests the scalar
 * that lands the COMBINED RTP on the certified target.
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
let sumBonusBps = 0n;
let wins = 0;
let fsTriggers = 0;
let bonusTriggers = 0;
let bonus2 = 0; // exactly two BONUS on the base grid (anticipation)
let maxWinBps = 0;
const bonusByCount = { 3: 0, 4: 0, 5: 0, more: 0 };
const buckets = { dead: 0, small: 0, mid: 0, big: 0, huge: 0 };

for (let i = 0; i < spins; i++) {
  const { totalWinBps, outcome } = spin(rng);
  sumBps += BigInt(totalWinBps);
  if (outcome.bonus) sumBonusBps += BigInt(outcome.bonus.awardBps);
  if (totalWinBps > 0) wins++;
  if (outcome.freeSpins) fsTriggers++;
  if (outcome.bonus) {
    bonusTriggers++;
    const c = outcome.bonus.bonusCount;
    if (c === 3) bonusByCount[3]++;
    else if (c === 4) bonusByCount[4]++;
    else if (c === 5) bonusByCount[5]++;
    else bonusByCount.more++;
  } else if (outcome.base.bonusCount === 2) {
    bonus2++;
  }
  if (totalWinBps > maxWinBps) maxWinBps = totalWinBps;
  if (totalWinBps === 0) buckets.dead++;
  else if (totalWinBps < 10_000) buckets.small++;
  else if (totalWinBps < 100_000) buckets.mid++;
  else if (totalWinBps < 1_000_000) buckets.big++;
  else buckets.huge++;
}

const rtp = Number(sumBps) / (spins * 10_000);
const bonusRtp = Number(sumBonusBps) / (spins * 10_000);
const scaledRtp = rtp - bonusRtp; // the slice that PAYOUT_SCALAR_BPS actually scales
const pct = (n: number) => ((n / spins) * 100).toFixed(2);

console.log(`spins:            ${spins.toLocaleString()}`);
console.log(`PAYOUT_SCALAR_BPS ${PAYOUT_SCALAR_BPS}`);
console.log(`measured RTP:     ${(rtp * 100).toFixed(3)}%   (target ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%)`);
console.log(`  · scaled slice: ${(scaledRtp * 100).toFixed(3)}%  (lines + scatter + free spins)`);
console.log(`  · bonus slice:  ${(bonusRtp * 100).toFixed(3)}%  (fixed, unscaled)`);
console.log(`hit frequency:    ${pct(wins)}%`);
console.log(`free-spin rate:   ${pct(fsTriggers)}%  (1 in ${(spins / Math.max(fsTriggers, 1)).toFixed(0)})`);
console.log(`bonus rate:       ${pct(bonusTriggers)}%  (1 in ${(spins / Math.max(bonusTriggers, 1)).toFixed(0)})`);
console.log(`  · counts 3/4/5/6+: ${bonusByCount[3]} / ${bonusByCount[4]} / ${bonusByCount[5]} / ${bonusByCount.more}`);
console.log(`bonus anticipation (exactly 2): ${pct(bonus2)}%`);
console.log(`max win:          ${(maxWinBps / 10_000).toFixed(1)}x`);
console.log(`buckets: dead ${pct(buckets.dead)}% | <1x ${pct(buckets.small)}% | 1-10x ${pct(buckets.mid)}% | 10-100x ${pct(buckets.big)}% | 100x+ ${pct(buckets.huge)}%`);

// The scaled slice is linear in PAYOUT_SCALAR_BPS; the bonus slice is fixed. So the scalar
// that lands the COMBINED RTP on the certified target is:
//   scalar' = scalar × (target − bonusRtp) / scaledRtp
const target = CERTIFIED_RTP_BPS / 10_000;
const suggested = Math.round((PAYOUT_SCALAR_BPS * (target - bonusRtp)) / scaledRtp);
console.log(`→ to hit ${(CERTIFIED_RTP_BPS / 100).toFixed(2)}%, set PAYOUT_SCALAR_BPS = ${suggested}`);
