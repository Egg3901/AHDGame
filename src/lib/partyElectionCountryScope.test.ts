import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("party election country scoping", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("scopes state party resolution queries to the requested country", async () => {
    const effectiveNow = new Date("2026-04-29T20:00:00.000Z");
    db.collection("statePartyElections");
    db.collectionMocks.statePartyElections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processCompletedElections } = await import("./statePartyElections");
    const result = await processCompletedElections(10, effectiveNow, "UK");

    expect(result).toBe(0);
    expect(db.collectionMocks.statePartyElections.find).toHaveBeenCalledWith({
      $and: [
        {
          status: "voting",
          endTurn: { $lte: 10 },
        },
        { countryId: "UK" },
      ],
    });
  });

  it("scopes national party resolution queries to the requested country", async () => {
    const effectiveNow = new Date("2026-04-29T20:00:00.000Z");
    db.collection("nationalPartyElections");
    db.collectionMocks.nationalPartyElections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processCompletedNationalElections } = await import("./nationalPartyElections");
    const result = await processCompletedNationalElections(10, effectiveNow, "DE");

    expect(result).toBe(0);
    expect(db.collectionMocks.nationalPartyElections.find).toHaveBeenCalledWith({
      $and: [
        {
          status: "voting",
          endTurn: { $lte: 10 },
        },
        { countryId: "DE" },
      ],
    });
  });

  it("does not create state elections from a foreign party with the same sequential id", async () => {
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "us-party-1",
          sequentialId: 1,
          countryId: "US",
        },
      ]),
    });

    db.collection("statePartyOrg");
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "ENG_1",
          stateId: "ENG",
          partyId: "1",
          countryId: "UK",
        },
      ]),
    });

    db.collection("statePartyElections");
    db.collectionMocks.statePartyElections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { createMissingElections } = await import("./statePartyElections");
    const created = await createMissingElections(
      10,
      96,
      new Date("2026-04-29T20:00:00.000Z"),
      "UK"
    );

    expect(created).toBe(0);
    expect(db.collectionMocks.statePartyElections.insertMany).not.toHaveBeenCalled();
  });

  it("treats legacy US committee elections without countryId as US-scoped", async () => {
    const effectiveNow = new Date("2026-04-29T20:00:00.000Z");
    db.collection("nationalCommitteeElections");
    db.collectionMocks.nationalCommitteeElections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processCompletedCommitteeElections } = await import("./nationalCommitteeElections");
    const result = await processCompletedCommitteeElections(10, effectiveNow, "US");

    expect(result).toBe(0);
    expect(db.collectionMocks.nationalCommitteeElections.find).toHaveBeenCalledWith({
      $and: [
        {
          status: "voting",
          endTurn: { $lte: 10 },
        },
        {
          $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
        },
      ],
    });
  });
});
