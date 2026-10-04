import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporateSectors");
  db.collection("states");
});

describe("POST /api/admin/heal/duplicate-sectors", () => {
  it("normalizes bad sector countryIds and merges duplicates by operating state", async () => {
    const corpId = new ObjectId();
    const keeperId = new ObjectId();
    const duplicateId = new ObjectId();
    const mismatchOnlyId = new ObjectId();
    const nowA = new Date("2026-04-11T22:38:06.824Z");
    const nowB = new Date("2026-04-17T01:03:22.272Z");
    const nowC = new Date("2026-04-13T10:03:42.560Z");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);

    db.collectionMocks.corporateSectors.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: keeperId,
            corporationId: corpId,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 900,
            profitMargin: 20,
            workers: 90,
            createdAt: nowA,
            updatedAt: nowA,
          },
          {
            _id: mismatchOnlyId,
            corporationId: corpId,
            countryId: "US",
            stateId: "KAN",
            sectorType: "energy",
            revenue: 700,
            profitMargin: 30,
            workers: 70,
            createdAt: nowC,
            updatedAt: nowC,
          },
          {
            _id: duplicateId,
            corporationId: corpId,
            countryId: "US",
            stateId: "LON",
            sectorType: "energy",
            revenue: 100,
            profitMargin: 50,
            workers: 10,
            createdAt: nowB,
            updatedAt: nowB,
          },
        ]),
      }),
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "LON", countryId: "UK" },
        { _id: "KAN", countryId: "JP" },
      ]),
    });
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.normalizedSectors).toHaveLength(2);
    expect(data.mergedGroups).toEqual([
      {
        corporationId: corpId.toString(),
        stateId: "LON",
        sectorType: "energy",
        industryModel: null,
        count: 2,
      },
    ]);

    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
      { _id: duplicateId },
      expect.objectContaining({
        $set: expect.objectContaining({ countryId: "UK" }),
      })
    );
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
      { _id: mismatchOnlyId },
      expect.objectContaining({
        $set: expect.objectContaining({ countryId: "JP" }),
      })
    );
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
      {
        _id: keeperId,
        "constructionPropertyTransition.key": `duplicate:${keeperId.toHexString()}:${keeperId.toHexString()}`,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          countryId: "UK",
          revenue: 1000,
          workers: 100,
          profitMargin: 23,
        }),
      })
    );
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      $or: [
        {
          _id: duplicateId,
          "constructionPropertyTransition.key": `duplicate:${keeperId.toHexString()}:${duplicateId.toHexString()}`,
        },
      ],
    });
  });
});
