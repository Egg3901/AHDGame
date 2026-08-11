import { describe, expect, it } from "vitest";
import { eraFromYear, resolveGameYear, ERA_DOMAIN } from "./era";

describe("eraFromYear", () => {
  it("buckets a year into its decade era", () => {
    expect(eraFromYear(2008)).toEqual({
      id: "2000s",
      label: "2000s",
      startYear: 2000,
      endYear: 2009,
    });
    expect(eraFromYear(1991).id).toBe("1990s");
    expect(eraFromYear(2000).id).toBe("2000s"); // boundary year belongs to the new decade
    expect(eraFromYear(2019).id).toBe("2010s");
  });
  it("clamps outside the supported domain", () => {
    expect(eraFromYear(1900).id).toBe("1950s");
    expect(eraFromYear(2099).id).toBe("2040s");
    expect(ERA_DOMAIN).toEqual({ min: 1950, max: 2049 });
  });
});

describe("resolveGameYear", () => {
  it("prefers currentYear when present", () => {
    expect(resolveGameYear({ currentYear: 2008 })).toBe(2008);
  });
  it("derives from currentTurn + startingYear when currentYear is absent (48 turns/year)", () => {
    // turn 822, 1991 start → 1991 + floor(821/48) = 1991 + 17 = 2008
    expect(resolveGameYear({ currentTurn: 822, startingYear: 1991 })).toBe(2008);
    expect(resolveGameYear({ currentTurn: 1, startingYear: 2019 })).toBe(2019);
  });
  it("returns null when nothing usable is present", () => {
    expect(resolveGameYear({})).toBeNull();
    expect(resolveGameYear({ currentTurn: 5 })).toBeNull();
  });
});
