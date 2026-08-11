import { describe, it, expect } from "vitest";
import {
  POPULAR_MOOD_AXES,
  CN_POPULAR_MOOD_PROFILE,
  type PopularMoodAxisProfile,
} from "@/lib/constants/popularMoodProfiles";

describe("PopularMoodAxisProfile", () => {
  it("CN profile defines a weight for every axis", () => {
    for (const axis of POPULAR_MOOD_AXES) {
      expect(CN_POPULAR_MOOD_PROFILE[axis]).toBeTypeOf("number");
    }
  });

  it("CN weights are in -1..1", () => {
    for (const axis of POPULAR_MOOD_AXES) {
      const w = CN_POPULAR_MOOD_PROFILE[axis];
      expect(w).toBeGreaterThanOrEqual(-1);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it("CN profile has at least one non-zero weight", () => {
    const nonZero = POPULAR_MOOD_AXES.filter((a) => CN_POPULAR_MOOD_PROFILE[a] !== 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it("PopularMoodAxisProfile keys match POPULAR_MOOD_AXES", () => {
    const profile: PopularMoodAxisProfile = CN_POPULAR_MOOD_PROFILE;
    const keys = Object.keys(profile).sort();
    expect(keys).toEqual([...POPULAR_MOOD_AXES].sort());
  });

  it("POPULAR_MOOD_AXES has no duplicate entries", () => {
    const unique = new Set(POPULAR_MOOD_AXES);
    expect(unique.size).toBe(POPULAR_MOOD_AXES.length);
  });
});
