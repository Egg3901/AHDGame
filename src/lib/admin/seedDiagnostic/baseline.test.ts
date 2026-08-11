import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  captureSeedBaseline,
  loadSeedBaseline,
  reconstructMetricsFromExpectations,
  BASELINE_ID,
} from "./baseline";
import { buildSeedExpectations } from "./expectations";

type CollMock = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  replaceOne: ReturnType<typeof vi.fn>;
};

function cursorOf(rows: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeDb(opts: {
  gameState?: Record<string, unknown> | null;
  budgets?: unknown[];
  exchangeRates?: unknown[];
  centralBanks?: unknown[];
  unownedSectors?: unknown[];
  corporations?: unknown[];
  commodityPrices?: unknown[];
  baseline?: Record<string, unknown> | null;
}): { db: Db; collections: Record<string, CollMock> } {
  const collections: Record<string, CollMock> = {};

  const getColl = (name: string): CollMock => {
    if (collections[name]) return collections[name]!;
    const coll: CollMock = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(cursorOf([])),
      replaceOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    collections[name] = coll;
    return coll;
  };

  getColl("gameState").findOne.mockResolvedValue(opts.gameState ?? null);
  getColl("federalBudget").find.mockReturnValue(cursorOf(opts.budgets ?? []));
  getColl("exchangeRates").find.mockReturnValue(cursorOf(opts.exchangeRates ?? []));
  getColl("centralBanks").find.mockReturnValue(cursorOf(opts.centralBanks ?? []));
  getColl("unownedSectors").find.mockReturnValue(cursorOf(opts.unownedSectors ?? []));
  getColl("corporations").find.mockReturnValue(cursorOf(opts.corporations ?? []));
  getColl("commodityPrices").find.mockReturnValue(cursorOf(opts.commodityPrices ?? []));
  getColl("seedDiagnosticBaselines").findOne.mockResolvedValue(opts.baseline ?? null);

  const db = {
    collection: vi.fn().mockImplementation((name: string) => getColl(name)),
  } as unknown as Db;

  return { db, collections };
}

describe("reconstructMetricsFromExpectations", () => {
  it("builds dotted keys matching drift check ids from seed files", () => {
    const expectMap = buildSeedExpectations("2019-default");
    const metrics = reconstructMetricsFromExpectations(expectMap);

    expect(metrics["budget.US.gdp"]).toBeGreaterThan(0);
    expect(metrics["budget.US.population"]).toBeGreaterThan(0);
    expect(metrics["budget.US.debt.principal"]).toBeGreaterThan(0);
    expect(metrics["budget.US.treasuryBalance"]).toBe(-metrics["budget.US.debt.principal"]!);
    expect(metrics["forex.US.rate"]).toBe(1);
    expect(metrics["centralBank.US.primeRate"]).toBeGreaterThan(0);
  });
});

describe("captureSeedBaseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a singleton baseline with dotted metric keys", async () => {
    const { db, collections } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        currentTurn: 1,
        preIterationTurns: 0,
      },
      budgets: [
        {
          countryId: "US",
          gdp: 27_000_000_000_000,
          population: 333_000_000,
          treasuryBalance: -30_000_000_000_000,
          debt: { principal: 30_000_000_000_000, interestRate: 0.03 },
        },
      ],
      exchangeRates: [{ countryId: "US", rate: 1, baseRate: 1 }],
      centralBanks: [
        {
          _id: getBankId("US"),
          countryId: "US",
          primeRate: 5.25,
          inflationHistory: [{ turn: 1, rate: 2.1 }],
        },
      ],
      unownedSectors: [{ countryId: "US", revenue: 1_000_000 }],
      corporations: [{ countryId: "US", revenue: 500_000 }],
      commodityPrices: [
        { commodity: "oil", basePrice: 100, globalPrice: 110 },
        { commodity: "steel", basePrice: 50, globalPrice: 50 },
      ],
    });

    const baseline = await captureSeedBaseline(db, {
      now: new Date("2026-01-01T00:00:00Z"),
    });

    expect(baseline._id).toBe(BASELINE_ID);
    expect(baseline.preset).toBe("2019-default");
    expect(baseline.turn).toBe(1);
    expect(baseline.metrics["budget.US.gdp"]).toBe(27_000_000_000_000);
    expect(baseline.metrics["budget.US.population"]).toBe(333_000_000);
    expect(baseline.metrics["budget.US.debt.principal"]).toBe(30_000_000_000_000);
    expect(baseline.metrics["budget.US.debt.interestRate"]).toBe(0.03);
    expect(baseline.metrics["budget.US.treasuryBalance"]).toBe(-30_000_000_000_000);
    expect(baseline.metrics["forex.US.rate"]).toBe(1);
    expect(baseline.metrics["centralBank.US.primeRate"]).toBe(5.25);
    expect(baseline.metrics["centralBank.US.inflation"]).toBe(2.1);
    expect(baseline.metrics["sectors.US.aggregate"]).toBe(1_500_000);
    expect(baseline.metrics["commodity.globalPriceIndex"]).toBeCloseTo(1.05, 10);

    expect(collections.seedDiagnosticBaselines!.replaceOne).toHaveBeenCalledWith(
      { _id: BASELINE_ID },
      expect.objectContaining({ _id: BASELINE_ID, preset: "2019-default" }),
      { upsert: true }
    );
  });

  it("loadSeedBaseline returns null when missing", async () => {
    const { db } = makeDb({ baseline: null });
    expect(await loadSeedBaseline(db)).toBeNull();
  });
});
