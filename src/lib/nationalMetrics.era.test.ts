import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { computeNationalMetrics } from "./nationalMetrics";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";

/**
 * Era income-band index (metric era catalog):
 *   index = current GDP/capita ÷ per-country baseline;
 *   baseline self-heals at first flag-on by back-solving from the realized
 *   income norm vs the era income anchor (continuity: no score jump at enable).
 *
 * UK fixture: 2 states, GDP in local-currency MILLIONS (aggregateNationalGdp
 * multiplies by 1e6 before dividing by population).
 */

const UK_STATES = [
  { _id: "LON", countryId: "UK", population: 10_000_000, gdp: 0.6 * 1_000_000 },
  { _id: "SCO", countryId: "UK", population: 10_000_000, gdp: 0.4 * 1_000_000 },
];
// GDP/capita = (1_000_000 millions × 1e6) / 20_000_000 = 50_000

const ukMetrics = (income: number) => [
  { _id: "LON", countryId: "UK", economic: { medianIncome: { value: income } } },
  { _id: "SCO", countryId: "UK", economic: { medianIncome: { value: income } } },
];

function wireDb(
  db: MockDb,
  opts: {
    gameState: Record<string, unknown> | null;
    income: number;
  }
) {
  const states = db.collection("states");
  states.find.mockReturnValue({ toArray: () => Promise.resolve(UK_STATES) });
  const metrics = db.collection("macroMetrics");
  metrics.find.mockReturnValue({ toArray: () => Promise.resolve(ukMetrics(opts.income)) });
  const budgets = db.collection("federalBudget");
  budgets.find.mockReturnValue({ toArray: () => Promise.resolve([]) });
  const gameState = db.collection("gameState");
  gameState.findOne.mockResolvedValue(opts.gameState);
}

describe("computeNationalMetrics — era income-band index", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("flag off ⇒ no gameState write, no index", async () => {
    wireDb(db, { gameState: { _id: "current" }, income: 15_500 });
    await computeNationalMetrics(db as unknown as Db);
    const calls = db.collectionMocks["gameState"]!.updateOne.mock.calls;
    expect(calls.length).toBe(0);
  });

  it("self-heals the baseline at first flag-on: band centers on realized income", async () => {
    // 1991-start UK world: realized income 15_500 == anchor(UK, 1991) ⇒
    // baseline = gdpPc / 1 = 50_000 ⇒ index = 1.
    wireDb(db, {
      gameState: { _id: "current", eraSystemEnabled: true, startingYear: 1991 },
      income: getIncomeAnchor("UK", 1991)!,
    });
    await computeNationalMetrics(db as unknown as Db);
    const call = db.collectionMocks["gameState"]!.updateOne.mock.calls.at(-1)!;
    const set = call[1].$set as {
      incomeBandIndexByCountry: Record<string, number>;
      eraGdpPerCapitaBaseline: Record<string, number>;
    };
    expect(set.eraGdpPerCapitaBaseline.UK).toBeCloseTo(50_000, 0);
    expect(set.incomeBandIndexByCountry.UK).toBeCloseTo(1, 4);
  });

  it("self-heal continuity on a GROWN world: index reflects income growth, not 1", async () => {
    // Realized income = 2× the anchor (world grew since 1991 seed). Back-solve:
    // baseline = 50_000 / 2 = 25_000 ⇒ index = 2 ⇒ band = anchor×shape×2 —
    // centered on the income players actually have (no jump at enable).
    const anchor = getIncomeAnchor("UK", 1991)!;
    wireDb(db, {
      gameState: { _id: "current", eraSystemEnabled: true, startingYear: 1991 },
      income: anchor * 2,
    });
    await computeNationalMetrics(db as unknown as Db);
    const call = db.collectionMocks["gameState"]!.updateOne.mock.calls.at(-1)!;
    const set = call[1].$set as { incomeBandIndexByCountry: Record<string, number> };
    expect(set.incomeBandIndexByCountry.UK).toBeCloseTo(2, 3);
  });

  it("existing baseline is NOT re-healed; index tracks GDP against it", async () => {
    wireDb(db, {
      gameState: {
        _id: "current",
        eraSystemEnabled: true,
        startingYear: 1991,
        eraGdpPerCapitaBaseline: { UK: 40_000 },
      },
      income: 15_500,
    });
    await computeNationalMetrics(db as unknown as Db);
    const call = db.collectionMocks["gameState"]!.updateOne.mock.calls.at(-1)!;
    const set = call[1].$set as {
      incomeBandIndexByCountry: Record<string, number>;
      eraGdpPerCapitaBaseline?: Record<string, number>;
    };
    expect(set.incomeBandIndexByCountry.UK).toBeCloseTo(50_000 / 40_000, 4);
    expect(set.eraGdpPerCapitaBaseline).toBeUndefined(); // unchanged ⇒ not re-written
  });
});
