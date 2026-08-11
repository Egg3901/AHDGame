import { describe, it, expect } from "vitest";
import { optionIntensity, ladderCenterIndex, isMonotoneLadder } from "./optionIntensity";

// 7-option education ladder: idx0 = strongest +, idx3 = center, idx6 = strongest −
const EDU = [
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 0 },
  { effectDirection: -1 },
  { effectDirection: -1 },
  { effectDirection: -1 },
];

// 11-option tax ladder: center at idx5 (ed 0)
const TAX = [
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 1 },
  { effectDirection: 0 },
  { effectDirection: -1 },
  { effectDirection: -1 },
  { effectDirection: -1 },
  { effectDirection: -1 },
  { effectDirection: -1 },
];

describe("optionIntensity", () => {
  it("maps center to exactly 0", () => {
    expect(optionIntensity(EDU, 3)).toBe(0);
    expect(optionIntensity(TAX, 5)).toBe(0);
  });
  it("maps the strongest option to ±1", () => {
    expect(optionIntensity(EDU, 0)).toBeCloseTo(1, 6);
    expect(optionIntensity(EDU, 6)).toBeCloseTo(-1, 6);
    expect(optionIntensity(TAX, 0)).toBeCloseTo(1, 6);
  });
  it("grades intermediate options between center and extreme", () => {
    expect(optionIntensity(EDU, 2)).toBeCloseTo(1 / 3, 6); // one step from center
    expect(optionIntensity(TAX, 4)).toBeCloseTo(1 / 5, 6); // 16% income-tax band
    expect(optionIntensity(TAX, 2)).toBeCloseTo(3 / 5, 6); // 8% band → bigger push
  });
  it("returns 0 for an empty ladder", () => {
    expect(optionIntensity([], 0)).toBe(0);
  });
  it("ladderCenterIndex finds the ed===0 option, else the midpoint", () => {
    expect(ladderCenterIndex(EDU)).toBe(3);
    expect(ladderCenterIndex([{ effectDirection: 1 }, { effectDirection: -1 }])).toBe(0.5);
  });
  it("isMonotoneLadder flags a non-monotone ladder", () => {
    expect(isMonotoneLadder(EDU)).toBe(true);
    // ed goes +1 … −1 … +1 (the foreign-corp-tax seed bug)
    expect(
      isMonotoneLadder([{ effectDirection: 1 }, { effectDirection: -1 }, { effectDirection: 1 }])
    ).toBe(false);
  });
});
