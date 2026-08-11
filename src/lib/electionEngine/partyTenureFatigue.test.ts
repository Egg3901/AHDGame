import { describe, it, expect } from "vitest";
import { partyTenureFatiguePenalty, TENURE_FATIGUE_PER_TERM } from "./partyTenureFatigue";

describe("partyTenureFatiguePenalty", () => {
  it("is 0 for the first re-election (2nd term) and for open/first term", () => {
    expect(partyTenureFatiguePenalty(0)).toBe(0);
    expect(partyTenureFatiguePenalty(1)).toBe(0);
  });

  it("follows the −3.5pp-per-term schedule (budget units)", () => {
    expect(partyTenureFatiguePenalty(2)).toBeCloseTo(0.035, 6); // 3rd term: −3.5
    expect(partyTenureFatiguePenalty(3)).toBeCloseTo(0.07, 6); // 4th term: −7.0
    expect(partyTenureFatiguePenalty(4)).toBeCloseTo(0.105, 6); // 5th term: −10.5
    expect(partyTenureFatiguePenalty(6)).toBeCloseTo(0.175, 6); // 7th term: −17.5
  });

  it("scales linearly by TENURE_FATIGUE_PER_TERM per term beyond the first", () => {
    expect(partyTenureFatiguePenalty(3)).toBeCloseTo(2 * TENURE_FATIGUE_PER_TERM, 6);
  });

  it("degrades to 0 on missing / NaN / negative input", () => {
    expect(partyTenureFatiguePenalty(undefined)).toBe(0);
    expect(partyTenureFatiguePenalty(Number.NaN)).toBe(0);
    expect(partyTenureFatiguePenalty(-3)).toBe(0);
  });
});
