/**
 * `corporateSectors.revenue` denomination on the SEED/ADMIN spawn path.
 *
 * The field is stored in the sector's HOST-STATE currency; readers normalize it
 * with `readCorpEconomicAnchor` (÷ fx). This path used to write the ₳ figure
 * straight in, so a JP sector (fx ≈ 360) was read back at ~1/360 of its true
 * weight by every ₳-denominated aggregate — tax rollups, GDP weighting, market
 * share denominators, corp valuation. Capital mode hid it (the turn's
 * read → grow → write round-trips and cancels); plants exposes it.
 *
 * The invariant these tests pin: `revenue` is written in local currency, while
 * the ₳ quantity `startingRevenue` — which also drives the capacity grant and
 * the unowned-pool drawdown, both of which are ₳/unit based — is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_SECTOR_STARTING_REVENUE } from "@/lib/constants/corporations";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: "Spawned NPP" }),
}));
vi.mock("@/lib/corporations/tickerSymbol", () => ({
  generateTickerSymbol: vi.fn().mockResolvedValue("SPWN"),
  insertCorporationWithTickerRetry: vi.fn(
    async (
      db: { collection: (name: string) => { insertOne: (doc: unknown) => Promise<unknown> } },
      corpDoc: unknown
    ) => {
      await db.collection("corporations").insertOne(corpDoc);
    }
  ),
}));
vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockResolvedValue(42),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: vi.fn().mockResolvedValue("2019-default"),
  getGdpAnchorRate: vi.fn().mockReturnValue(1),
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/constants/sectorSeedEra", () => ({
  getEraNominalScale: vi.fn().mockReturnValue(1),
  // Modern share base (scale 1), matching getEraNominalScale above.
  getEraFounderShares: vi.fn((shares: number) => shares),
}));
vi.mock("./nppCorpCeoSelection", () => ({
  buildCeoAffiliations: vi.fn().mockReturnValue([]),
  chooseNppCorpCeo: vi.fn().mockReturnValue({ kind: "new", party: null }),
}));
vi.mock("@/lib/admin/seed/seedUnownedSectors", () => ({
  computeUnownedSeedRevenue: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("capital"),
  marketAtLeast: vi.fn().mockReturnValue(false),
}));

const POOL_REVENUE = 40_000_000;
/** ₳ quantity the spawn captures: a quarter of the pool, floored at the starter. */
const CAPTURE_ANCHOR = Math.max(Math.round(POOL_REVENUE * 0.25), DEFAULT_SECTOR_STARTING_REVENUE);
const JPY_RATE = 360;

describe("spawnNppCorporation — sector revenue denomination", () => {
  let db: MockDb;

  function setup(countryId: string, stateId: string, fxRate: number | null) {
    db = createMockDb();
    for (const name of [
      "states",
      "npps",
      "corporations",
      "corporateSectors",
      "unownedSectors",
      "politicalParties",
      "exchangeRates",
    ]) {
      db.collection(name);
      const cursor = {
        toArray: vi.fn().mockResolvedValue([]),
        project: vi.fn(() => cursor),
        sort: vi.fn(() => cursor),
        limit: vi.fn(() => cursor),
      };
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue(cursor);
    }
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: stateId,
      countryId,
      name: stateId,
      gdp: 1_000_000_000,
    });
    db.collectionMocks.unownedSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      stateId,
      countryId,
      sectorType: "manufacturing",
      revenue: POOL_REVENUE,
      headroomUnits: computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1),
    });
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue(
      fxRate == null ? null : { currencyCode: "X", rate: fxRate }
    );
  }

  async function spawn(countryId: string, stateId: string) {
    const { spawnNppCorporation } = await import("./spawnNppCorporation");
    const result = await spawnNppCorporation(db as unknown as Db, {
      name: "Spawnco",
      type: "manufacturing",
      countryId: countryId as never,
      headquartersState: stateId,
    });
    return {
      result,
      sector: db.collectionMocks.corporateSectors!.insertOne.mock.calls[0][0] as Record<
        string,
        unknown
      >,
      poolSet: (
        db.collectionMocks.unownedSectors!.updateOne.mock.calls[0][1] as {
          $set: Record<string, number>;
        }
      ).$set,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes revenue in the host-state currency, not ₳", async () => {
    setup("JP", "KAN", JPY_RATE);
    const { sector } = await spawn("JP", "KAN");
    expect(sector.revenue).toBe(Math.round(CAPTURE_ANCHOR * JPY_RATE));
  });

  it("round-trips back to the ₳ figure a reader expects", async () => {
    setup("JP", "KAN", JPY_RATE);
    const { sector } = await spawn("JP", "KAN");
    const { readCorpEconomicAnchor } = await import("@/lib/currency/corpEconomyFields");
    expect(readCorpEconomicAnchor(sector.revenue as number, "JPY", JPY_RATE)).toBeCloseTo(
      CAPTURE_ANCHOR,
      0
    );
  });

  it("leaves the ₳ quantities — pool drawdown and the returned figure — untouched", async () => {
    setup("JP", "KAN", JPY_RATE);
    const { poolSet, result } = await spawn("JP", "KAN");
    // The unowned pool is ₳-native by convention; the conversion happens at the
    // sector-row boundary only.
    expect(poolSet.revenue).toBe(Math.max(0, POOL_REVENUE - CAPTURE_ANCHOR));
    expect(result.startingRevenue).toBe(CAPTURE_ANCHOR);
  });

  it("is a no-op for an anchor-rate country (USD ≈ 1)", async () => {
    setup("US", "CA", 1);
    const { sector } = await spawn("US", "CA");
    expect(sector.revenue).toBe(CAPTURE_ANCHOR);
  });

  it("passes through unchanged when no FX rate is on file", async () => {
    setup("US", "CA", null);
    const { sector } = await spawn("US", "CA");
    expect(sector.revenue).toBe(CAPTURE_ANCHOR);
  });
});
