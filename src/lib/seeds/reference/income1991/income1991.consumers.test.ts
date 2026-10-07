/**
 * Consumers of the 1991 NG/CN/TR income vintages (#3370 #3371 #3376): the real
 * seed writers, the first medianIncome engine update, and era income scoring.
 * Also pins that worlds starting in 1979, 1999 and 2007 keep their bands.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";
import {
  INCOME_START_VINTAGES,
  getIncomeAnchor,
  getStartingIncomeAnchor,
} from "@/lib/era/metricCatalog";
import { getMetricThreshold, scoreMetric } from "@/lib/utils/metricScoring";
import { evaluateRegistry } from "@/lib/metricEngine/evaluate";
import { medianIncomeNode } from "@/lib/metricEngine/registry/economic";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { INCOME_BAND_BACKSOLVE_MAX, INCOME_BAND_BACKSOLVE_MIN } from "@/lib/nationalMetrics";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { cnRegions1991 } from "@/lib/countries/cn/data/cnRegions1991";
import { trRegions1991 } from "@/lib/countries/tr/data/trRegions1991";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { trStateMetrics } from "@/lib/seeds/tr/trStateMetrics";
import {
  INCOME_1991_REGIONAL,
  gdpPerResident1991,
  nationalHouseholdMedian1991,
  type Income1991CountryId,
} from "./index";

const FIXED: Income1991CountryId[] = ["NG", "CN", "TR"];
const REGIONS = { NG: ngRegions1991, CN: cnRegions1991, TR: trRegions1991 } as Record<
  Income1991CountryId,
  Array<{ _id: unknown; population: number }>
>;
const BASE = { NG: ngStateMetrics, CN: cnStateMetrics, TR: trStateMetrics };

type MacroSet = { economic?: { medianIncome?: { value: number } } };
type BaselineSet = { baselines: { economic: { medianIncome: number } } };

async function seedWriters(c: Income1991CountryId) {
  const mod =
    c === "NG"
      ? await import("@/lib/admin/seed/seedNG")
      : c === "CN"
        ? await import("@/lib/admin/seed/seedCN")
        : await import("@/lib/admin/seed/seedTR");
  const m = mod as unknown as Record<
    string,
    (db: Db, reset: boolean, log: (s: string) => void, preset: string) => Promise<void>
  >;
  return { metrics: m[`seed${c}StateMetrics`], baselines: m[`seed${c}Baselines`] };
}

async function seededIncome(c: Income1991CountryId, preset: string) {
  const db: MockDb = createMockDb();
  const writers = await seedWriters(c);
  await writers.metrics(db as unknown as Db, true, () => {}, preset);
  await writers.baselines(db as unknown as Db, true, () => {}, preset);
  const metrics = new Map<string, number>();
  for (const [filter, update] of bulkOps(db.collectionMocks.macroMetrics!.bulkWrite)) {
    const v = (update.$set as MacroSet | undefined)?.economic?.medianIncome?.value;
    if (typeof v === "number") metrics.set(String(filter._id), v);
  }
  const baselines = new Map<string, number>();
  for (const call of db.collectionMocks.stateBaselines!.updateOne.mock.calls) {
    const id = String((call[0] as { _id: unknown })._id);
    baselines.set(id, (call[1] as { $set: BaselineSet }).$set.baselines.economic.medianIncome);
  }
  return { metrics, baselines };
}

function popWeighted(c: Income1991CountryId, values: Map<string, number>): number {
  let pop = 0;
  let sum = 0;
  for (const r of REGIONS[c]) {
    const v = values.get(String(r._id));
    if (v === undefined) continue;
    pop += r.population;
    sum += v * r.population;
  }
  return sum / pop;
}

// The seed writers lazy-import whole country bundles; the first import is slow.
describe("1991 income vintages through the real seed writers", { timeout: 60_000 }, () => {
  beforeEach(() => vi.clearAllMocks());

  for (const c of FIXED) {
    it(`${c}: writes the vintage to macroMetrics and stateBaselines, region by region`, async () => {
      const { metrics, baselines } = await seededIncome(c, "1991-default");
      expect(metrics.size).toBe(Object.keys(INCOME_1991_REGIONAL[c]).length);
      for (const [id, v] of metrics) {
        expect(v).toBe(INCOME_1991_REGIONAL[c][id]);
        expect(baselines.get(id)).toBe(v);
      }
      // The population-weighted national value the nationalMetrics back-solve
      // reads equals the start anchor, so the band index starts at 1.
      const implied = popWeighted(c, metrics) / getStartingIncomeAnchor(c, 1991)!;
      expect(implied).toBeCloseTo(1, 3);
      expect(implied).toBeGreaterThanOrEqual(INCOME_BAND_BACKSOLVE_MIN);
      expect(implied).toBeLessThanOrEqual(INCOME_BAND_BACKSOLVE_MAX);
    });

    it(`${c}: 2019-default seeds are not touched by the 1991 vintage`, async () => {
      const { metrics } = await seededIncome(c, "2019-default");
      const vintageHits = [...metrics].filter(([id, v]) => INCOME_1991_REGIONAL[c][id] === v);
      expect(vintageHits).toHaveLength(0);
    });
  }

  it("TR 1979-default still writes the 1979-lira base bundle", async () => {
    const { metrics } = await seededIncome("TR", "1979-default");
    for (const m of BASE.TR) {
      const v = metrics.get(String(m._id));
      if (v !== undefined) expect(v).not.toBe(INCOME_1991_REGIONAL.TR[String(m._id)]);
    }
  });
});

describe("first medianIncome engine updates on a fresh 1991 world", { timeout: 60_000 }, () => {
  for (const c of FIXED) {
    it(`${c}: holds the seed on turn one, grows it on turn two, inside the node bounds`, async () => {
      const { metrics } = await seededIncome(c, "1991-default");
      const productivity = 1.2;
      const unemployment = 5;
      const seedCurrent = {
        "economic.productivityGrowth": productivity,
        "economic.unemploymentRate": unemployment,
      };
      const after = new Map<string, number>();
      for (const [id, seeded] of metrics) {
        expect(seeded).toBeLessThanOrEqual(medianIncomeNode.bounds[1]);
        // Turn one on a fresh world: no simBaseline yet (cold start).
        const t1 = evaluateRegistry([medianIncomeNode], {
          stateId: id,
          countryId: c,
          prev: { "economic.medianIncome": seeded },
          prevSimBaseline: {},
          providers: {},
          spending: {},
          policyValues: { "economic.medianIncome": seeded },
          seedCurrent,
        })["economic.medianIncome"];
        expect(t1.value).toBeCloseTo(seeded, 0);
        // Turn two: the persisted simBaseline and value carry forward.
        const t2 = evaluateRegistry([medianIncomeNode], {
          stateId: id,
          countryId: c,
          prev: { "economic.medianIncome": t1.value },
          prevSimBaseline: { "economic.medianIncome": t1.simBaseline },
          providers: {},
          spending: {},
          policyValues: { "economic.medianIncome": t1.value },
          seedCurrent,
        })["economic.medianIncome"];
        // Whole-unit value over a 6dp baseline (#3394): the baseline compounds
        // exactly; the value lands within a unit (or 1e-6) of it after rounding.
        const growth = 1 + productivity / 100 / TURNS_PER_YEAR;
        const grown = t1.value * growth;
        expect(Math.abs(t2.value - grown)).toBeLessThanOrEqual(Math.max(1, grown * 1e-6));
        expect(Math.abs(t2.simBaseline - t1.simBaseline * growth)).toBeLessThan(1e-5);
        expect(t2.value).toBeGreaterThanOrEqual(t1.value);
        after.set(id, t2.value);
      }
      // Still the same vintage: household median stays 1x to 4x GDP per resident.
      const national = popWeighted(c, after);
      const ratio = national / gdpPerResident1991(c);
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(4);
      // And the national value still scores mid-band, not pinned.
      const score = scoreMetric("medianIncome", national, c, "1991-default", 1991, 1, 1991)!;
      expect(score).toBeGreaterThan(60);
      expect(score).toBeLessThan(80);
    });
  }
});

describe("era income scoring for worlds starting in 1991", () => {
  // anchor x 1.25 is best, anchor x 0.45 is worst, so the anchor scores 68.75.
  const AT_ANCHOR = ((1 - 0.45) / (1.25 - 0.45)) * 100;

  for (const c of FIXED) {
    it(`${c}: start anchor equals the derived national household median`, () => {
      expect(getStartingIncomeAnchor(c, 1991)).toBe(Math.round(nationalHouseholdMedian1991(c)));
      expect(
        scoreMetric(
          "medianIncome",
          nationalHouseholdMedian1991(c),
          c,
          "1991-default",
          1991,
          1,
          1991
        )
      ).toBeCloseTo(AT_ANCHOR, 1);
    });
  }

  it("TR 1991 regional scores leave the old 1,900-lira saturation", () => {
    const scores = Object.values(INCOME_1991_REGIONAL.TR).map((v) =>
      scoreMetric("medianIncome", v, "TR", "1991-default", 1991, 1, 1991)!
    );
    // Three of eight regions score strictly inside the band. The others sit at
    // an edge because the authored regional shape spans 4.0x richest to
    // poorest against a band 1.25 / 0.45 = 2.78x wide; see the sim report.
    const inside = scores.filter((s) => s > 0 && s < 100).length;
    expect(inside).toBeGreaterThanOrEqual(3);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(50);
    // The interpolation anchor alone (flat 1953, 1,900 lira) pins every region at 100.
    const flat = getIncomeAnchor("TR", 1991)!;
    expect(flat).toBe(1900);
    for (const v of Object.values(INCOME_1991_REGIONAL.TR)) {
      expect(v).toBeGreaterThan(flat * 1.25);
    }
  });

  it("a policy-driven income gain or loss moves the TR score both ways", () => {
    const median = nationalHouseholdMedian1991("TR");
    const at = scoreMetric("medianIncome", median, "TR", "1991-default", 1991, 1, 1991)!;
    const up = scoreMetric("medianIncome", median * 1.1, "TR", "1991-default", 1993, 1, 1991)!;
    const down = scoreMetric("medianIncome", median * 0.9, "TR", "1991-default", 1993, 1, 1991)!;
    expect(up).toBeGreaterThan(at);
    expect(down).toBeLessThan(at);
  });
});

describe("other start years keep their pre-#3316 anchors and bands", () => {
  // Literal values from the interpolation series as it stood before this
  // change: NG 1979 90,000 / 1991 210,000 / 2019 1,100,000; CN 1979 3,500 /
  // 1991 9,000 / 2019 90,000; TR flat 1,900.
  const EXPECTED: Record<Income1991CountryId, Record<number, number>> = {
    NG: {
      1979: 90_000,
      1999: 210_000 + (890_000 * 8) / 28,
      2007: 210_000 + (890_000 * 16) / 28,
    },
    CN: {
      1979: 3_500,
      1999: 9_000 + (81_000 * 8) / 28,
      2007: 9_000 + (81_000 * 16) / 28,
    },
    TR: { 1953: 1_900, 1979: 1_900, 1999: 1_900, 2007: 1_900 },
  };

  for (const c of FIXED) {
    for (const [yearStr, expected] of Object.entries(EXPECTED[c])) {
      const start = Number(yearStr);
      it(`${c} start ${start}: anchor and band unchanged`, () => {
        expect(getIncomeAnchor(c, start)).toBeCloseTo(expected, 6);
        expect(getStartingIncomeAnchor(c, start)).toBeCloseTo(expected, 6);
        const band = getMetricThreshold("medianIncome", c, undefined, start + 5, 1.3, start)!;
        expect(band.best).toBeCloseTo(expected * 1.25 * 1.3, 4);
        expect(band.worst).toBeCloseTo(expected * 0.45 * 1.3, 4);
      });
    }
  }

  it("the 1991 point is still in the interpolation series for NG and CN", () => {
    expect(getIncomeAnchor("NG", 1991)).toBe(210_000);
    expect(getIncomeAnchor("CN", 1991)).toBe(9_000);
  });

  it("start vintages exist only for NG, CN and TR at 1991", () => {
    expect(Object.keys(INCOME_START_VINTAGES).sort()).toEqual(["CN", "NG", "TR"]);
    for (const c of FIXED) expect(Object.keys(INCOME_START_VINTAGES[c]!)).toEqual(["1991"]);
  });

  it("flag-off legacy scoring (no start year) is unchanged by the vintage", () => {
    for (const c of FIXED) {
      expect(getMetricThreshold("medianIncome", c, "1991-default", null, null, null)).toEqual(
        getMetricThreshold("medianIncome", c, "1991-default", null, null, 1991)
      );
    }
  });
});
