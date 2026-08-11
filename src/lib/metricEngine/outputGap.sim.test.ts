import { describe, expect, it } from "vitest";
import { advanceOutputGap, GAP_CLOSURE } from "./outputGap";

const TPY = 48;

/**
 * Output-gap business-cycle dynamics (§5.2 / §6.1): a sustained sector boom
 * reverts gdpGrowth to potential (the attractor) with the boom carried as a gap
 * level; when the boom ends the gap closes via a sub-potential "bust". The gap
 * is bounded — no runaway (self-damping, like the capital loop).
 */
describe("output gap dynamics (§5.2/§6.1)", () => {
  it("a sustained sector boom reverts gdpGrowth to potential; gap settles at Δ/closure", () => {
    let gap = 0;
    let last = 0;
    for (let t = 0; t < 40 * TPY; t++) {
      const r = advanceOutputGap(gap, 7, 3, TPY); // sector 4 above potential
      gap = r.gap;
      last = r.gdpGrowth;
    }
    expect(last).toBeCloseTo(3, 1); // gdpGrowth reverts to potential
    expect(gap).toBeCloseTo(4 / GAP_CLOSURE, 0); // gap settles at 8
  });

  it("after the boom ends the gap closes (bust below potential, then back to potential)", () => {
    let gap = 8; // post-boom positive gap
    const first = advanceOutputGap(gap, 3, 3, TPY);
    expect(first.gdpGrowth).toBeLessThan(3); // bust while the gap closes
    for (let t = 0; t < 40 * TPY; t++) gap = advanceOutputGap(gap, 3, 3, TPY).gap;
    expect(gap).toBeCloseTo(0, 1); // gap fully closed
  });
});
