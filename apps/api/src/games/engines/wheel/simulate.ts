/* eslint-disable no-console -- dev-only CLI probe; output is the whole point. */
/**
 * Monte-Carlo RTP / behaviour probe for the Fortune Wheel engine. Run ad hoc:
 *   pnpm --filter api exec tsx src/games/engines/wheel/simulate.ts [spins]
 * Measures each risk layout's RTP (mean multiplier), hit rate and top-hit frequency.
 * The certified RTP is the layout mean (0.96 by design), confirmed here.
 */
import { WHEEL_RISKS, type WheelRisk } from "@aureus/shared";
import { spin } from "./engine";

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

const spins = Number(process.argv[2] ?? 2_000_000);

for (const risk of WHEEL_RISKS as readonly WheelRisk[]) {
  const rng = mulberry32(0x9e3779b9 ^ risk.length);
  let sumBps = 0n;
  let wins = 0;
  let maxMult = 0;
  for (let i = 0; i < spins; i++) {
    const { totalWinBps, outcome } = spin(rng, risk);
    sumBps += BigInt(totalWinBps);
    if (totalWinBps > 0) wins++;
    if (outcome.multiplier > maxMult) maxMult = outcome.multiplier;
  }
  const rtp = Number(sumBps) / (spins * 10_000);
  console.log(
    `${risk.padEnd(7)} RTP ${(rtp * 100).toFixed(3)}%  hit ${((wins / spins) * 100).toFixed(2)}%  top ${maxMult}x`,
  );
}
