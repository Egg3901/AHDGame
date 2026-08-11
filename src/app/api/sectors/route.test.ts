import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

function makeRequest(query: string) {
  return new Request(`http://localhost/api/sectors?${query}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("states");
  db.collection("exchangeRates");
  db.collection("unownedSectors");
  db.collection("corporateSectors");
  db.collection("corporations");
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("federalBudget");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  db.collectionMocks.states.find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([
      { _id: "CA", name: "California", countryId: "US" },
      { _id: "UKR", name: "Ukraine", countryId: "RU" },
    ]),
  });
});

describe("GET /api/sectors (view=unowned)", () => {
  it("excludes unowned markets in command-economy countries (RU/USSR) from the row list", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          sectorType: "energy",
          stateId: "CA",
          countryId: "US",
          revenue: 1000,
        },
        {
          _id: new ObjectId(),
          sectorType: "energy",
          stateId: "UKR",
          countryId: "RU",
          revenue: 5000,
        },
      ]),
    });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(1);
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const response = await GET(makeRequest("view=unowned"));
    const data = await response.json();

    expect(response.status).toBe(200);
    const stateIds = (data.sectors as { stateId: string }[]).map((s) => s.stateId);
    expect(stateIds).toContain("CA");
    expect(stateIds).not.toContain("UKR");

    // The badge count query itself must also exclude command-economy countries
    // (not just the row list), so it can't silently overcount.
    expect(db.collectionMocks.unownedSectors.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: expect.objectContaining({
          $nin: expect.arrayContaining(["RU"]),
        }),
      })
    );
  });

  it("forces a zero-result count filter when the explicit country filter is itself command-economy", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.unownedSectors.countDocuments.mockResolvedValue(0);
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const response = await GET(makeRequest("view=unowned&country=RU"));

    expect(response.status).toBe(200);
    expect(db.collectionMocks.unownedSectors.countDocuments).toHaveBeenCalledWith({
      countryId: { $in: [] },
    });
  });
});
