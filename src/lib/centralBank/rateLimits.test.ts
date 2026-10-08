import { describe, expect, it } from "vitest";
import { computeRateLimits, widenedCapSentence } from "./rateLimits";

describe("computeRateLimits", () => {
  it("uses the ordinary 0.75 hike cap near target", () => {
    const limits = computeRateLimits({ primeRate: 5, inflation: 6.9, target: 2 });
    expect(limits.widened).toBe(false);
    expect(limits.maxHike).toBe(0.75);
    expect(limits.maxCut).toBe(1.75);
    expect(limits.ceiling).toBe(5.75);
    expect(limits.floor).toBe(3.25);
    expect(limits.hikeSteps).toEqual([]);
    expect(widenedCapSentence(limits)).toBeNull();
  });

  it("widens to 3 points at exactly 5pp over target and offers steps up to the cap", () => {
    const limits = computeRateLimits({ primeRate: 5, inflation: 7, target: 2 });
    expect(limits.widened).toBe(true);
    expect(limits.maxHike).toBe(3);
    expect(limits.ceiling).toBe(8);
    expect(limits.hikeSteps).toEqual([0.75, 1.5, 2.25, 3]);
    expect(limits.floor).toBe(3.25);
  });

  it("explains the widened cap in one sentence naming inflation and target", () => {
    const sentence = widenedCapSentence(
      computeRateLimits({ primeRate: 5, inflation: 16, target: 2 })
    );
    expect(sentence).toContain("16.0%");
    expect(sentence).toContain("2.0%");
    expect(sentence).toContain("3.00");
    expect(sentence).not.toMatch(new RegExp("[\u2013\u2014]"));
  });

  it("clips the ceiling and the steps at the 25% policy-rate limit", () => {
    const limits = computeRateLimits({ primeRate: 24, inflation: 40, target: 2 });
    expect(limits.ceiling).toBe(25);
    expect(limits.hikeSteps).toEqual([0.75, 1]);
  });

  it("measures from the grid-snapped stored rate, like the server", () => {
    const limits = computeRateLimits({ primeRate: 4.13, inflation: 10, target: 2 });
    expect(limits.ceiling).toBe(7.25);
  });

  it("falls back to the ordinary cap with no inflation data", () => {
    expect(computeRateLimits({ primeRate: 5 }).widened).toBe(false);
    expect(computeRateLimits({ primeRate: 5, inflation: null, target: 2 }).maxHike).toBe(0.75);
  });
});
