import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporateSector } from "@/lib/db/types/corporation";

// The helper dynamically imports corporationCapital, so the mock has to cover
// every named export it pulls in, not just the FX loader.
vi.mock("@/lib/currency/corporationCapital", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  resolveSectorHostCurrencyCode: () => "USD",
  fxRateForSectorHostFromMap: () => 1,
}));
vi.mock("@/lib/currency/gdpAnchorRate", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadWorldPreset: vi.fn().mockResolvedValue(undefined),
}));

import { fetchSectorMarketSharePercent } from "./marketShare";

const STATE_ID = "TX";
const SECTOR_TYPE: CorporateSector["sectorType"] = "energy";
const SECTOR_ID = new ObjectId();
const COUNTRY_ID: CountryId = "US";

/**
 * Minimal db double. The helper reads states, corporateSectors, unownedSectors
 * and gameConfig; only gameConfig varies between the cases below.
 */
function makeDb(mode: string | undefined) {
  const sector = {
    _id: SECTOR_ID,
    stateId: STATE_ID,
    sectorType: SECTOR_TYPE,
    countryId: COUNTRY_ID,
    revenue: 1_000_000,
    // Capacity deliberately out of proportion to revenue, so the capacity basis
    // and the revenue basis cannot coincidentally agree.
    capitalStock: 5_000,
    strategyId: "standard",
  } as const;
  const sibling = {
    _id: new ObjectId(),
    stateId: STATE_ID,
    sectorType: SECTOR_TYPE,
    countryId: COUNTRY_ID,
    revenue: 9_000_000,
    capitalStock: 5_000,
    strategyId: "standard",
  } as const;
  const collections: Record<string, unknown> = {
    states: {
      findOne: vi.fn().mockResolvedValue({ _id: STATE_ID, gdp: 2_000_000, countryId: "US" }),
    },
    corporateSectors: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([sector, sibling]) }),
    },
    unownedSectors: {
      findOne: vi.fn().mockResolvedValue({
        stateId: STATE_ID,
        sectorType: SECTOR_TYPE,
        revenue: 1_000_000,
        headroomUnits: 100,
      }),
    },
    gameConfig: {
      findOne: vi.fn().mockResolvedValue(mode ? { _id: "default", marketSystemMode: mode } : null),
    },
  };
  return {
    db: { collection: (name: string) => collections[name] } as unknown as Db,
    sector,
  };
}

const CORP = { liquidCurrencyCode: "USD" } as never;

beforeEach(() => vi.clearAllMocks());

describe("fetchSectorMarketSharePercent is revenue-basis in every tier (ticket #1145)", () => {
  // Market share = this sector's revenue over the TOTAL real revenue in the cell.
  // 1M of (1M + 9M sibling) = 10%. The unowned pool (1M) is NOT in the
  // denominator any more, and capacity units never were the basis — so every tier
  // gives the same honest number and the old 9.09% (owned + unowned pool) is gone.
  it("picks revenue share under plants, ignoring the unowned pool and capacity", async () => {
    const { db, sector } = makeDb("plants");
    const resolved = await fetchSectorMarketSharePercent(db, sector, CORP);
    expect(resolved).toBeCloseTo(10, 6);
  });

  it("gives the same revenue share below plants", async () => {
    const { db, sector } = makeDb("capital");
    const resolved = await fetchSectorMarketSharePercent(db, sector, CORP);
    expect(resolved).toBeCloseTo(10, 6);
  });

  it("treats an absent gameConfig as revenue basis rather than throwing", async () => {
    const { db, sector } = makeDb(undefined);
    await expect(fetchSectorMarketSharePercent(db, sector, CORP)).resolves.toBeCloseTo(10, 6);
  });

  it("ignores the vestigial tier override — the basis is revenue regardless", async () => {
    const { db, sector } = makeDb("plants");
    expect(await fetchSectorMarketSharePercent(db, sector, CORP, false)).toBeCloseTo(10, 6);
  });
});
