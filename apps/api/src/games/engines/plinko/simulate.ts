/* eslint-disable no-console -- dev-only CLI probe; output is the whole point. */
/**
 * Monte-Carlo RTP / behaviour probe for the Plinko engine. Run ad hoc:
 *   pnpm --filter api exec tsx src/games/engines/plinko/simulate.ts [drops]
 * Measures each risk curve's RTP (binomial-weighted mean multiplier), the hit rate
 * (multiplier ≥ 1×), the top multiplier, and the bucket distribution. The certified RTP is
 * the curve's weighted mean (0.96 by design), confirmed here.
 */
import { PLINKO_BUCKET_COUNT, PLINKO_RISKS, type PlinkoRisk } from "@aureus/shared";
import { drop } from "./engine";

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

const drops = Number(process.argv[2] ?? 2_000_000);

for (const risk of PLINKO_RISKS as readonly PlinkoRisk[]) {
  const rng = mulberry32(0x9e3779b9 ^ risk.length);
  let sumBps = 0n;
  let wins = 0; // multiplier >= 1×
  let maxMult = 0;
  const dist = new Array<number>(PLINKO_BUCKET_COUNT).fill(0);
  for (let i = 0; i < drops; i++) {
    const { totalWinBps, outcome } = drop(rng, risk);
    sumBps += BigInt(totalWinBps);
    if (outcome.multiplier >= 1) wins++;
    if (outcome.multiplier > maxMult) maxMult = outcome.multiplier;
    dist[outcome.bucket]!++;
  }
  const rtp = Number(sumBps) / (drops * 10_000);
  const distPct = dist.map((d) => ((d / drops) * 100).toFixed(1)).join("/");
  console.log(
    `${risk.padEnd(7)} RTP ${(rtp * 100).toFixed(3)}%  win≥1x ${((wins / drops) * 100).toFixed(2)}%  top ${maxMult}x`,
  );
  console.log(`        bucket %: ${distPct}`);
}
