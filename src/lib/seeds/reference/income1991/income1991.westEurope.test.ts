/**
 * 1991 income vintages for AT, ES, FI, FR, GR, IT and SE (#3393): the seed
 * writers, the audit loader, the start anchor, era scoring, the first engine
 * updates, and the anchors of every other start year.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";
import { getIncomeAnchor, getStartingIncomeAnchor } from "@/lib/era/metricCatalog";
import { getMetricThreshold, scoreMetric } from "@/lib/utils/metricScoring";
import { evaluateRegistry } from "@/lib/metricEngine/evaluate";
import { medianIncomeNode } from "@/lib/metricEngine/registry/economic";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { gdp1991LegacyLcu } from "@/lib/constants/fiscalAnchors1991";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";
import { atRegions1991 } from "@/lib/countries/at/data/atRegions1991";
import { esRegions1991 } from "@/lib/countries/es/data/esRegions1991";
import { fiRegions1991 } from "@/lib/countries/fi/data/fiRegions1991";
import { frRegions1991 } from "@/lib/countries/fr/data/frRegions1991";
import { grRegions1991 } from "@/lib/countries/gr/data/grRegions1991";
import { itRegions1991 } from "@/lib/countries/it/data/itRegions1991";
import { seRegions1991 } from "@/lib/countries/se/data/seRegions1991";
import { atStateMetrics } from "@/lib/seeds/at/atStateMetrics";
import { esStateMetrics } from "@/lib/seeds/es/esStateMetrics";
import { fiStateMetrics } from "@/lib/seeds/fi/fiStateMetrics";
import { frStateMetrics } from "@/lib/seeds/fr/frStateMetrics";
import { grStateMetrics } from "@/lib/seeds/gr/grStateMetrics";
import { itStateMetrics } from "@/lib/seeds/it/itStateMetrics";
import { seStateMetrics } from "@/lib/seeds/se/seStateMetrics";
import { INCOME_1991_REGIONAL, gdpPerResident1991, nationalHouseholdMedian1991 } from "./index";

const WEST = ["AT", "ES", "FI", "FR", "GR", "IT", "SE"] as const;
type West = (typeof WEST)[number];

type Row = { _id: unknown; population: number; gdp?: number };
const REGIONS: Record<West, Row[]> = {
  AT: atRegions1991,
  ES: esRegions1991,
  FI: fiRegions1991,
  FR: frRegions1991,
  GR: grRegions1991,
  IT: itRegions1991,
  SE: seRegions1991,
};
const BASE = {
  AT: atStateMetrics,
  ES: esStateMetrics,
  FI: fiStateMetrics,
  FR: frStateMetrics,
  GR: grStateMetrics,
  IT: itStateMetrics,
  SE: seStateMetrics,
};
// The only authored anchor before #3393: each country's 1953 overlay level.
const ANCHOR_1953: Record<West, number> = {
  AT: 18_400,
  ES: 14_000,
  FI: 292_500,
  FR: 420_000,
  GR: 9_300,
  IT: 550,
  SE: 8_000,
};

type MacroSet = { economic?: { medianIncome?: { value: number } } };
type BaselineSet = { baselines: { economic: { medianIncome: number } } };
type Writer = (db: Db, reset: boolean, log: (s: string) => void, preset: string) => Promise<void>;

async function seedWriters(c: West): Promise<{ metrics: Writer; baselines: Writer }> {
  const mods: Record<West, () => Promise<unknown>> = {
    AT: () => import("@/lib/admin/seed/seedAT"),
    ES: () => import("@/lib/admin/seed/seedES"),
    FI: () => import("@/lib/admin/seed/seedFI"),
    FR: () => import("@/lib/admin/seed/seedFR"),
    GR: () => import("@/lib/admin/seed/seedGR"),
    IT: () => import("@/lib/admin/seed/seedIT"),
    SE: () => import("@/lib/admin/seed/seedSE"),
  };
  const m = (await mods[c]()) as Record<string, Writer>;
  return { metrics: m[`seed${c}StateMetrics`], baselines: m[`seed${c}Baselines`] };
}

async function seededIncome(c: West, preset: string) {
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

function popWeighted(c: West, values: Map<string, number>): number {
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

const score = (c: West, v: number, year = 1991) =>
  scoreMetric("medianIncome", v, c, "1991-default", year, 1, 1991)!;

describe("#3393 vintage inputs share the 1991 GDP currency", () => {
  for (const c of WEST) {
    it(`${c}: GDP per resident is the WDI legacy-currency GDP over seed population`, () => {
      const pop = REGIONS[c].reduce((s, r) => s + r.population, 0);
      expect(gdpPerResident1991(c)).toBeCloseTo(gdp1991LegacyLcu(c) / pop, -2);
    });

    it(`${c}: household median sits 0.8x to 2x GDP per resident (was 0.18x to 0.70x)`, () => {
      const ratio = nationalHouseholdMedian1991(c) / gdpPerResident1991(c);
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(2);
    });
  }
});

describe("#3393 seed writers and loader", { timeout: 60_000 }, () => {
  beforeEach(() => vi.clearAllMocks());

  for (const c of WEST) {
    it(`${c}: writes the vintage to macroMetrics and stateBaselines, region by region`, async () => {
      const { metrics, baselines } = await seededIncome(c, "1991-default");
      expect(metrics.size).toBe(REGIONS[c].length);
      expect(Object.keys(INCOME_1991_REGIONAL[c]).length).toBe(REGIONS[c].length);
      for (const [id, v] of metrics) {
        expect(v).toBe(INCOME_1991_REGIONAL[c][id]);
        expect(baselines.get(id)).toBe(v);
      }
      // The national back-solve reads this population-weighted value against
      // the start anchor: index 1, inside the plausible band.
      expect(popWeighted(c, metrics) / getStartingIncomeAnchor(c, 1991)!).toBeCloseTo(1, 3);
    });

    it(`${c}: the audit loader reports what the writer writes`, async () => {
      const { metrics } = await seededIncome(c, "1991-default");
      for (const m of loadSeededStateMetrics(c, "1991-default")) {
        expect(m.economic.medianIncome?.value).toBe(metrics.get(String(m._id)));
      }
    });

    it(`${c}: keeps the authored regional ratios`, () => {
      const base = new Map(BASE[c].map((m) => [String(m._id), m.economic.medianIncome!.value]));
      const ids = [...base.keys()];
      for (const id of ids.slice(1)) {
        expect(INCOME_1991_REGIONAL[c][id] / INCOME_1991_REGIONAL[c][ids[0]]).toBeCloseTo(
          base.get(id)! / base.get(ids[0])!,
          3
        );
      }
    });

    it(`${c}: 1953 and 1979 seeds are not touched`, async () => {
      for (const preset of ["1953-default", "1979-default"]) {
        const { metrics } = await seededIncome(c, preset);
        const hits = [...metrics].filter(([id, v]) => INCOME_1991_REGIONAL[c][id] === v);
        expect(hits).toHaveLength(0);
      }
    });
  }
});

describe("#3393 era income scoring at the 1991 start", () => {
  const AT_ANCHOR = ((1 - 0.45) / (1.25 - 0.45)) * 100;

  for (const c of WEST) {
    it(`${c}: start anchor is the derived median; regions leave the 0/100 pin`, () => {
      expect(getStartingIncomeAnchor(c, 1991)).toBe(Math.round(nationalHouseholdMedian1991(c)));
      expect(score(c, nationalHouseholdMedian1991(c))).toBeCloseTo(AT_ANCHOR, 1);
      const scores = Object.values(INCOME_1991_REGIONAL[c]).map((v) => score(c, v));
      // Most regions score strictly inside the band. An authored region above
      // 1.25x the national mean (FR_IDF; ES_MAD, ES_CAT, ES_PVB; IT_NW) stays at
      // the top edge: that is the authored regional shape, not a unit error.
      const inside = scores.filter((s) => s > 0 && s < 100).length;
      expect(inside).toBeGreaterThanOrEqual(Math.ceil(scores.length / 2));
      expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(25);
      // Before: the ~1979 bundle against the flat 1953 anchor pins every region
      // at one edge.
      const before = BASE[c].map((m) =>
        scoreMetric(
          "medianIncome",
          m.economic.medianIncome!.value,
          c,
          "1991-default",
          1991,
          1,
          1953
        )
      );
      expect(new Set(before).size).toBe(1);
      expect([0, 100]).toContain(before[0]);
    });

    it(`${c}: an income gain or loss moves the score both ways`, () => {
      const m = nationalHouseholdMedian1991(c);
      expect(score(c, m * 1.1, 1993)).toBeGreaterThan(score(c, m));
      expect(score(c, m * 0.9, 1993)).toBeLessThan(score(c, m));
    });
  }
});

describe("#3393 first medianIncome engine updates", { timeout: 60_000 }, () => {
  for (const c of WEST) {
    it(`${c}: holds the seed on turn one and grows it on turn two`, async () => {
      const { metrics } = await seededIncome(c, "1991-default");
      const seedCurrent = {
        "economic.productivityGrowth": 1.5,
        "economic.unemploymentRate": 6,
      };
      const after = new Map<string, number>();
      for (const [id, seeded] of metrics) {
        expect(seeded).toBeLessThanOrEqual(medianIncomeNode.bounds[1]);
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
        // productivity 1.5 plus labour tightness (5 - 6) x 0.3 = 1.2 %/yr.
        const grown = t1.value * (1 + 1.2 / 100 / TURNS_PER_YEAR);
        expect(Math.abs(t2.value - grown)).toBeLessThanOrEqual(Math.max(1, grown * 1e-6));
        after.set(id, t2.value);
      }
      const national = score(c, popWeighted(c, after));
      expect(national).toBeGreaterThan(60);
      expect(national).toBeLessThan(80);
    });
  }
});

describe("#3393 other start years keep their anchors", () => {
  for (const c of WEST) {
    it(`${c}: 1953, 1979, 1999 and 2007 starts read the unchanged 1953 point`, () => {
      for (const start of [1953, 1979, 1999, 2007]) {
        expect(getIncomeAnchor(c, start)).toBe(ANCHOR_1953[c]);
        expect(getStartingIncomeAnchor(c, start)).toBe(ANCHOR_1953[c]);
        const band = getMetricThreshold("medianIncome", c, undefined, start + 5, 1.2, start)!;
        expect(band.best).toBeCloseTo(ANCHOR_1953[c] * 1.25 * 1.2, 4);
      }
    });

    it(`${c}: flag-off legacy scoring ignores the start vintage`, () => {
      expect(getMetricThreshold("medianIncome", c, "1991-default", null, null, null)).toEqual(
        getMetricThreshold("medianIncome", c, "1991-default", null, null, 1991)
      );
    });
  }
});
