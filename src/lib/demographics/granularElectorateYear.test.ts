/**
 * The live era clock as the vote path actually sees it.
 *
 * `granularElectorate.test.ts` covers the substrate with the clock OFF. This
 * file covers the clock ON: that a year-driven world is identical to a legacy
 * one at its seed anchor, genuinely different between anchors, and — the bug
 * that would be invisible without a test — that the memo cache does not serve
 * one year's cells for another year.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
  deriveGranularElectorateUnits,
  type GranularElectorateUnit,
} from "./granularElectorate";
import { resetEraInterpolationFallbacks } from "@/lib/seeds/eraInterpolation";

const LEGACY_CATEGORIES: DemographicCategory[] = [];
const LEGACY_DEMOGRAPHICS = {
  _id: "AL",
  countryId: "US",
  groups: {},
} as unknown as StateDemographics;

function candidate(id: string, party: string, ep: number, sp: number): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: `${id}_char`,
    characterName: id,
    party,
    isNPP: false,
    charEP: ep,
    charSP: sp,
    favorability: 55,
    politicalInfluence: 60,
    nationalInfluence: 50,
  } as EnrichedCandidate;
}

function units(
  stateId: string,
  opts: { preset?: string; year?: number | null; startingYear?: number | null } = {}
): GranularElectorateUnit[] | null {
  const got = deriveGranularElectorateUnits(
    "US",
    stateId,
    opts.preset ?? "1953-default",
    null,
    null,
    null,
    { year: opts.year ?? null, startingYear: opts.startingYear ?? null }
  );
  return got?.units ?? null;
}

/** Share-weighted mean economic lean of a unit list — one comparable number. */
function meanLean(list: GranularElectorateUnit[] | null): number | null {
  if (!list || list.length === 0) return null;
  let share = 0;
  let acc = 0;
  for (const u of list) {
    share += u.share;
    acc += u.share * u.economicLean;
  }
  return share === 0 ? null : acc / share;
}

function meanSocialLean(list: GranularElectorateUnit[] | null): number | null {
  if (!list || list.length === 0) return null;
  let share = 0;
  let acc = 0;
  for (const u of list) {
    share += u.share;
    acc += u.share * u.socialLean;
  }
  return share === 0 ? null : acc / share;
}

function meanTurnout(list: GranularElectorateUnit[] | null): number | null {
  if (!list || list.length === 0) return null;
  let share = 0;
  let acc = 0;
  for (const u of list) {
    share += u.share;
    acc += u.share * u.turnout;
  }
  return share === 0 ? null : acc / share;
}

beforeEach(() => {
  clearGranularElectorateCache();
  resetEraInterpolationFallbacks();
});

describe("clock off — legacy behavior preserved", () => {
  it("a null year derives exactly what the preset-driven path derives", () => {
    for (const stateId of ["AL", "CA", "NY"]) {
      const legacy = units(stateId, { year: null });
      clearGranularElectorateCache();
      const explicitNull = units(stateId, { year: null, startingYear: 1953 });
      expect(explicitNull).toEqual(legacy);
    }
  });
});

describe("anchor identity through the whole vote path", () => {
  it("a 1953 world sitting at 1953 has an unchanged LEAN distribution", () => {
    // Positions and census marginals are byte-identical at an anchor, so the
    // electorate's political centre of gravity must not move at all.
    //
    // Turnout is the one deliberate exception, asserted separately below: there
    // was no era turnout table before this change — every era used 2020's
    // rates — so a 1953 world's participation SHOULD change. Because units are
    // coalesced on quantized turnout as well as lean, that reshuffles unit
    // boundaries, which is why this compares the aggregate rather than
    // unit-for-unit.
    for (const stateId of ["AL", "CA", "MA"]) {
      const legacy = units(stateId, { preset: "1953-default", year: null });
      clearGranularElectorateCache();
      const atAnchor = units(stateId, {
        preset: "1953-default",
        year: 1953,
        startingYear: 1953,
      });
      expect(meanLean(atAnchor)).toBeCloseTo(meanLean(legacy) as number, 10);
      expect(meanSocialLean(atAnchor)).toBeCloseTo(meanSocialLean(legacy) as number, 10);
    }
  });

  it("a 1953 world's TURNOUT does move off the 2020 table — the point of the change", () => {
    const legacy = meanTurnout(units("CA", { preset: "1953-default", year: null }));
    clearGranularElectorateCache();
    const atAnchor = meanTurnout(
      units("CA", { preset: "1953-default", year: 1953, startingYear: 1953 })
    );
    expect(legacy).not.toBeNull();
    expect(atAnchor).not.toBeNull();
    expect(Math.abs((atAnchor as number) - (legacy as number))).toBeGreaterThan(0.5);
  });

  it("a 2019 world sitting at 2019 is a no-op", () => {
    const legacy = units("CA", { preset: "2019-default", year: null });
    clearGranularElectorateCache();
    const atAnchor = units("CA", { preset: "2019-default", year: 2019, startingYear: 2019 });
    expect(atAnchor).toEqual(legacy);
  });
});

describe("the clock actually moves the electorate", () => {
  it("a 1953-seeded world reaching 1979 derives the 1979 electorate, not the 1953 one", () => {
    const at1953 = units("AL", { year: 1953, startingYear: 1953 });
    clearGranularElectorateCache();
    const at1979 = units("AL", { year: 1979, startingYear: 1953 });
    expect(at1953).not.toEqual(at1979);

    // Alabama's realignment: the electorate's centre of gravity moves right.
    const before = meanLean(at1953);
    const after = meanLean(at1979);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after as number).toBeGreaterThan(before as number);
  });

  it("lands a mid-anchor year between its neighbours", () => {
    const at1953 = meanLean(units("AL", { year: 1953, startingYear: 1953 }));
    clearGranularElectorateCache();
    const at1966 = meanLean(units("AL", { year: 1966, startingYear: 1953 }));
    clearGranularElectorateCache();
    const at1979 = meanLean(units("AL", { year: 1979, startingYear: 1953 }));

    expect(at1966 as number).toBeGreaterThan(at1953 as number);
    expect(at1966 as number).toBeLessThan(at1979 as number);
  });

  it("moves turnout with the era, not just leans", () => {
    // 1953's age curve is flatter and its senior rate LOWER than 2020's; the
    // two eras must not produce the same participation.
    const t1953 = meanTurnout(units("CA", { year: 1953, startingYear: 1953 }));
    clearGranularElectorateCache();
    const t2019 = meanTurnout(units("CA", { year: 2019, startingYear: 1953 }));
    expect(t1953).not.toBeNull();
    expect(t2019).not.toBeNull();
    expect(Math.abs((t1953 as number) - (t2019 as number))).toBeGreaterThan(0.5);
  });
});

describe("the memo cache is year-aware", () => {
  it("does not serve one year's cells for another", () => {
    // Without the year in the cache key the SECOND call returns the first
    // call's units and the electorate silently freezes at whatever year was
    // asked for first. Deliberately no cache clear between the two calls.
    const first = units("AL", { year: 1953, startingYear: 1953 });
    const second = units("AL", { year: 1979, startingYear: 1953 });
    expect(first).not.toEqual(second);
  });

  it("still serves a repeat of the same year from cache", () => {
    const first = units("AL", { year: 1966, startingYear: 1953 });
    const second = units("AL", { year: 1966, startingYear: 1953 });
    expect(second).toEqual(first);
  });

  it("separates worlds that share a year but not a starting year", () => {
    // Checkpoint de-duplication is gated on startingYear, so these two worlds
    // legitimately have different baselines at the same year.
    const seeded1953 = units("AL", { year: 1979, startingYear: 1953 });
    const seeded1979 = units("AL", { year: 1979, startingYear: 1979 });
    expect(seeded1953).not.toEqual(seeded1979);
  });
});

describe("substrate input threading", () => {
  it("buildGranularElectorateSubstrate passes the year through to derivation", () => {
    const build = (year: number | null) =>
      buildGranularElectorateSubstrate({
        countryId: "US",
        stateId: "AL",
        preset: "1953-default",
        turnoutDoc: null,
        statePopulation: 1_000_000,
        demographics: LEGACY_DEMOGRAPHICS,
        categories: LEGACY_CATEGORIES,
        enriched: [candidate("l", "democrat", -2, -2), candidate("r", "republican", 2, 2)],
        year,
        startingYear: 1953,
      });

    const at1953 = build(1953);
    clearGranularElectorateCache();
    const at1979 = build(1979);
    expect(at1953).not.toBeNull();
    expect(at1979).not.toBeNull();
    expect(at1953?.units).not.toEqual(at1979?.units);
  });
});

describe("international identity changes do not break the vote path", () => {
  it("blends Germany across reunification without losing the region", () => {
    // BB/MV/SN/ST/TH exist only from the 1991 anchor. A blend that spans 1990
    // must still produce cells for a western Land, and must not throw.
    const bw = deriveGranularElectorateUnits("DE", "BW", "1979-default", null, null, null, {
      year: 1985,
      startingYear: 1979,
    });
    expect(bw?.units.length ?? 0).toBeGreaterThan(0);
  });

  it("handles Japan's retired education bucket across 1953→1979", () => {
    const jp = deriveGranularElectorateUnits("JP", "13", "1953-default", null, null, null, {
      year: 1966,
      startingYear: 1953,
    });
    // Either it derived cells or the region id is not in the model; what must
    // NOT happen is a throw escaping into the vote path.
    expect(jp === null || jp.units.length > 0).toBe(true);
  });
});
