import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { withdrawOpsIneligibleCandidacies } from "./withdrawOpsIneligibleCandidacies";

vi.mock("@/lib/electionEngine/tallyCleaner", () => ({
  removeWithdrawnCandidateFromTally: vi.fn(),
}));

function makeCursor<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("withdrawOpsIneligibleCandidacies", () => {
  let db: MockDb;
  const now = new Date("2026-08-16T22:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("elections");
    db.collection("electionCandidates");
    db.collection("politicalParties");
    db.collection("countryState");
  });

  it("withdraws a banned-party NPP from an RU republic Supreme Soviet race", async () => {
    const electionId = new ObjectId();
    const bannedCandidateId = new ObjectId();
    const rulingCandidateId = new ObjectId();

    db.collectionMocks.elections.find.mockReturnValue(
      makeCursor([
        {
          _id: electionId,
          countryId: "RU",
          electionType: "republicSupremeSoviet",
          state: "KAZ",
          status: "active",
        },
      ])
    );
    db.collectionMocks.electionCandidates.find.mockReturnValue(
      makeCursor([
        {
          _id: bannedCandidateId,
          electionId,
          characterName: "Zenonas Adomaitis",
          party: "2",
          status: "active",
          isNPP: true,
        },
        {
          _id: rulingCandidateId,
          electionId,
          characterName: "Nikita Maksimov",
          party: "1",
          status: "active",
          isNPP: true,
        },
      ])
    );
    db.collectionMocks.politicalParties.find.mockReturnValue(
      makeCursor([
        { sequentialId: 1, countryId: "RU", regimeStatus: "ruling" },
        { sequentialId: 2, countryId: "RU", regimeStatus: "banned" },
      ])
    );
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { removeWithdrawnCandidateFromTally } = await import("@/lib/electionEngine/tallyCleaner");
    const result = await withdrawOpsIneligibleCandidacies(db as unknown as Db, now);

    expect(result).toEqual({ withdrawn: 1 });
    const [filter, update] = db.collectionMocks.electionCandidates.updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: [bannedCandidateId] } });
    expect(update).toEqual({ $set: { status: "withdrawn", withdrawnAt: now } });
    expect(removeWithdrawnCandidateFromTally).toHaveBeenCalledWith(
      db,
      electionId,
      bannedCandidateId.toString()
    );
  });

  it("leaves non-OPS candidacies untouched", async () => {
    const electionId = new ObjectId();
    db.collectionMocks.elections.find.mockReturnValue(
      makeCursor([
        {
          _id: electionId,
          countryId: "US",
          electionType: "governor",
          state: "CA",
          status: "active",
        },
      ])
    );
    db.collectionMocks.electionCandidates.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          electionId,
          party: "3",
          status: "active",
        },
      ])
    );

    const result = await withdrawOpsIneligibleCandidacies(db as unknown as Db, now);

    expect(result).toEqual({ withdrawn: 0 });
    expect(db.collectionMocks.politicalParties.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.updateMany).not.toHaveBeenCalled();
  });
});
