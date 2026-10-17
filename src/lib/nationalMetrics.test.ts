import { describe, it, expect, vi } from "vitest";
import { computeNationalMetrics } from "./nationalMetrics";
import {
  aggregateNationalLabourDemand,
  aggregateNationalLabourTightness,
  aggregateNationalMetricValue,
} from "./nationalMetrics/rules";
import type { Db } from "mongodb";

function makeDb(states: unknown[], regionMetrics: unknown[], federalBudgets: unknown[] = []) {
  const updateOne = vi.fn().mockResolvedValue({});
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "states") {
        return { find: () => ({ toArray: async () => states }) };
      }
      // The rollup reads one store. Fixtures keep their legacy shape because
      // that IS the macro doc's shape for the categories this aggregates.
      if (name === "macroMetrics") {
        return {
          find: () => ({ toArray: async () => regionMetrics }),
          updateOne,
          bulkWrite: async (
            ops: Array<{ updateOne: { filter: unknown; update: unknown; upsert?: boolean } }>
          ) => {
            for (const { updateOne: operation } of ops) {
              updateOne(operation.filter, operation.update, { upsert: operation.upsert });
            }
            return { ok: 1 };
          },
        };
      }
      if (name === "corporateSectors") {
        return { find: () => ({ toArray: async () => [] }) };
      }
      if (name === "federalBudget") {
        return { find: () => ({ toArray: async () => federalBudgets }) };
      }
      if (name === "gameState") {
        // flag-off world: the era income-band block is skipped entirely.
        return { findOne: async () => null, updateOne };
      }
      return {};
    }),
    _updateOne: updateOne, // expose for assertions
  };
  return db;
}

// ── Basic population-weighted aggregation ────────────────────────────────────

describe("computeNationalMetrics", () => {
  it("writes population-weighted average for US states into 'federal' doc", async () => {
    const states = [
      { _id: "TX", countryId: "US", population: 30_000_000 },
      { _id: "NY", countryId: "US", population: 20_000_000 },
    ];
    const metrics = [
      { _id: "TX", economic: { unemploymentRate: { value: 5.0 } } },
      { _id: "NY", economic: { unemploymentRate: { value: 3.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // Weighted avg: (5.0*30M + 3.0*20M) / 50M = (150M + 60M) / 50M = 4.2
    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "economic.unemploymentRate": { value: 4.2 },
        }),
      }),
      { upsert: true }
    );
  });

  it("does not include existing national docs in the state average", async () => {
    const states = [{ _id: "TX", countryId: "US", population: 10_000_000 }];
    const metrics = [
      { _id: "TX", economic: { unemploymentRate: { value: 5.0 } } },
      // Simulate stale national doc in collection — must be excluded
      { _id: "federal", economic: { unemploymentRate: { value: 99.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "economic.unemploymentRate": { value: 5.0 },
        }),
      }),
      { upsert: true }
    );
  });

  it("skips countries with no states", async () => {
    const states: unknown[] = []; // no states
    const metrics: unknown[] = [];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    expect(db._updateOne).not.toHaveBeenCalled();
  });

  it("writes UK national doc for UK regions", async () => {
    const states = [
      { _id: "ENG", countryId: "UK", population: 56_000_000 },
      { _id: "SCO", countryId: "UK", population: 5_500_000 },
    ];
    const metrics = [
      { _id: "ENG", economic: { unemploymentRate: { value: 4.0 } } },
      { _id: "SCO", economic: { unemploymentRate: { value: 3.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // Weighted: (4.0*56M + 3.0*5.5M) / 61.5M = (224M + 16.5M) / 61.5M ≈ 3.911
    expect(db._updateOne).toHaveBeenCalledWith({ _id: "uk_national" }, expect.anything(), {
      upsert: true,
    });
  });

  it("syncs national budget balance and debt-to-GDP from the federal budget (non-playable)", async () => {
    // SP5: the governance mirrors are POLITICAL paths — written for
    // non-playables only (playable political stays demolished), so the sync
    // is exercised on a JP fixture.
    const states = [{ _id: "TOK", countryId: "JP", population: 10_000_000, gdp: 1_000_000 }];
    const metrics = [{ _id: "TOK", economic: { unemploymentRate: { value: 5.0 } } }];
    const federalBudgets = [
      {
        _id: "jp_national",
        countryId: "JP",
        surplus: -200,
        gdp: 10_000,
        debtToGdpRatio: 0.87,
        revenue: { total: 1000 },
        spending: { total: 1200 },
      },
    ];

    const db = makeDb(states, metrics, federalBudgets);
    await computeNationalMetrics(db as unknown as Db);

    // SP5: national writes split across the two stores — merge every $set.
    const setOps = Object.assign(
      {},
      ...db._updateOne.mock.calls.map((c: unknown[]) => (c[1] as { $set: object }).$set)
    ) as Record<string, { value: number }>;
    expect(setOps["governance.budgetBalance"]).toEqual({ value: -2 });
    expect(setOps["governance.debtToGdp"]).toEqual({ value: 87 });
  });
});

// ── GDP-weighted aggregation for gdpGrowth ───────────────────────────────────

describe("GDP-weighted aggregation for gdpGrowth", () => {
  it("weights gdpGrowth by state GDP, not population", async () => {
    // TX: large GDP, small pop, low gdpGrowth
    // NY: small GDP, large pop, high gdpGrowth
    // Population-weighted would favour NY's high growth.
    // GDP-weighted should favour TX's large GDP.
    const states = [
      { _id: "TX", countryId: "US", population: 1_000_000, gdp: 9_000_000 },
      { _id: "NY", countryId: "US", population: 9_000_000, gdp: 1_000_000 },
    ];
    const metrics = [
      { _id: "TX", economic: { gdpGrowth: { value: 1.0 } } },
      { _id: "NY", economic: { gdpGrowth: { value: 5.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // GDP-weighted: (1.0 * 9M + 5.0 * 1M) / 10M = 14M / 10M = 1.4
    // Population-weighted would be: (1.0 * 1M + 5.0 * 9M) / 10M = 46/10 = 4.6
    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    expect(setOps["economic.gdpGrowth"].value).toBeCloseTo(1.4, 2);
  });

  it("excludes state from gdpGrowth calc when gdp is 0 or missing", async () => {
    // TX has gdp=0 — should not influence the national average
    const states = [
      { _id: "TX", countryId: "US", population: 10_000_000, gdp: 0 },
      { _id: "NY", countryId: "US", population: 10_000_000, gdp: 5_000_000 },
    ];
    const metrics = [
      { _id: "TX", economic: { gdpGrowth: { value: 10.0 } } }, // high growth, but no gdp weight
      { _id: "NY", economic: { gdpGrowth: { value: 2.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    // TX's 10% growth should be excluded (weight=0), result should be NY's 2%
    expect(setOps["economic.gdpGrowth"].value).toBeCloseTo(2.0, 2);
  });

  it("omits gdpGrowth from $set entirely when all states have gdp=0", async () => {
    // All states have gdp=0, so totalWeight stays 0 for gdpGrowth.
    // The key must not appear in setOps — it also means the whole setOps will be empty
    // (since gdpGrowth is the only metric here), so updateOne is never called.
    const states = [
      { _id: "TX", countryId: "US", population: 10_000_000, gdp: 0 },
      { _id: "NY", countryId: "US", population: 10_000_000, gdp: 0 },
    ];
    const metrics = [
      { _id: "TX", economic: { gdpGrowth: { value: 3.0 } } },
      { _id: "NY", economic: { gdpGrowth: { value: 3.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // setOps is empty (gdpGrowth skipped due to weight=0) → updateOne never called
    expect(db._updateOne).not.toHaveBeenCalled();
  });
});

// ── Multi-metric and multi-category aggregation ──────────────────────────────

describe("multi-metric and multi-category aggregation", () => {
  it("aggregates multiple metrics from the same category in one pass", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 40_000_000 },
      { _id: "TX", countryId: "US", population: 30_000_000 },
    ];
    const metrics = [
      {
        _id: "CA",
        economic: {
          unemploymentRate: { value: 4.0 },
          medianIncome: { value: 60_000 },
        },
      },
      {
        _id: "TX",
        economic: {
          unemploymentRate: { value: 6.0 },
          medianIncome: { value: 50_000 },
        },
      },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;

    // unemploymentRate: (4*40M + 6*30M) / 70M = (160M + 180M) / 70M ≈ 4.857
    expect(setOps["economic.unemploymentRate"].value).toBeCloseTo(4.857, 2);

    // medianIncome: (60000*40M + 50000*30M) / 70M = (2.4T + 1.5T) / 70M ≈ 55714
    expect(setOps["economic.medianIncome"].value).toBeCloseTo(55714.286, 0);
  });

  it("aggregates ONLY the macro half for a board country", async () => {
    const states = [
      { _id: "KAN", countryId: "JP", population: 40_000_000 },
      { _id: "KNS", countryId: "JP", population: 30_000_000 },
    ];
    const metrics = [
      {
        _id: "KAN",
        economic: { unemploymentRate: { value: 4.0 } },
        education: { literacyRate: { value: 95.0 } },
      },
      {
        _id: "KNS",
        economic: { unemploymentRate: { value: 6.0 } },
        education: { literacyRate: { value: 85.0 } },
      },
    ];
    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);
    const setOps = Object.assign(
      {},
      ...db._updateOne.mock.calls.map((c: unknown[]) => (c[1] as { $set: object }).$set)
    ) as Record<string, { value: number }>;
    expect(setOps["economic.unemploymentRate"]).toBeDefined();
    // The political half belongs to the board now.
    expect(setOps["education.literacyRate"]).toBeUndefined();
  });
});

// ── Rounding ─────────────────────────────────────────────────────────────────

describe("rounding", () => {
  it("rounds result to 3 decimal places", async () => {
    // Deliberately create a repeating decimal: 1/3 ≈ 0.333...
    const states = [
      { _id: "A", countryId: "US", population: 1 },
      { _id: "B", countryId: "US", population: 1 },
      { _id: "C", countryId: "US", population: 1 },
    ];
    const metrics = [
      { _id: "A", economic: { unemploymentRate: { value: 1.0 } } },
      { _id: "B", economic: { unemploymentRate: { value: 0.0 } } },
      { _id: "C", economic: { unemploymentRate: { value: 0.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    // 1/3 = 0.333... → should round to 0.333
    expect(setOps["economic.unemploymentRate"].value).toBe(0.333);
  });

  it("does not produce more than 3 decimal places of precision", async () => {
    const states = [
      { _id: "A", countryId: "US", population: 3 },
      { _id: "B", countryId: "US", population: 7 },
    ];
    const metrics = [
      { _id: "A", economic: { unemploymentRate: { value: 1.0 } } },
      { _id: "B", economic: { unemploymentRate: { value: 2.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    const result = setOps["economic.unemploymentRate"].value;

    // Result should have at most 3 decimal places
    const decimalPlaces = (result.toString().split(".")[1] ?? "").length;
    expect(decimalPlaces).toBeLessThanOrEqual(3);
  });
});

// ── Missing / partial data handling ──────────────────────────────────────────

describe("missing and partial data handling", () => {
  it("skips a state missing a metric field rather than treating it as 0", async () => {
    // CA has the metric, TX does not — TX should not drag the average down to zero
    const states = [
      { _id: "CA", countryId: "US", population: 10_000_000 },
      { _id: "TX", countryId: "US", population: 10_000_000 },
    ];
    const metrics = [
      { _id: "CA", economic: { unemploymentRate: { value: 4.0 } } },
      // TX has no unemploymentRate — should be excluded from the calculation
      { _id: "TX", economic: {} },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    // Result should be CA's 4.0, not (4.0 + 0) / 2 = 2.0
    expect(setOps["economic.unemploymentRate"].value).toBe(4.0);
  });

  it("skips a state with no metrics document entirely", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 10_000_000 },
      { _id: "TX", countryId: "US", population: 10_000_000 },
    ];
    const metrics = [
      // Only CA has a metrics doc — TX is absent
      { _id: "CA", economic: { unemploymentRate: { value: 6.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;
    // Only CA contributes, so national = 6.0
    expect(setOps["economic.unemploymentRate"].value).toBe(6.0);
  });

  it("skips country when total population is 0", async () => {
    const states = [
      { _id: "TX", countryId: "US", population: 0 },
      { _id: "CA", countryId: "US", population: 0 },
    ];
    const metrics = [
      { _id: "TX", economic: { unemploymentRate: { value: 5.0 } } },
      { _id: "CA", economic: { unemploymentRate: { value: 3.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // totalPop = 0 → skip country entirely → no upsert
    expect(db._updateOne).not.toHaveBeenCalled();
  });

  it("skips country when states list is empty after filtering by countryId", async () => {
    // Only UK states in DB, no US states
    const states = [{ _id: "ENG", countryId: "UK", population: 56_000_000 }];
    const metrics = [{ _id: "ENG", economic: { unemploymentRate: { value: 4.0 } } }];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // Only uk_national should be written, not federal
    expect(db._updateOne).toHaveBeenCalledTimes(1);
    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "uk_national" },
      expect.anything(),
      expect.anything()
    );
    expect(db._updateOne).not.toHaveBeenCalledWith(
      { _id: "federal" },
      expect.anything(),
      expect.anything()
    );
  });

  it("excludes uk_national from UK state averages (same as federal exclusion)", async () => {
    const states = [{ _id: "ENG", countryId: "UK", population: 56_000_000 }];
    const metrics = [
      { _id: "ENG", economic: { unemploymentRate: { value: 4.0 } } },
      // Stale uk_national doc — must not be included in state-level average
      { _id: "uk_national", economic: { unemploymentRate: { value: 99.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "uk_national" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "economic.unemploymentRate": { value: 4.0 },
        }),
      }),
      { upsert: true }
    );
  });
});

// ── US and UK computed in the same call ──────────────────────────────────────

describe("multi-country in one pass", () => {
  it("computes both US federal and UK national docs in a single call", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 40_000_000 },
      { _id: "TX", countryId: "US", population: 30_000_000 },
      { _id: "ENG", countryId: "UK", population: 56_000_000 },
      { _id: "SCO", countryId: "UK", population: 5_500_000 },
    ];
    const metrics = [
      { _id: "CA", economic: { unemploymentRate: { value: 4.0 } } },
      { _id: "TX", economic: { unemploymentRate: { value: 6.0 } } },
      { _id: "ENG", economic: { unemploymentRate: { value: 3.5 } } },
      { _id: "SCO", economic: { unemploymentRate: { value: 4.5 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    // Should call updateOne twice — once for federal, once for uk_national
    expect(db._updateOne).toHaveBeenCalledTimes(2);

    const calls = db._updateOne.mock.calls as [
      { _id: string },
      { $set: Record<string, { value: number }> },
      unknown,
    ][];
    const usCall = calls.find((c) => c[0]._id === "federal");
    const ukCall = calls.find((c) => c[0]._id === "uk_national");

    expect(usCall).toBeDefined();
    expect(ukCall).toBeDefined();

    // US: (4*40M + 6*30M) / 70M = 340M/70M ≈ 4.857
    expect(usCall![1].$set["economic.unemploymentRate"].value).toBeCloseTo(4.857, 2);

    // UK: (3.5*56M + 4.5*5.5M) / 61.5M = (196M + 24.75M) / 61.5M ≈ 3.589
    expect(ukCall![1].$set["economic.unemploymentRate"].value).toBeCloseTo(3.589, 2);
  });

  it("US and UK national docs do not contaminate each other", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 40_000_000 },
      { _id: "ENG", countryId: "UK", population: 56_000_000 },
    ];
    const metrics = [
      // US state has high unemployment, UK state has low
      { _id: "CA", economic: { unemploymentRate: { value: 8.0 } } },
      { _id: "ENG", economic: { unemploymentRate: { value: 2.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const calls = db._updateOne.mock.calls as [
      { _id: string },
      { $set: Record<string, { value: number }> },
      unknown,
    ][];
    const usCall = calls.find((c) => c[0]._id === "federal");
    const ukCall = calls.find((c) => c[0]._id === "uk_national");

    // US should only reflect CA's 8.0
    expect(usCall![1].$set["economic.unemploymentRate"].value).toBe(8.0);
    // UK should only reflect ENG's 2.0
    expect(ukCall![1].$set["economic.unemploymentRate"].value).toBe(2.0);
  });
});

// ── Population-weighted vs GDP-weighted distinction ──────────────────────────

describe("population vs GDP weighting distinction", () => {
  it("uses labor-force weights for unemployment when regional labor force is available", async () => {
    // CA: big GDP, small population, high unemployment
    // TX: small GDP, big population, low unemployment
    // Population-weighted → TX dominates → result near 2%
    // GDP-weighted → CA dominates → result near 8%
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000, gdp: 9_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000, gdp: 1_000_000 },
    ];
    const metrics = [
      {
        _id: "CA",
        economic: { unemploymentRate: { value: 8.0 }, laborForce: { value: 900_000 } },
      },
      {
        _id: "TX",
        economic: { unemploymentRate: { value: 2.0 }, laborForce: { value: 100_000 } },
      },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;

    // Labor-force-weighted: (8*900k + 2*100k) / 1M = 7.4
    expect(setOps["economic.unemploymentRate"].value).toBeCloseTo(7.4, 2);
  });

  it("sums regional labor-force headcounts instead of averaging them", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000 },
    ];
    const metrics = [
      { _id: "CA", economic: { laborForce: { value: 700_000 } } },
      { _id: "TX", economic: { laborForce: { value: 5_300_000 } } },
    ];
    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);
    const setOps = db._updateOne.mock.calls[0][1].$set as Record<string, { value: number }>;
    expect(setOps["economic.laborForce"].value).toBe(6_000_000);
  });

  it("sums current-turn corporate demand and derives tightness from national counts", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000 },
    ];
    const metrics = [
      {
        _id: "CA",
        economic: {
          labourDemandTurn: 22,
          labourDemand: { value: 100 },
          labourTightness: { value: 0.1 },
          laborForce: { value: 1_000 },
        },
      },
      {
        _id: "TX",
        economic: {
          labourDemandTurn: 22,
          labourDemand: { value: 500 },
          labourTightness: { value: 0.05 },
          laborForce: { value: 9_000 },
        },
      },
    ];
    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db, 22);
    const setOps = db._updateOne.mock.calls[0][1].$set as Record<string, { value: number }>;

    expect(setOps["economic.labourDemand"].value).toBe(600);
    expect(setOps["economic.labourTightness"].value).toBe(0.06);
    expect(db._updateOne.mock.calls[0][1].$set["economic.labourDemandTurn"]).toBe(22);
  });

  it("clears national labor telemetry when any region lacks a current-turn demand snapshot", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000 },
    ];
    const metrics = [
      {
        _id: "CA",
        economic: {
          labourDemandTurn: 22,
          labourDemand: { value: 100 },
          labourTightness: { value: 0.1 },
          laborForce: { value: 1_000 },
        },
      },
      {
        _id: "TX",
        economic: {
          labourDemandTurn: 21,
          labourDemand: { value: 500 },
          labourTightness: { value: 0.05 },
          laborForce: { value: 9_000 },
        },
      },
    ];
    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db, 22);
    const update = db._updateOne.mock.calls[0][1];

    expect(update.$unset).toEqual({
      "economic.labourDemand": "",
      "economic.labourDemandTurn": "",
      "economic.labourTightness": "",
    });
    expect(update.$set["economic.labourDemand"]).toBeUndefined();
    expect(update.$set["economic.labourTightness"]).toBeUndefined();
  });

  it("clears stale national labor telemetry even when no other metric can be rolled up", async () => {
    const states = [{ _id: "CA", countryId: "US", population: 1_000_000 }];
    const db = makeDb(states, []);

    await computeNationalMetrics(db as unknown as Db, 22);

    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "federal" },
      expect.objectContaining({
        $unset: {
          "economic.labourDemand": "",
          "economic.labourDemandTurn": "",
          "economic.labourTightness": "",
        },
      }),
      { upsert: true }
    );
  });

  it("falls back to population weights for legacy unemployment data with no labor-force values", () => {
    expect(
      aggregateNationalMetricValue("economic", "unemploymentRate", [
        { value: 8, population: 1, gdp: 9 },
        { value: 2, population: 9, gdp: 1 },
      ])
    ).toBe(2.6);
  });

  it("falls back to population weighting when any unemployment labor-force weight is missing or zero", () => {
    expect(
      aggregateNationalMetricValue("economic", "unemploymentRate", [
        { value: 8, population: 1, gdp: 9, laborForce: 900 },
        { value: 2, population: 9, gdp: 1, laborForce: 100 },
        { value: 99, population: 100, gdp: 100, laborForce: 0 },
        { value: 77, population: 100, gdp: 100 },
      ])
    ).toBeCloseTo(83.933, 3);
  });

  it("does not write a partial national labor-force sum", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000 },
    ];
    const metrics = [
      {
        _id: "CA",
        economic: { laborForce: { value: 700_000 }, unemploymentRate: { value: 5 } },
      },
      { _id: "TX", economic: { unemploymentRate: { value: 4 } } },
    ];
    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);
    const setOps = db._updateOne.mock.calls[0][1].$set as Record<string, { value: number }>;
    expect(setOps["economic.laborForce"]).toBeUndefined();
  });

  it("omits unemployment if no population fallback weight is usable", () => {
    expect(
      aggregateNationalMetricValue("economic", "unemploymentRate", [
        { value: 8, population: 0, gdp: 1, laborForce: 0 },
      ])
    ).toBeUndefined();
  });

  it("gdpGrowth uses GDP weight — heavier-economy state dominates", async () => {
    // CA: small population, large GDP, high growth
    // TX: large population, small GDP, low growth
    // Population-weighted → TX drags it down
    // GDP-weighted → CA lifts it up
    const states = [
      { _id: "CA", countryId: "US", population: 1_000_000, gdp: 9_000_000 },
      { _id: "TX", countryId: "US", population: 9_000_000, gdp: 1_000_000 },
    ];
    const metrics = [
      { _id: "CA", economic: { gdpGrowth: { value: 5.0 } } },
      { _id: "TX", economic: { gdpGrowth: { value: 1.0 } } },
    ];

    const db = makeDb(states, metrics);
    await computeNationalMetrics(db as unknown as Db);

    const call = db._updateOne.mock.calls[0];
    const setOps = call[1].$set as Record<string, { value: number }>;

    // GDP-weighted: (5*9M + 1*1M) / 10M = 46M/10M = 4.6
    // Population-weighted would be: (5*1M + 1*9M) / 10M = 1.4
    expect(setOps["economic.gdpGrowth"].value).toBeCloseTo(4.6, 2);
  });
});

describe("national corporate labour aggregation rules", () => {
  it("sums only complete current-turn demand", () => {
    expect(
      aggregateNationalLabourDemand(
        [
          { demand: 100, laborForce: 1_000, demandTurn: 4 },
          { demand: 500, laborForce: 9_000, demandTurn: 4 },
        ],
        4
      )
    ).toBe(600);
    expect(
      aggregateNationalLabourDemand(
        [
          { demand: 100, demandTurn: 4 },
          { demand: 500, demandTurn: 3 },
        ],
        4
      )
    ).toBeUndefined();
  });

  it("computes national tightness as total demand over total labor force", () => {
    expect(
      aggregateNationalLabourTightness(
        [
          { demand: 100, laborForce: 1_000, demandTurn: 4 },
          { demand: 500, laborForce: 9_000, demandTurn: 4 },
        ],
        4
      )
    ).toBe(0.06);
    expect(
      aggregateNationalLabourTightness(
        [
          { demand: 100, laborForce: 1_000, demandTurn: 4 },
          { demand: 500, demandTurn: 4 },
        ],
        4
      )
    ).toBeUndefined();
  });
});
