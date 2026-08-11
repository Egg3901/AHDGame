import { describe, expect, it } from "vitest";
import { getCatalog, isLawActive, baselineLevelFor } from "./catalog";
import { LAW_COUNTRY_IDS, type PoliticalLaw } from "./types";

const law = (over: Partial<PoliticalLaw>): PoliticalLaw =>
  ({ id: "x", countryId: "US", kind: "primary", baselineLevel: 2, ...over }) as PoliticalLaw;

describe("isLawActive", () => {
  it("is true for a law with no window, at any year", () => {
    expect(isLawActive(law({}), 1953)).toBe(true);
    expect(isLawActive(law({}), 2049)).toBe(true);
  });

  it("respects an open-ended window", () => {
    const l = law({ window: { from: 1964, to: null } });
    expect(isLawActive(l, 1963)).toBe(false);
    expect(isLawActive(l, 1964)).toBe(true);
  });

  it("respects a closed window inclusively", () => {
    const l = law({ window: { from: 1964, to: 1990 } });
    expect(isLawActive(l, 1990)).toBe(true);
    expect(isLawActive(l, 1991)).toBe(false);
  });
});

describe("baselineLevelFor", () => {
  it("falls back to the scalar baselineLevel when no anchors are declared", () => {
    expect(baselineLevelFor(law({ baselineLevel: 3 }), 1953)).toBe(3);
  });

  it("returns 0 when neither anchors nor a scalar are declared", () => {
    expect(baselineLevelFor(law({ baselineLevel: undefined }), 1953)).toBe(0);
  });

  it("clamps below the first and above the last anchor", () => {
    const l = law({
      baselineLevelAnchors: [
        { year: 1964, level: 1 },
        { year: 1991, level: 4 },
      ],
    });
    expect(baselineLevelFor(l, 1900)).toBe(1);
    expect(baselineLevelFor(l, 2049)).toBe(4);
  });

  it("rounds to the nearest whole level between anchors", () => {
    const l = law({
      baselineLevelAnchors: [
        { year: 1960, level: 0 },
        { year: 1980, level: 4 },
      ],
    });
    expect(baselineLevelFor(l, 1970)).toBe(2);
  });
});

describe("getCatalog", () => {
  it("returns every law when no year is given", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      expect(getCatalog(countryId).length).toBeGreaterThan(0);
    }
  });

  it("returns the same set at 1953 as unfiltered, since no law declares a window yet", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      expect(getCatalog(countryId, 1953).map((l) => l.id)).toEqual(
        getCatalog(countryId).map((l) => l.id)
      );
    }
  });
});
