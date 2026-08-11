import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/db/collections/governmentFormation", () => ({
  getGovernmentFormationsCollection: vi.fn(),
}));

describe("queryGovernment", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    [
      "electedOfficials",
      "congressLeaders",
      "cabinetMembers",
      "characters",
      "politicalParties",
      "governmentFormations",
    ].forEach((n) => db.collection(n));
  });

  it("returns null when country config not found", async () => {
    const { queryGovernment } = await import("./government");
    const result = await queryGovernment(db as unknown as Db, "XX" as never);
    expect(result).toBeNull();
  });

  it("returns seatsByParty as typed array not raw object", async () => {
    const { getGovernmentFormationsCollection } =
      await import("@/lib/db/collections/governmentFormation");
    vi.mocked(getGovernmentFormationsCollection).mockReturnValue({
      findOne: vi.fn().mockResolvedValue({
        status: "formed",
        formationType: "majority",
        pmCharacterId: null,
        pmName: null,
        governingPartyId: "1",
        governingPartyName: "Democrats",
        coalitionPartyIds: null,
        coalitionPartyNames: null,
        totalSeatsSupporting: 270,
        majorityThreshold: 218,
        seatsByParty: { "1": 270, "2": 165 },
        totalSeats: 435,
      }),
    } as never);

    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.congressLeaders!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.cabinetMembers!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.characters!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "p1", sequentialId: 1, name: "Democrats", color: "#00f", countryId: "UK" },
        { _id: "p2", sequentialId: 2, name: "Republicans", color: "#f00", countryId: "UK" },
      ]),
    } as never);

    const { queryGovernment } = await import("./government");
    const result = await queryGovernment(db as unknown as Db, "UK");

    expect(result).not.toBeNull();
    const formation = result!.governmentFormation;
    expect(Array.isArray(formation.seatsByParty)).toBe(true);
    expect((formation.seatsByParty as Array<unknown>)[0]).toMatchObject({
      partyId: expect.any(String),
      partyName: expect.any(String),
      partyColor: expect.any(String),
      seats: expect.any(Number),
    });
  });
});
