import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPresidentialSuccession } from "./presidentialSuccession";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  triggerLeadershipElectionsAfterChamberVote: vi.fn().mockResolvedValue(undefined),
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

  it("vacates the ascender's Senate seat when an NPP VP with a legacy dual office succeeds (#2038)", async () => {
    const vpNppId = new ObjectId();
    const govCharId = new ObjectId();
    const senateRow = {
      _id: new ObjectId(),
      officeType: "senate",
      countryId: "US",
      state: "MO",
      senateClass: 1,
      nppId: vpNppId,
      characterName: "Amanda Bishop",
      party: "1",
      isNPP: true,
    };

    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      officeType: "president",
      characterId: null,
      nppId: null,
    })
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        officeType: "vicePresident",
        characterId: null,
        nppId: vpNppId,
        characterName: "Amanda Bishop",
        party: "1",
        isNPP: true,
      })
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        officeType: "governor",
        state: "MO",
        characterId: govCharId,
        characterName: "Mo Governor",
        party: "1",
      });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([senateRow]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: govCharId,
      userId: new ObjectId(),
      name: "Mo Governor",
      party: "1",
    });
    for (const name of ["notifications", "statePartyOrg", "partyBudget"]) {
      db.collection(name);
    }

    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(true);
    // Presidency still transfers to the NPP.
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: vpNppId },
      expect.objectContaining({
        $set: expect.objectContaining({ currentOffice: { type: "president" } }),
      })
    );
    // The legacy Senate hold is reduced to an unheld vacancy with succession.
    const vacateCalls = db.collectionMocks["electedOfficials"]!.updateMany.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>)?.nppId?.toString() === vpNppId.toString()
    );
    expect(vacateCalls).toHaveLength(1);
    expect(vacateCalls[0][1].$set).toMatchObject({ nppId: null, party: null, isNPP: false });
    expect(db.collectionMocks["notifications"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Senate Seat Vacant" })
    );
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(
      db,
      "senate",
      expect.any(Date)
    );
  });

  it("returns false when no president record exists at all", async () => {
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValueOnce(null);

    const result = await processPresidentialSuccession(db as never);

    expect(result).toBe(false);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });
});
