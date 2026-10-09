import { describe, expect, it } from "vitest";
import {
  SLOT_MAX_MULTIPLIER,
  SLOT_SYMBOLS,
  SLOT_WEIGHTS,
  scoreSlotReels,
  spinSlots,
} from "./slots";

function enumerate() {
  const total = Object.values(SLOT_WEIGHTS).reduce((a, b) => a + b, 0);
  let rtp = 0;
  let max = 0;
  for (const a of SLOT_SYMBOLS)
    for (const b of SLOT_SYMBOLS)
      for (const c of SLOT_SYMBOLS) {
        const p = (SLOT_WEIGHTS[a] * SLOT_WEIGHTS[b] * SLOT_WEIGHTS[c]) / total ** 3;
        const { multiplier } = scoreSlotReels([a, b, c]);
        rtp += p * multiplier;
        max = Math.max(max, multiplier);
      }
  return { rtp, max };
}

describe("slots", () => {
  it("returns between 94% and 96% of stakes over every reel stop", () => {
    const { rtp } = enumerate();
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(0.96);
  });

  it("never pays more than the declared maximum", () => {
    expect(enumerate().max).toBe(SLOT_MAX_MULTIPLIER);
  });

  it("scores specials, wild triples and pairs", () => {
    expect(scoreSlotReels(["SEVEN", "WILD", "SEVEN"]).multiplier).toBe(50);
    expect(scoreSlotReels(["BELL", "BELL", "WILD"])).toMatchObject({
      kind: "triple",
      multiplier: 32,
    });
    expect(scoreSlotReels(["DIAMOND", "LEMON", "DIAMOND"])).toMatchObject({
      kind: "double",
      multiplier: 3.5,
    });
    expect(scoreSlotReels(["CHERRY", "LEMON", "BELL"]).multiplier).toBe(0);
  });

  it("maps the rng onto the reels", () => {
    expect(spinSlots(() => 0).reels).toEqual(["CHERRY", "CHERRY", "CHERRY"]);
    expect(spinSlots(() => 0.999999).reels).toEqual(["WILD", "WILD", "WILD"]);
  });
});
