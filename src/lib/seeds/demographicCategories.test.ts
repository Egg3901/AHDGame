import { describe, it, expect } from "vitest";
import type { EraId } from "./presetSelector";
import { ERA_COMPOSITIONS, getEraComposition } from "./demographicCategories";

describe("ERA_COMPOSITIONS", () => {
  const eras = ["1979", "1991", "1999", "2007", "2019", "2023"] as const;

  it("all 6 eras have non-empty groupIds, compositions, and leans", () => {
    for (const era of eras) {
      const comp = ERA_COMPOSITIONS[era];
      expect(comp.groupIds.length).toBeGreaterThan(0);
      expect(Object.keys(comp.voterGroupComposition).length).toBeGreaterThan(0);
      expect(Object.keys(comp.defaultLeans).length).toBeGreaterThan(0);
      expect(Object.keys(comp.defaultTurnouts).length).toBeGreaterThan(0);
    }
  });

  it("2019 composition contains expected groups (young_renters, evangelicals)", () => {
    const comp = ERA_COMPOSITIONS["2019"];
    expect(comp.groupIds).toContain("young_renters");
    expect(comp.groupIds).toContain("evangelicals");
    expect(comp.voterGroupComposition["young_renters"]).toBeDefined();
    expect(comp.voterGroupComposition["evangelicals"]).toBeDefined();
    expect(comp.defaultLeans["young_renters"]).toBeDefined();
    expect(comp.defaultLeans["evangelicals"]).toBeDefined();
    expect(comp.defaultTurnouts["young_renters"]).toBeDefined();
    expect(comp.defaultTurnouts["evangelicals"]).toBeDefined();
  });

  it("getEraComposition returns correct composition for valid era", () => {
    const comp = getEraComposition("2019");
    expect(comp).toBe(ERA_COMPOSITIONS["2019"]);
  });

  it("getEraComposition throws for invalid era", () => {
    expect(() => getEraComposition("invalid-era" as EraId)).toThrow(
      'No composition defined for era "invalid-era"'
    );
  });
});

describe("DEMOGRAPHIC_POSITIONS 1953 hydration (audit P0)", () => {
  it("1953 positions are hydrated (not the empty placeholder)", async () => {
    const { DEMOGRAPHIC_POSITIONS } = await import("./demographicCategories");
    expect(Object.keys(DEMOGRAPHIC_POSITIONS["1953"]).length).toBeGreaterThan(0);
  });

  it("getEraPositions('1953') applies era overrides instead of returning empty leans", async () => {
    const { getEraPositions } = await import("./demographicCategories");
    const base = getEraPositions("1953");
    expect(Object.keys(base).length).toBeGreaterThan(0);
    // Spot-check an authored 1953 override dimension exists with numeric leans.
    const anyDim = Object.values(base)[0];
    const anyPos = Object.values(anyDim)[0];
    expect(typeof anyPos.economicLean).toBe("number");
  });

  it("getEraPositions('1953', 'AL') merges Solid-South state overrides without throwing", async () => {
    const { getEraPositions } = await import("./demographicCategories");
    const al = getEraPositions("1953", "AL");
    // 2026-08 compressed calibration solved AL whites to -2.4 economic (#4054).
    // The social value is authored independently: economically Democratic
    // (Solid South) and socially reactionary (Jim Crow). It was -1.6, a scaled
    // copy of the economic lean, which made the Deep South read as the most
    // socially LEFT region in 1953.
    expect(al.race?.white).toEqual({ economicLean: -2.4, socialLean: 4 });
  });

  it("getEraPositions('1953') applies STATE_POSITION_OVERRIDES when stateId is passed: VT shifts right of the era baseline", async () => {
    const { getEraPositions } = await import("./demographicCategories");
    const base = getEraPositions("1953");
    const vt = getEraPositions("1953", "VT");
    // Vermont was the strongest GOP state in 1952 (R+43.3) — its whites must
    // sit RIGHT of the era-wide white baseline once the state table applies.
    expect(vt.race.white.economicLean).toBeGreaterThan(base.race.white.economicLean);
    // Yankee reform "progressives" were Republicans in this era — VT's
    // progressive bucket is overridden right of the era-wide labor left.
    expect(vt.ideology.progressives.economicLean).toBeGreaterThan(
      base.ideology.progressives.economicLean
    );
    // The Solid South counterweight pulls the other way.
    const al = getEraPositions("1953", "AL");
    expect(al.race.white.economicLean).toBeLessThan(base.race.white.economicLean);
    expect(al.ideology.evangelicals.economicLean).toBeLessThan(
      base.ideology.evangelicals.economicLean
    );
    // No stateId → pristine era table (call-sites without state context are unchanged).
    expect(getEraPositions("1953")).toEqual(base);
  });
});

describe("1953 national aggregate lean (1952-vote calibration)", () => {
  it("population-weighted bucket aggregate lands at a mild Republican econ tilt (~+0.25..+0.5)", async () => {
    // The 1952 vote was Eisenhower 55.2 / Stevenson 44.3. The era table must
    // aggregate to a MILD R tilt (registration was still Democratic), not the
    // pre-recalibration ~-1.3 that seeded a uniformly left electorate and
    // re-elected a Democrat 79/21 in 1956 sims.
    //
    // Band floor 0.30→0.25 with the authored 1950-census shares (refs #3241):
    // the original band was calibrated against the 1979-proxy shares, which
    // aggregated to +0.361. The authored 1950 electorate is poorer and less
    // educated (no_college ~93% vs ~80%, low-wealth ~37% vs ~28%) and those
    // buckets lean econ-left in the era table, legitimately shaving the
    // aggregate to +0.281 while preserving the mild R tilt the test exists to
    // protect (this static aggregate also ignores turnout, which suppressed
    // the era's poor/Southern-Black D-leaning buckets).
    const { getEraPositions } = await import("./demographicCategories");
    const { stateCensusData1953 } = await import("./stateCensusData1953");
    const { states1979 } = await import("./reference/states1979");

    const popByState = new Map<string, number>();
    for (const s of states1979) {
      if (s.countryId && s.countryId !== "US") continue;
      popByState.set(s._id, s.population ?? 0);
    }

    const DIMS = ["race", "age", "education", "wealth"] as const;
    const pos = getEraPositions("1953") as Record<
      string,
      Record<string, { economicLean: number; socialLean: number }>
    >;
    let wTot = 0;
    let econ = 0;
    for (const [stateId, cfg] of Object.entries(stateCensusData1953)) {
      const pop = popByState.get(stateId) ?? 0;
      if (pop <= 0) continue;
      let se = 0;
      for (const dim of DIMS) {
        const shares = (cfg as unknown as Record<string, Record<string, number>>)[dim] ?? {};
        for (const [key, share] of Object.entries(shares)) {
          const p = pos[dim]?.[key];
          if (p) se += (share / 100) * p.economicLean;
        }
      }
      se /= DIMS.length; // each dim's shares sum to ~100
      wTot += pop;
      econ += pop * se;
    }
    const aggregate = econ / wTot;
    expect(aggregate).toBeGreaterThanOrEqual(0.25);
    expect(aggregate).toBeLessThanOrEqual(0.5);
  });
});
