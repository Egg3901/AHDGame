import { describe, expect, it } from "vitest";
import { HIGHLOW_HOUSE_EDGE, highLowStepMultiplier, resolveHighLowStep } from "./highlow";

describe("high-low", () => {
  it("returns at most (1 - edge) on every call from every card", () => {
    for (let card = 1; card <= 13; card++)
      for (const guess of ["higher", "lower"] as const) {
        let ev = 0;
        for (let next = 1; next <= 13; next++)
          ev += resolveHighLowStep(card, next, guess).stepMultiplier / 13;
        if (highLowStepMultiplier(card, guess) === 0) expect(ev).toBe(0);
        else {
          expect(ev).toBeLessThanOrEqual(1 - HIGHLOW_HOUSE_EDGE);
          expect(ev).toBeGreaterThan(1 - HIGHLOW_HOUSE_EDGE - 0.001);
        }
      }
  });

  it("refuses a call that cannot win and loses a tie", () => {
    expect(highLowStepMultiplier(13, "higher")).toBe(0);
    expect(highLowStepMultiplier(1, "lower")).toBe(0);
    expect(resolveHighLowStep(7, 7, "higher").correct).toBe(false);
  });
});
