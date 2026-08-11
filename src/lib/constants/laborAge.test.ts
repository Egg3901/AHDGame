import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_AGE,
  DEFAULT_RETIREMENT_AGE,
  resolveWorkingAgeEligible,
  resolveRetirementAgeEligible,
} from "./laborAge";

describe("laborAge", () => {
  it("defaults: working 18, retirement 64", () => {
    expect(DEFAULT_WORKING_AGE).toBe(18);
    expect(DEFAULT_RETIREMENT_AGE).toBe(64);
    expect(resolveWorkingAgeEligible(undefined)).toBe(18);
    expect(resolveRetirementAgeEligible(undefined)).toBe(64);
  });
  it("honors overrides, clamped to sane bands", () => {
    expect(resolveWorkingAgeEligible({ workingAgeEligible: 16 })).toBe(16);
    expect(resolveWorkingAgeEligible({ workingAgeEligible: 5 })).toBe(16); // floor
    expect(resolveWorkingAgeEligible({ workingAgeEligible: 40 })).toBe(25); // ceil
    expect(resolveRetirementAgeEligible({ retirementAgeEligible: 70 })).toBe(70);
    expect(resolveRetirementAgeEligible({ retirementAgeEligible: 40 })).toBe(50); // floor
    expect(resolveRetirementAgeEligible({ retirementAgeEligible: 90 })).toBe(75); // ceil
  });
  it("ignores non-finite overrides", () => {
    expect(resolveWorkingAgeEligible({ workingAgeEligible: NaN })).toBe(18);
    expect(resolveRetirementAgeEligible({ retirementAgeEligible: NaN })).toBe(64);
  });
});
