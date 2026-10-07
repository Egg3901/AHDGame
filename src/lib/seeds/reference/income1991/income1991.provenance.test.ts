/**
 * Rollout gate for the 1991 NG/CN/TR income vintages (#3316). A world whose
 * incomes were seeded before the vintages existed carries no provenance stamp
 * and must keep scoring against the legacy anchor; only data written with the
 * matching stamp (fresh seed writers, or a reviewed migration that rewrites the
 * values) scores against the vintage anchor.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getIncomeAnchor,
  getStartingIncomeAnchor,
  incomeVintageStampsFor,
  INCOME_START_VINTAGES,
} from "@/lib/era/metricCatalog";
import { getMetricThreshold, scoreMetric } from "@/lib/utils/metricScoring";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import {
  INCOME_VINTAGE_SEED_COUNTRIES,
  stampSeededIncomeVintage,
  stampSeededIncomeVintages,
} from "@/lib/admin/seed/incomeStartVintage";
import { applyEra1991Adjustments } from "@/lib/seeds/reference/stateMetrics1991";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { cnRegions1991 } from "@/lib/countries/cn/data/cnRegions1991";
import { trRegions1991 } from "@/lib/countries/tr/data/trRegions1991";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { trStateMetrics } from "@/lib/seeds/tr/trStateMetrics";
import type { StateMetrics } from "@/lib/db/types";
import { nationalHouseholdMedian1991, seededIncomeVintageId, type Income1991CountryId } from ".";

// NG/CN/TR here; AT/ES/FI/FR/GR/IT/SE run the same gate in income1991.westEurope.test.ts.
type Fixed = Extract<Income1991CountryId, "NG" | "CN" | "TR">;
const FIXED: Fixed[] = ["NG", "CN", "TR"];
const ALL = Object.keys(INCOME_START_VINTAGES) as Income1991CountryId[];
const FRESH = incomeVintageStampsFor(1991);
const AT_ANCHOR = ((1 - 0.45) / (1.25 - 0.45)) * 100;

/** The incomes a 1991 world seeded before this change holds. */
const LEGACY_BUNDLES: Record<Fixed, StateMetrics[]> = {
  NG: ngStateMetrics.map((m) => applyEra1991Adjustments(m)),
  CN: cnStateMetrics.map((m) => applyEra1991Adjustments(m)),
  TR: trStateMetrics,
};
const REGIONS: Record<Fixed, Array<{ _id: unknown; population: number }>> = {
  NG: ngRegions1991,
  CN: cnRegions1991,
  TR: trRegions1991,
};

function legacyNational(c: Fixed): number {
  const byId = new Map(
    LEGACY_BUNDLES[c].map((m) => [String(m._id), m.economic?.medianIncome?.value])
  );
  let pop = 0;
  let sum = 0;
  for (const r of REGIONS[c]) {
    const v = byId.get(String(r._id));
    if (typeof v !== "number") continue;
    pop += r.population;
    sum += v * r.population;
  }
  return sum / pop;
}

/** The pre-vintage scoring formula: the interpolated anchor at the start year. */
function legacyScore(c: string, value: number, index = 1): number {
  const anchor = getIncomeAnchor(c, 1991)!;
  const best = anchor * 1.25 * index;
  const worst = anchor * 0.45 * index;
  return Math.max(0, Math.min(100, ((value - worst) / (best - worst)) * 100));
}

describe("income vintage provenance gate", () => {
  it("stamps exist only for authored vintages and carry their ids", () => {
    expect([...ALL].sort()).toEqual(["AT", "CN", "ES", "FI", "FR", "GR", "IT", "NG", "SE", "TR"]);
    expect(FRESH).toEqual(
      Object.fromEntries(ALL.map((c) => [c, INCOME_START_VINTAGES[c]![1991].id]))
    );
    // Every id is unique, so one country's stamp can never activate another's.
    expect(new Set(Object.values(FRESH)).size).toBe(ALL.length);
    expect(incomeVintageStampsFor(1979)).toEqual({});
    expect(incomeVintageStampsFor(2019)).toEqual({});
    expect(incomeVintageStampsFor(null)).toEqual({});
  });

  for (const c of FIXED) {
    it(`${c}: existing 1991 data with no stamp keeps its pre-vintage score`, () => {
      const national = legacyNational(c);
      for (const stamps of [undefined, null, {}]) {
        expect(getStartingIncomeAnchor(c, 1991, stamps)).toBe(getIncomeAnchor(c, 1991));
        for (const index of [1, 1.4]) {
          expect(
            scoreMetric("medianIncome", national, c, "1991-default", 1995, index, 1991, stamps)
          ).toBeCloseTo(legacyScore(c, national, index), 9);
        }
      }
    });

    it(`${c}: freshly seeded 1991 data with the stamp scores against the vintage`, () => {
      expect(getStartingIncomeAnchor(c, 1991, FRESH)).toBe(
        Math.round(nationalHouseholdMedian1991(c))
      );
      expect(
        scoreMetric(
          "medianIncome",
          nationalHouseholdMedian1991(c),
          c,
          "1991-default",
          1991,
          1,
          1991,
          FRESH
        )
      ).toBeCloseTo(AT_ANCHOR, 1);
    });

    it(`${c}: a stamp that does not match the authored vintage stays legacy`, () => {
      const id = INCOME_START_VINTAGES[c]![1991].id;
      for (const stamps of [
        { [c]: `${id}-stale` },
        { [c]: id.replace(/-r\d+$/, "-r0") },
        // Another country's stamp activates nothing here.
        Object.fromEntries(Object.entries(FRESH).filter(([k]) => k !== c)),
      ]) {
        expect(getStartingIncomeAnchor(c, 1991, stamps)).toBe(getIncomeAnchor(c, 1991));
      }
    });
  }

  it("TR: unstamped old-lira incomes are never scored against the vintage", () => {
    // The hazard the gate closes: legacy incomes against the vintage anchor
    // collapse from 100 to near 0. Unstamped, the anchor stays legacy.
    const national = legacyNational("TR");
    expect(scoreMetric("medianIncome", national, "TR", "1991-default", 1995, 1, 1991)).toBe(100);
    expect(
      scoreMetric("medianIncome", national, "TR", "1991-default", 1995, 1, 1991, FRESH)
    ).toBeLessThan(5);
  });

  it("other start years ignore the stamps entirely", () => {
    for (const c of ALL) {
      for (const start of [1953, 1979, 1999, 2007, 2019]) {
        expect(getStartingIncomeAnchor(c, start, FRESH)).toBe(getIncomeAnchor(c, start));
        expect(
          getMetricThreshold("medianIncome", c, undefined, start + 3, 1.2, start, FRESH)
        ).toEqual(getMetricThreshold("medianIncome", c, undefined, start + 3, 1.2, start));
      }
    }
    // Countries without a vintage are unaffected by any stamp.
    expect(getStartingIncomeAnchor("UK", 1991, { UK: "uk-1991-household-r1" })).toBe(
      getIncomeAnchor("UK", 1991)
    );
  });
});

describe("seed writers stamp the provenance they write", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("the stamp id is the vintage the 1991 writers apply, and nothing else", () => {
    for (const c of ALL) {
      expect(seededIncomeVintageId(c, "1991-default")).toBe(FRESH[c]);
      expect(seededIncomeVintageId(c, "2019-default")).toBeNull();
      expect(seededIncomeVintageId(c, "1979-default")).toBeNull();
    }
    expect(seededIncomeVintageId("UK", "1991-default")).toBeNull();
    // Every authored vintage has a writer that stamps it, and bootstrap re-applies it.
    expect([...INCOME_VINTAGE_SEED_COUNTRIES].sort()).toEqual([...ALL].sort());
  });

  it("a 1991 write sets the country stamp without upserting gameState", async () => {
    await stampSeededIncomeVintage(db as unknown as Db, "TR", "1991-default");
    const [filter, update, options] = db.collectionMocks.gameState!.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "current" });
    expect(update).toEqual({ $set: { "incomeStartVintages.TR": FRESH.TR } });
    expect(options).toBeUndefined();
  });

  it("a non-1991 write clears the country stamp", async () => {
    await stampSeededIncomeVintage(db as unknown as Db, "NG", "2019-default");
    const [, update] = db.collectionMocks.gameState!.updateOne.mock.calls[0];
    expect(update).toEqual({ $unset: { "incomeStartVintages.NG": "" } });
  });

  it("bootstrap re-applies every stamp once gameState exists", async () => {
    await stampSeededIncomeVintages(db as unknown as Db, "1991-default");
    const [, update] = db.collectionMocks.gameState!.updateOne.mock.calls[0];
    expect(update).toEqual({
      $set: Object.fromEntries(ALL.map((c) => [`incomeStartVintages.${c}`, FRESH[c]])),
    });
  });
});

describe("national band back-solve follows the stamp", () => {
  // One region; GDP is stored in millions of local currency.
  const STATES = [{ _id: "NG-X", countryId: "NG", population: 1_000_000, gdp: 1_000_000 }];

  async function bandIndex(income: number, stamps?: Record<string, string>, country = "NG") {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      toArray: () => Promise.resolve(STATES.map((state) => ({ ...state, countryId: country }))),
    });
    db.collection("macroMetrics").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: "NG-X", countryId: country, economic: { medianIncome: { value: income } } },
        ]),
    });
    db.collection("federalBudget").find.mockReturnValue({ toArray: () => Promise.resolve([]) });
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      eraSystemEnabled: true,
      startingYear: 1991,
      ...(stamps ? { incomeStartVintages: stamps } : {}),
    });
    await computeNationalMetrics(db as unknown as Db);
    const call = db.collectionMocks.gameState!.updateOne.mock.calls.at(-1)!;
    return call
      ? (call[1].$set as { incomeBandIndexByCountry: Record<string, number> })
          .incomeBandIndexByCountry[country]
      : undefined;
  }

  it("unstamped legacy incomes back-solve against the legacy anchor", async () => {
    expect(await bandIndex(getIncomeAnchor("NG", 1991)! * 2)).toBeCloseTo(2, 3);
  });

  it("stamped incomes back-solve against the vintage anchor", async () => {
    const vintage = INCOME_START_VINTAGES.NG![1991].value;
    expect(await bandIndex(vintage * 2, FRESH)).toBeCloseTo(2, 3);
    // The same incomes without the stamp are out of band for the legacy anchor
    // and fall back to index 1, exactly as before the vintage existed.
    expect(await bandIndex(vintage * 2)).toBeCloseTo(1, 3);
  });

  it("stamped TR regions get a real scoring index without a national scope document", async () => {
    const vintage = INCOME_START_VINTAGES.TR![1991].value;
    const index = await bandIndex(vintage, FRESH, "TR");
    expect(index).toBe(1);
    expect(
      scoreMetric("medianIncome", vintage, "TR", "1991-default", 1991, index, 1991, FRESH)
    ).toBeCloseTo(AT_ANCHOR, 6);
    expect(await bandIndex(legacyNational("TR"), undefined, "TR")).toBeUndefined();
    expect(await bandIndex(vintage, { TR: "unknown" }, "TR")).toBeUndefined();
  });
});
