import { describe, expect, it } from "vitest";
import { computeJusticeIdeology } from "./ideology";

describe("computeJusticeIdeology", () => {
  it("blends 65% personal + 35% party on each axis independently", () => {
    const result = computeJusticeIdeology(
      { economic: 2, social: -4 },
      { economicPosition: -2, socialPosition: 4 }
    );
    // economic: 2*0.65 + -2*0.35 = 1.3 - 0.7 = 0.6
    // social:  -4*0.65 +  4*0.35 = -2.6 + 1.4 = -1.2
    expect(result.economicLean).toBeCloseTo(0.6, 5);
    expect(result.socialLean).toBeCloseTo(-1.2, 5);
  });

  it("never collapses to a single number — economic and social are independent", () => {
    const result = computeJusticeIdeology(
      { economic: 5, social: -5 },
      { economicPosition: 5, socialPosition: -5 }
    );
    expect(result.economicLean).not.toBe(result.socialLean);
    expect(result.economicLean).toBeCloseTo(5, 5);
    expect(result.socialLean).toBeCloseTo(-5, 5);
  });

  it("clamps to the shared [-5, +5] scale even if inputs are out of range", () => {
    const result = computeJusticeIdeology(
      { economic: 100, social: -100 },
      { economicPosition: 100, socialPosition: -100 }
    );
    expect(result.economicLean).toBe(5);
    expect(result.socialLean).toBe(-5);
  });

  it("is deterministic for the same input", () => {
    const input = { economic: 1.4, social: -2.7 };
    const party = { economicPosition: -0.5, socialPosition: 3.1 };
    const results = Array.from({ length: 10 }, () => computeJusticeIdeology(input, party));
    const serialized = results.map((r) => JSON.stringify(r));
    expect(new Set(serialized).size).toBe(1);
  });

  it("applies identically regardless of a nominal 'source' — the formula never reads who nominated", () => {
    // The function signature itself proves this: it only ever accepts the
    // justice's own personal positions + their party's positions, never a
    // president's or nominator's positions. This test just pins the ratio.
    const personal = { economic: 0, social: 0 };
    const party = { economicPosition: 4, socialPosition: -4 };
    const result = computeJusticeIdeology(personal, party);
    expect(result.economicLean).toBeCloseTo(4 * 0.35, 5);
    expect(result.socialLean).toBeCloseTo(-4 * 0.35, 5);
  });
});
