import { describe, expect, it } from "vitest";
import { readableInk, shadeColorForTier, TIER_GROUND_MIX } from "./marginTierShade";
import type { MarginTier } from "./generalViewModel";

const TIERS: MarginTier[] = ["safe", "likely", "lean", "tossup"];
const DARK = "#0c0c12";
const LIGHT = "#ffffff";

function rgb(value: string): [number, number, number] {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  if (!m) throw new Error(`not an rgb string: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Rec. 601 luma, the same measure the ink picker uses. */
function luma(value: string): number {
  const [r, g, b] = rgb(value);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

describe("shadeColorForTier", () => {
  it("leaves a safe state the party colour at full strength", () => {
    expect(shadeColorForTier("#3b82f6", "safe", DARK)).toBe("rgb(59, 130, 246)");
  });

  it("fades a toss-up most of the way into the ground behind it", () => {
    const tossup = rgb(shadeColorForTier("#3b82f6", "tossup", DARK));
    const ground = rgb("rgb(12, 12, 18)");
    // Close to the page, but still a tile rather than a hole in the board.
    for (let i = 0; i < 3; i++) {
      expect(tossup[i]).toBeGreaterThan(ground[i]);
    }
    expect(luma(shadeColorForTier("#3b82f6", "tossup", DARK))).toBeLessThan(60);
  });

  it("mixes toward whatever ground it is given, not a fixed white", () => {
    // The same tier is a different colour on the two pages. Mixing toward a
    // hardcoded white is what made the dark board unreadable.
    const onDark = shadeColorForTier("#3b82f6", "lean", DARK);
    const onLight = shadeColorForTier("#3b82f6", "lean", LIGHT);
    expect(onDark).not.toBe(onLight);
    expect(luma(onDark)).toBeLessThan(luma(onLight));
  });

  it("returns the colour untouched when either value is unparseable", () => {
    expect(shadeColorForTier("not-a-color", "safe", DARK)).toBe("not-a-color");
    expect(shadeColorForTier("#3b82f6", "safe", "not-a-color")).toBe("#3b82f6");
  });

  it("accepts short hex and rgb() as well as full hex", () => {
    expect(shadeColorForTier("#f00", "safe", DARK)).toBe("rgb(255, 0, 0)");
    expect(shadeColorForTier("rgb(255, 0, 0)", "safe", DARK)).toBe("rgb(255, 0, 0)");
  });

  describe("the ramp is legible, not merely different", () => {
    // The predecessor asserted only that the four strings differed, which they
    // did while half the board looked like one flat colour: "safe" was the
    // party colour darkened a notch and "likely" was the colour itself, a step
    // a dark page swallows whole. Distinguishable to `toBe` is not
    // distinguishable to an eye, so these assert the size and the direction of
    // every step.
    for (const ground of [DARK, LIGHT]) {
      it(`steps monotonically toward the ground on ${ground}`, () => {
        const shades = TIERS.map((t) => shadeColorForTier("#3b82f6", t, ground));
        const distances = shades.map((s) =>
          Math.abs(luma(s) - luma(shadeColorForTier(ground, "safe", ground)))
        );
        for (let i = 1; i < distances.length; i++) {
          expect(distances[i]).toBeLessThan(distances[i - 1]);
        }
      });

      it(`separates every neighbouring pair by a visible margin on ${ground}`, () => {
        const shades = TIERS.map((t) => shadeColorForTier("#3b82f6", t, ground));
        for (let i = 1; i < shades.length; i++) {
          expect(Math.abs(luma(shades[i]) - luma(shades[i - 1]))).toBeGreaterThan(18);
        }
      });
    }

    it("keeps safe the most present tier and toss-up the least", () => {
      expect(TIER_GROUND_MIX.safe).toBe(0);
      for (let i = 1; i < TIERS.length; i++) {
        expect(TIER_GROUND_MIX[TIERS[i]]).toBeGreaterThan(TIER_GROUND_MIX[TIERS[i - 1]]);
      }
      expect(TIER_GROUND_MIX.tossup).toBeLessThan(1);
    });
  });
});

describe("readableInk", () => {
  it("inks light on every tier of a dark board", () => {
    for (const tier of TIERS) {
      expect(readableInk(shadeColorForTier("#3b82f6", tier, DARK))).toBe("#ffffff");
    }
  });

  it("inks dark on the washed-out tiers of a light map", () => {
    expect(readableInk(shadeColorForTier("#3b82f6", "tossup", LIGHT))).toBe("#14141c");
  });

  it("follows the shade's lightness rather than the tier", () => {
    // A pale shade takes dark ink whichever tier produced it.
    expect(readableInk("rgb(240, 240, 240)")).toBe("#14141c");
    expect(readableInk("rgb(20, 20, 30)")).toBe("#ffffff");
  });

  it("falls back to light ink for an unparseable colour", () => {
    expect(readableInk("not-a-color")).toBe("#ffffff");
  });
});
