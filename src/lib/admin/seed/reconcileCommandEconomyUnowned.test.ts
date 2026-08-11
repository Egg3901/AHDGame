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
        {
          countryId: "DD",
          sectorType: { $in: expect.arrayContaining(["manufacturing", "retail"]) },
        },
      ],
    });
    expect(CORPORATION_TYPES.length).toBeGreaterThan(6);
  });

  it("scopes unowned drain to SOE sector types (CN keeps dual-track headroom)", async () => {
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "BJ", countryId: "CN", population: 5_000_000, gdp: 20_000 }])
    );
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([]);

    await reconcileCommandEconomyUnowned(db as unknown as Db, { preset: "1953-default" });

    const filter = db.collectionMocks.unownedSectors.deleteMany.mock.calls[0]?.[0] as {
      $or: Array<{ countryId: string; sectorType: { $in: string[] } }>;
    };
    expect(filter.$or).toHaveLength(1);
    expect(filter.$or[0].countryId).toBe("CN");
    expect(filter.$or[0].sectorType.$in).toEqual(
      expect.arrayContaining(["manufacturing", "energy", "retail"])
    );
    expect(filter.$or[0].sectorType.$in).not.toContain("financial");
    expect(filter.$or[0].sectorType.$in.length).toBeLessThan(CORPORATION_TYPES.length);
  });

  it("dry-run counts unowned without writing", async () => {
    vi.mocked(generateCountryOwnedSeedData).mockReturnValue([]);
    const result = await reconcileCommandEconomyUnowned(db as unknown as Db, { dryRun: true });
    expect(result.unownedDeleted).toBe(12);
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
