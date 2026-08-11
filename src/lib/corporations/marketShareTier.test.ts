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

describe("fetchSectorMarketSharePercent resolves the tier from the db", () => {
  it("picks the capacity basis under plants with no argument from the caller", async () => {
    // The bug: plantsEnabled defaulted to false and ALL SEVEN call sites omitted
    // it, so buildCapacity (the plants-native growth path) and monopolyTrigger
    // (which decides nationalization) both computed share on legacy revenue.
    const { db, sector } = makeDb("plants");

    const resolved = await fetchSectorMarketSharePercent(db, sector, CORP);
    const forcedLegacy = await fetchSectorMarketSharePercent(db, sector, CORP, false);

    // Revenue basis: 1M of (10M owned + 1M unowned) = 9.09%.
    // Capacity basis: 5000 of (10000 owned + 100 headroom) = 49.5%.
    // The point of the test is that they differ and that the no-argument call
    // lands on the capacity one.
    expect(forcedLegacy).toBeCloseTo(9.09, 1);
    expect(resolved).toBeGreaterThan(40);
  });

  it("stays on the revenue basis below plants", async () => {
    const { db, sector } = makeDb("capital");
    const resolved = await fetchSectorMarketSharePercent(db, sector, CORP);
    expect(resolved).toBeCloseTo(9.09, 1);
  });

  it("treats an absent gameConfig as legacy rather than throwing", async () => {
    const { db, sector } = makeDb(undefined);
    await expect(fetchSectorMarketSharePercent(db, sector, CORP)).resolves.toBeCloseTo(9.09, 1);
  });

  it("still honours an explicit override, for callers that already know", async () => {
    const { db, sector } = makeDb("plants");
    expect(await fetchSectorMarketSharePercent(db, sector, CORP, false)).toBeCloseTo(9.09, 1);
  });
});
