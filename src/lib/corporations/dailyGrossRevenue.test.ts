import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("basic"),
  marketAtLeast: () => false,
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

// USD and JPY both float against the anchor. At 1953 rates a yen is worth a
// tiny fraction of a dollar, which is exactly what the old bare sum ignored.
const USD_PER_ANCHOR = 1;
const JPY_PER_ANCHOR = 360;

vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return {
    ...actual,
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(
      new Map([
        ["USD", USD_PER_ANCHOR],
        ["JPY", JPY_PER_ANCHOR],
      ])
    ),
  };
});

const corpId = new ObjectId();
const CORP = { _id: corpId, countryId: "US" as const, liquidCurrencyCode: "USD" };

function dbWithSectors(sectors: Record<string, unknown>[]): Db {
  return {
    collection: () => ({
      find: () => ({ toArray: vi.fn().mockResolvedValue(sectors) }),
    }),
  } as unknown as Db;
}

describe("corpDailyGrossRevenueLocal (ticket #1118)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts a foreign sector out of its host currency instead of adding it raw", async () => {
    const { corpDailyGrossRevenueLocal } = await import("./dailyGrossRevenue");
    // The reporter's shape: one large Kansai sector in yen beside US sectors.
    const db = dbWithSectors([
      { revenue: 268_000_000, countryId: "JP", sectorType: "retail" },
      { revenue: 15_000_000, countryId: "US", sectorType: "retail" },
    ]);

    const total = await corpDailyGrossRevenueLocal(db, CORP);

    // 268,000,000 JPY is ~744,444 USD, so the honest total is ~15.74M, not the
    // ~283M a bare sum produced.
    expect(total).toBeGreaterThan(15_700_000);
    expect(total).toBeLessThan(15_800_000);
  });

  it("does not distort a corp whose sectors are all in its own currency", async () => {
    const { corpDailyGrossRevenueLocal } = await import("./dailyGrossRevenue");
    const db = dbWithSectors([
      { revenue: 4_000_000, countryId: "US", sectorType: "retail" },
      { revenue: 1_000_000, countryId: "US", sectorType: "logistics" },
    ]);

    expect(await corpDailyGrossRevenueLocal(db, CORP)).toBeCloseTo(5_000_000, 0);
  });

  it("returns 0 for a corp with no sectors rather than NaN", async () => {
    const { corpDailyGrossRevenueLocal } = await import("./dailyGrossRevenue");
    expect(await corpDailyGrossRevenueLocal(dbWithSectors([]), CORP)).toBe(0);
  });

  it("skips sectors with no revenue without poisoning the total", async () => {
    const { corpDailyGrossRevenueLocal } = await import("./dailyGrossRevenue");
    const db = dbWithSectors([
      { revenue: 0, countryId: "JP", sectorType: "retail" },
      { countryId: "US", sectorType: "retail" },
      { revenue: 2_000_000, countryId: "US", sectorType: "retail" },
    ]);

    expect(await corpDailyGrossRevenueLocal(db, CORP)).toBeCloseTo(2_000_000, 0);
  });
});
