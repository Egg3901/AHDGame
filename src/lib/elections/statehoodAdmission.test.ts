import { describe, expect, it } from "vitest";
import {
  ADMISSION_CDF_AT_HISTORICAL_YEAR,
  TERRITORY_ADMISSIONS,
  admissionCdf,
  admissionHazard,
  admissionRoll,
  admittedStateIdsAsOf,
  buildAdmissionContent,
  decideAdmissions,
  isUsPoliticalState,
  isUsResidentPoliticalRegion,
  type TerritoryAdmission,
} from "./statehoodAdmission";

const AK = TERRITORY_ADMISSIONS.find((t) => t.stateId === "AK")!;

/** Walk the per-year hazards and return the year this world admits in. */
function admissionYearFor(t: TerritoryAdmission, iteration: string): number {
  for (let year = t.windowStartYear; year <= t.windowEndYear; year++) {
    if (decideAdmissions([t], year, iteration).length > 0) return year;
  }
  return t.windowEndYear;
}

describe("admissionCdf", () => {
  it("is zero before the window opens", () => {
    expect(admissionCdf(AK, AK.windowStartYear - 1)).toBe(0);
    expect(admissionCdf(AK, 1900)).toBe(0);
  });

  it("puts the median exactly on the historical year", () => {
    expect(admissionCdf(AK, AK.historicalYear)).toBeCloseTo(ADMISSION_CDF_AT_HISTORICAL_YEAR, 10);
  });

  it("reaches certainty at the end of the window", () => {
    expect(admissionCdf(AK, AK.windowEndYear)).toBe(1);
    expect(admissionCdf(AK, AK.windowEndYear + 50)).toBe(1);
  });

  it("never decreases", () => {
    let prev = -1;
    for (let year = 1940; year <= 1980; year++) {
      const f = admissionCdf(AK, year);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("admissionHazard", () => {
  it("is zero outside the window", () => {
    expect(admissionHazard(AK, AK.windowStartYear - 1)).toBe(0);
    expect(admissionHazard(AK, AK.windowEndYear + 1)).toBe(0);
  });

  it("reproduces the CDF when applied year by year", () => {
    // Survival = product of (1 - hazard). 1 - survival must equal the CDF, or
    // the median the CDF promises is not the median players experience.
    let survival = 1;
    for (let year = AK.windowStartYear; year <= AK.windowEndYear; year++) {
      survival *= 1 - admissionHazard(AK, year);
      expect(1 - survival).toBeCloseTo(admissionCdf(AK, year), 10);
    }
  });

  it("rises as the historical year approaches", () => {
    expect(admissionHazard(AK, 1951)).toBeLessThan(admissionHazard(AK, 1958));
  });
});

describe("admissionRoll", () => {
  it("is deterministic for the same world, territory and year", () => {
    expect(admissionRoll("AK", 1959, "beta-2")).toBe(admissionRoll("AK", 1959, "beta-2"));
  });

  it("differs across worlds, territories and years", () => {
    const base = admissionRoll("AK", 1959, "beta-2");
    expect(admissionRoll("AK", 1959, "beta-3")).not.toBe(base);
    expect(admissionRoll("HI", 1959, "beta-2")).not.toBe(base);
    expect(admissionRoll("AK", 1960, "beta-2")).not.toBe(base);
  });

  it("stays in [0, 1)", () => {
    for (let year = 1950; year <= 1970; year++) {
      const r = admissionRoll("AK", year, "beta-2");
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});

describe("decideAdmissions", () => {
  it("admits nothing before the window opens", () => {
    expect(decideAdmissions(TERRITORY_ADMISSIONS, 1949, "beta-2")).toEqual([]);
  });

  it("admits everything left by the end of the window", () => {
    const decided = decideAdmissions(TERRITORY_ADMISSIONS, AK.windowEndYear, "beta-2");
    expect(decided.map((d) => d.stateId).sort()).toEqual(["AK", "HI"]);
  });

  it("is idempotent within a year — re-running a turn cannot roll twice", () => {
    const first = decideAdmissions(TERRITORY_ADMISSIONS, 1959, "beta-2");
    const second = decideAdmissions(TERRITORY_ADMISSIONS, 1959, "beta-2");
    expect(second).toEqual(first);
  });

  it("lands the median on the historical year across many worlds", () => {
    const years = Array.from({ length: 400 }, (_, i) => admissionYearFor(AK, `world-${i}`)).sort(
      (a, b) => a - b
    );
    const median = years[Math.floor(years.length / 2)];
    // The curve is built to put the median on 1959; allow a year of sampling
    // slack rather than pinning a specific hash's output.
    expect(median).toBeGreaterThanOrEqual(AK.historicalYear - 1);
    expect(median).toBeLessThanOrEqual(AK.historicalYear + 1);
  });

  it("is gravity, not a rail — worlds admit both before and after 1959", () => {
    const years = Array.from({ length: 400 }, (_, i) => admissionYearFor(AK, `world-${i}`));
    expect(years.some((y) => y < AK.historicalYear)).toBe(true);
    expect(years.some((y) => y > AK.historicalYear)).toBe(true);
    // ...but not so loose that the historical year stops meaning anything.
    const nearHistorical = years.filter((y) => Math.abs(y - AK.historicalYear) <= 3).length;
    expect(nearHistorical / years.length).toBeGreaterThan(0.4);
  });

  it("makes the historical year the single most likely admission year", () => {
    // The median alone does not pin this: a post-anchor ramp that is too steep
    // moves the MODE to the year after the anchor while leaving the median
    // where it was, quietly shifting the centre of gravity off the history.
    const counts = new Map<number, number>();
    for (let i = 0; i < 2000; i++) {
      const y = admissionYearFor(AK, `world-${i}`);
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(mode).toBe(AK.historicalYear);
  });

  it("lets Alaska and Hawaii diverge rather than always moving together", () => {
    const split = Array.from({ length: 200 }, (_, i) => {
      const iteration = `world-${i}`;
      return (
        admissionYearFor(AK, iteration) !== admissionYearFor(TERRITORY_ADMISSIONS[1], iteration)
      );
    });
    expect(split.some(Boolean)).toBe(true);
  });
});

describe("buildAdmissionContent", () => {
  it("is empty when nothing was admitted", () => {
    expect(buildAdmissionContent([])).toBe("");
  });

  it("reads naturally for one and for two territories", () => {
    const one = buildAdmissionContent([{ stateId: "AK", name: "Alaska", year: 1959, hazard: 0.2 }]);
    expect(one).toContain("Alaska is admitted to the Union in 1959");

    const two = buildAdmissionContent([
      { stateId: "AK", name: "Alaska", year: 1959, hazard: 0.2 },
      { stateId: "HI", name: "Hawaii", year: 1959, hazard: 0.2 },
    ]);
    expect(two).toContain("Alaska and Hawaii are admitted to the Union in 1959");
  });
});

describe("admittedStateIdsAsOf", () => {
  const states = [
    { _id: "CA" },
    { _id: "AK", admittedYear: 1959 },
    { _id: "HI", admittedYear: 1962 },
  ];

  it("returns only states admitted at or before the year", () => {
    expect(admittedStateIdsAsOf(states, 1960)).toEqual(["AK"]);
    expect(admittedStateIdsAsOf(states, 1962)).toEqual(["AK", "HI"]);
  });

  it("includes a state in its own admission year", () => {
    expect(admittedStateIdsAsOf(states, 1959)).toEqual(["AK"]);
  });

  it("returns nothing before any admission", () => {
    expect(admittedStateIdsAsOf(states, 1953)).toEqual([]);
  });

  it("ignores states that were never territories", () => {
    expect(admittedStateIdsAsOf(states, 2100)).not.toContain("CA");
  });
});

describe("isUsPoliticalState", () => {
  it("keeps contiguous states under 1953-default", () => {
    expect(isUsPoliticalState("CA", "1953-default")).toBe(true);
    expect(isUsPoliticalState("WY", "1953-default")).toBe(true);
  });

  it("excludes AK/HI under 1953-default until admitted", () => {
    expect(isUsPoliticalState("AK", "1953-default")).toBe(false);
    expect(isUsPoliticalState("HI", "1953-default")).toBe(false);
    expect(isUsPoliticalState("AK", "1953-default", new Set(["AK"]))).toBe(true);
    expect(isUsPoliticalState("HI", "1953-default", new Set(["HI"]))).toBe(true);
  });

  it("includes AK/HI under modern presets", () => {
    expect(isUsPoliticalState("AK", "2019-default")).toBe(true);
    expect(isUsPoliticalState("HI", "2019-default")).toBe(true);
  });

  it("excludes DC in every era", () => {
    expect(isUsPoliticalState("DC", "1953-default")).toBe(false);
    expect(isUsPoliticalState("DC", "2019-default")).toBe(false);
  });
});

describe("isUsResidentPoliticalRegion", () => {
  it("keeps Alaska and Hawaii playable before admission without making DC playable", () => {
    expect(isUsResidentPoliticalRegion("AK", "1953-default")).toBe(true);
    expect(isUsResidentPoliticalRegion("HI", "1953-default")).toBe(true);
    expect(isUsResidentPoliticalRegion("DC", "1953-default")).toBe(false);
  });
});
