import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPresidentialSuccession } from "./presidentialSuccession";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  // Pre-initialize collections so collectionMocks entries exist before test setup
  for (const name of ["electedOfficials", "characters", "npps", "notifications"]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("processPresidentialSuccession", () => {
  it("promotes VP character to President when president office is vacant", async () => {
    const vpCharId = new ObjectId();

    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      characterId: null,
      nppId: null,
      characterName: null,
    }).mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "vicePresident",
      characterId: vpCharId,
      characterName: "Jane VP",
      party: "democrat",
      isNPP: false,
      nppId: null,
    });

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: vpCharId,
      userId: new ObjectId(),
      name: "Jane VP",
      party: "democrat",
    });

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(true);
    // President gets VP's data
    expect(db.collectionMocks["electedOfficials"]!.updateOne).toHaveBeenCalledWith(
      {
        officeType: "president",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          characterId: vpCharId,
          characterName: "Jane VP",
          countryId: "US",
        }),
      }),
      { upsert: true }
    );
    // VP office is cleared
    expect(db.collectionMocks["electedOfficials"]!.updateOne).toHaveBeenCalledWith(
      {
        officeType: "vicePresident",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({ characterId: null, countryId: "US" }),
      })
    );
    // Character currentOffice updated + succession recorded in career history
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledWith(
      { _id: vpCharId },
      expect.objectContaining({
        $set: expect.objectContaining({ currentOffice: { type: "president" } }),
        $push: expect.objectContaining({
          careerHistory: expect.objectContaining({
            type: "appointed",
            office: { type: "president" },
          }),
        }),
      })
    );
  });

  it("returns false and does nothing when president office is filled", async () => {
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      characterId: new ObjectId(),
      characterName: "Active Pres",
      nppId: null,
    });

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(false);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });

  it("returns false and does nothing when president is vacant but VP is also vacant", async () => {
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      characterId: null,
      nppId: null,
    }).mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "vicePresident",
      characterId: null,
      nppId: null,
    });

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(false);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });

  it("promotes VP NPP to President when president office is vacant", async () => {
    const vpNppId = new ObjectId();

    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      characterId: null,
      nppId: null,
    }).mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "vicePresident",
      characterId: null,
      nppId: vpNppId,
      characterName: "NPC Smith",
      party: "republican",
      isNPP: true,
    });

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(true);
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: vpNppId },
      expect.objectContaining({
        $set: expect.objectContaining({ currentOffice: { type: "president" } }),
      })
    );
    // Character collection should not be touched
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
  });

  it("blocks succession when the VP character already reached the presidential term limit", async () => {
    const vpCharId = new ObjectId();

    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      countryId: "US",
      characterId: null,
      nppId: null,
    }).mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "vicePresident",
      countryId: "US",
      characterId: vpCharId,
      characterName: "Jane VP",
      party: "democrat",
      isNPP: false,
      nppId: null,
    });

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: vpCharId,
      userId: new ObjectId(),
      name: "Jane VP",
      party: "democrat",
      executiveTermsServed: { US: 2 },
    });

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(false);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
  });

  it("returns false when no president record exists at all", async () => {
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce(null);

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(false);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });
});
