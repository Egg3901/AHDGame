import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

vi.mock("@/lib/seeds/reference/budgets", () => ({
  generateCountryOwnedSeedData: vi.fn(),
}));

vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: vi.fn().mockResolvedValue("1953-default"),
}));

import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import { reconcileCommandEconomyUnowned } from "./reconcileCommandEconomyUnowned";

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(docs),
    }),
  };
}

describe("reconcileCommandEconomyUnowned", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("states");
    db.collection("unownedSectors");
    db.collection("corporations");
    db.collection("corporateSectors");

    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      commandEconomyEnabled: true,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1953,
    });
    db.collectionMocks.states.find.mockReturnValue(
      cursor([
        { _id: "SN", countryId: "DD", population: 1_000_000, gdp: 5_000 },
        { _id: "CA", countryId: "US", population: 10_000_000, gdp: 100_000 },
      ])
    );
    db.collectionMocks.unownedSectors.deleteMany.mockResolvedValue({ deletedCount: 12 });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(12);
  });

  it("no-ops when commandEconomyEnabled is off", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      commandEconomyEnabled: false,
    });
    const result = await reconcileCommandEconomyUnowned(db as unknown as Db);
    expect(result.commandCountries).toEqual([]);
    expect(generateCountryOwnedSeedData).not.toHaveBeenCalled();
  });

  it("creates missing SOEs, reuses existing by assignedSectorTypes, deletes unowned", async () => {
    const existingCorpId = new ObjectId();
    const newCorpId = new ObjectId();
    const sectorId = new ObjectId();

    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([
      {
        corporation: {
          _id: existingCorpId,
          countryOwnerId: "DD",
          assignedSectorTypes: ["manufacturing"],
          type: "manufacturing",
          name: "East German Manufacturing Enterprise",
          description: "mfg",
          soe: { sector: "manufacturing", planTarget: 1 },
        },
        sectors: [
          {
            _id: sectorId,
            corporationId: existingCorpId,
            countryId: "DD",
            stateId: "SN",
            sectorType: "manufacturing",
            revenue: 100,
            capitalStock: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      {
        corporation: {
          _id: newCorpId,
          countryOwnerId: "DD",
          assignedSectorTypes: ["retail"],
          type: "retail",
          name: "East German Retail Enterprise",
          description: "retail",
          soe: { sector: "retail", planTarget: 1 },
        },
        sectors: [
          {
            _id: new ObjectId(),
            corporationId: newCorpId,
            countryId: "DD",
            stateId: "SN",
            sectorType: "retail",
            revenue: 50,
            capitalStock: 5,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ] as never);

    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: existingCorpId,
        countryOwnerId: "DD",
        assignedSectorTypes: ["manufacturing"],
      })
      .mockResolvedValueOnce(null);

    const result = await reconcileCommandEconomyUnowned(db as unknown as Db, {
      preset: "1953-default",
    });

    expect(result.commandCountries).toEqual(["DD"]);
    expect(result.soesCreated).toBe(1);
    expect(result.soesReused).toBe(1);
    expect(result.sectorsUpserted).toBe(2);
    expect(result.unownedDeleted).toBe(12);
    expect(db.collectionMocks.unownedSectors.deleteMany).toHaveBeenCalledWith({
      $or: [
        { countryId: "DD", sectorType: "manufacturing", stateId: { $in: ["SN"] } },
        { countryId: "DD", sectorType: "retail", stateId: { $in: ["SN"] } },
      ],
    });
    // Fallout cleanup reaches only the covered state, not the whole country.
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      countryId: "DD",
      sectorType: "manufacturing",
      stateId: { $in: ["SN"] },
      corporationId: { $ne: existingCorpId },
    });
    expect(CORPORATION_TYPES.length).toBeGreaterThan(6);
  });

  it("scopes unowned drain to covered (country, type, state) triples (CN keeps dual-track headroom)", async () => {
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "BJ", countryId: "CN", population: 5_000_000, gdp: 20_000 }])
    );
    const mfgId = new ObjectId();
    const energyId = new ObjectId();
    const seedEntry = (
      corpId: ObjectId,
      sectorType: "manufacturing" | "energy",
      revenue: number
    ) => ({
      corporation: {
        _id: corpId,
        countryOwnerId: "CN",
        assignedSectorTypes: [sectorType],
        type: sectorType,
        name: `Chinese ${sectorType} Enterprise`,
        description: sectorType,
        soe: { sector: sectorType, planTarget: 1 },
      },
      sectors: [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "CN",
          stateId: "BJ",
          sectorType,
          revenue,
          capitalStock: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([
      seedEntry(mfgId, "manufacturing", 100),
      seedEntry(energyId, "energy", 80),
    ] as never);
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await reconcileCommandEconomyUnowned(db as unknown as Db, { preset: "1953-default" });

    const filter = db.collectionMocks.unownedSectors.deleteMany.mock.calls[0]?.[0] as {
      $or: Array<{ countryId: string; sectorType: string; stateId: { $in: string[] } }>;
    };
    expect(filter.$or).toEqual([
      { countryId: "CN", sectorType: "manufacturing", stateId: { $in: ["BJ"] } },
      { countryId: "CN", sectorType: "energy", stateId: { $in: ["BJ"] } },
    ]);
  });

  it("never deletes sectors in states the seed built no row for (ticket #1271)", async () => {
    // DD absorbs a western region (NW) the SOE seed does not cover: the entry
    // only carries SN, so NW's live private sector and unowned pool survive.
    const soeId = new ObjectId();
    const seedSectorId = new ObjectId();
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([
      {
        corporation: {
          _id: soeId,
          countryOwnerId: "DD",
          assignedSectorTypes: ["extraction"],
          type: "extraction",
          name: "East German Extraction & Mining Enterprise",
          description: "extraction",
          soe: { sector: "extraction", planTarget: 1 },
        },
        sectors: [
          {
            _id: seedSectorId,
            corporationId: soeId,
            countryId: "DD",
            stateId: "SN",
            sectorType: "extraction",
            revenue: 100,
            capitalStock: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ] as never);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: soeId,
      countryOwnerId: "DD",
      assignedSectorTypes: ["extraction"],
    });

    const result = await reconcileCommandEconomyUnowned(db as unknown as Db, {
      preset: "1953-default",
    });

    expect(result.sectorsUpserted).toBe(1);
    for (const call of db.collectionMocks.corporateSectors.deleteMany.mock.calls) {
      expect(call[0].stateId).toEqual({ $in: ["SN"] });
    }
    const drain = db.collectionMocks.unownedSectors.deleteMany.mock.calls[0]?.[0] as {
      $or: Array<{ stateId: { $in: string[] } }>;
    };
    expect(drain.$or).toHaveLength(1);
    expect(drain.$or[0].stateId).toEqual({ $in: ["SN"] });
  });

  it("drains nothing when the seed covers nothing", async () => {
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([]);

    const result = await reconcileCommandEconomyUnowned(db as unknown as Db, {
      preset: "1953-default",
    });

    expect(result.unownedDeleted).toBe(0);
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.deleteMany).not.toHaveBeenCalled();
  });

  it("dry-run counts unowned without writing", async () => {
    const soeId = new ObjectId();
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([
      {
        corporation: {
          _id: soeId,
          countryOwnerId: "DD",
          assignedSectorTypes: ["manufacturing"],
          type: "manufacturing",
          name: "East German Manufacturing Enterprise",
          description: "mfg",
          soe: { sector: "manufacturing", planTarget: 1 },
        },
        sectors: [
          {
            _id: new ObjectId(),
            corporationId: soeId,
            countryId: "DD",
            stateId: "SN",
            sectorType: "manufacturing",
            revenue: 100,
            capitalStock: 10,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ] as never);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: soeId,
      countryOwnerId: "DD",
      assignedSectorTypes: ["manufacturing"],
    });

    const result = await reconcileCommandEconomyUnowned(db as unknown as Db, { dryRun: true });
    expect(result.unownedDeleted).toBe(12);
    expect(db.collectionMocks.unownedSectors.countDocuments).toHaveBeenCalledWith({
      $or: [{ countryId: "DD", sectorType: "manufacturing", stateId: { $in: ["SN"] } }],
    });
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.deleteMany).not.toHaveBeenCalled();
  });
});
