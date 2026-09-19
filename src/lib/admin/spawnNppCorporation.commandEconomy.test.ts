import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, getAccessedCollections, type MockDb } from "@/lib/test-utils/mockDb";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
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

async function batchSpawn() {
  const { batchSpawnNppCorporations } = await import("./spawnNppCorporation");
  return batchSpawnNppCorporations;
}

describe("batchSpawnNppCorporations - planned-economy gate", () => {
  let base: MockDb;
  let db: Db;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function wire(year: number | null) {
    base = createMockDb();
    db = stubMarketizationDb({ currentYear: year, base: base as unknown as Db });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    wire(1953);
  });

  it("attempts nothing in a 1953 planned economy: no spawns, no refusal noise", async () => {
    const spawn = await batchSpawn();
    for (const countryId of ["CN", "UKR", "BLR", "BAL"] as const) {
      const result = await spawn(db, countryId, { perSectorCount: 3 });
      expect(result, countryId).toEqual([]);
    }
    // Zero attempts: the spawn path never reached its first read (states),
    // and no PrivateEnterpriseBlockedError was raised, caught, or logged.
    expect(getAccessedCollections(base)).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("still spawns the full sector stack in an eligible market economy", async () => {
    base.collection("states");
    base.collection("unownedSectors");
    base.collection("exchangeRates");
    base.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "DC",
      countryId: "US",
      name: "DC",
      gdp: 1_000_000_000,
    });
    base.collectionMocks.unownedSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "DC",
      countryId: "US",
      sectorType: "manufacturing",
      revenue: 40_000_000,
      headroomUnits: computeUnownedHeadroomUnits("manufacturing", 40_000_000, 1),
    });
    base.collectionMocks.exchangeRates!.findOne.mockResolvedValue(null);

    const spawn = await batchSpawn();
    const result = await spawn(db, "US", { perSectorCount: 1 });
    expect(result).toHaveLength(CORPORATION_TYPES.length);
    expect(base.collectionMocks.corporations!.insertOne.mock.calls).toHaveLength(
      CORPORATION_TYPES.length
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("lets an unrelated spawn failure fail visibly, with country and sector context", async () => {
    base.collection("states");
    // No state row: every sector slot fails on HQ validation, none of it the
    // command-economy rule.
    base.collectionMocks.states!.findOne.mockResolvedValue(null);

    const spawn = await batchSpawn();
    const result = await spawn(db, "US", { perSectorCount: 1 });
    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(CORPORATION_TYPES.length);
    for (const [index, type] of CORPORATION_TYPES.entries()) {
      const [prefix, err] = consoleErrorSpy.mock.calls[index] as [string, Error];
      expect(prefix).toContain(type);
      expect(prefix).toContain("US");
      expect(err.message).toContain("DC");
    }
  });
});
