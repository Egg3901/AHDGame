import { describe, expect, it } from "vitest";
import {
  advanceCapitalStock,
  NEUTRAL_PRIME_RATE,
  CAPITAL_OUTPUT_RATIO_TARGET,
} from "./capitalStock";

const TPY = 48;

/** Iterate the accumulator at a fixed output for `years`, return final K/Y. */
function settle(startK: number, Y: number, years: number, primeRate = NEUTRAL_PRIME_RATE): number {
  let k = startK;
  for (let t = 0; t < years * TPY; t++) {
    k = advanceCapitalStock(k, Y, primeRate, TPY).capital;
  }
  return k / Y;
}

/**
 * The capital loop (GDP→investment→capital→GDP) is self-damping by Solow
 * construction (§6.1). With the derived δ = invRate/target, K/Y must converge to
 * the target from any start and never run away.
 */
describe("capital stock converges to steady-state K/Y (audit §6.1)", () => {
  it("rises toward the target from far below (K/Y=1)", () => {
    expect(settle(1000, 1000, 100)).toBeCloseTo(CAPITAL_OUTPUT_RATIO_TARGET, 1);
  });
  it("falls toward the target from far above (K/Y=6, no runaway)", () => {
    expect(settle(6000, 1000, 100)).toBeCloseTo(CAPITAL_OUTPUT_RATIO_TARGET, 1);
  });
  it("a sustained lower prime rate settles at a HIGHER K/Y (more investment)", () => {
    const easy = settle(3000, 1000, 100, 0); // rates pinned low
    const tight = settle(3000, 1000, 100, 6); // rates high
    expect(easy).toBeGreaterThan(CAPITAL_OUTPUT_RATIO_TARGET);
    expect(tight).toBeLessThan(CAPITAL_OUTPUT_RATIO_TARGET);
  });
});
