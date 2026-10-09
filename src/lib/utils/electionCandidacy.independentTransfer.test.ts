import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { transferIndependentCandidaciesToParty } from "./electionCandidacy";

describe("transferIndependentCandidaciesToParty", () => {
  it("keeps live Independent candidacies active under the joined party", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const staleElectionId = new ObjectId();
    const staleCandidateId = new ObjectId();
    const now = new Date("2026-10-07T12:00:00.000Z");

    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("campaigns");
    db.collection("electionVoteTallies");
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: candidateId,
          electionId,
          characterId,
          party: "independent",
          status: "active",
        },
        {
          _id: staleCandidateId,
          electionId: staleElectionId,
          characterId,
          party: "independent",
          status: "active",
        },
      ],
    } as never);
    db.collectionMocks.elections!.find.mockReturnValue({
      toArray: async () => [
        { _id: electionId, status: "active", electionType: "governor", state: "CA" },
      ],
    } as never);
    db.collectionMocks.electionCandidates!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await transferIndependentCandidaciesToParty(
      db as unknown as Db,
      characterId,
      "7",
      now
    );

    expect(result).toEqual({ transferredCount: 1, elections: ["governor (CA)"] });
    expect(db.collectionMocks.electionCandidates!.updateMany).toHaveBeenCalledWith(
      {
        _id: { $in: [candidateId] },
        status: "active",
        party: "independent",
      },
      { $set: { party: "7" } }
    );
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalledWith(
      {
        electionId: { $in: [electionId] },
        candidateId: characterId,
        party: "independent",
      },
      { $set: { party: "7", updatedAt: now } }
    );
    expect(db.collectionMocks.electionVoteTallies!.bulkWrite).toHaveBeenCalledWith([
      {
        updateMany: {
          filter: { electionId },
          update: { $set: { [`candidateParties.${candidateId.toString()}`]: "7" } },
        },
      },
    ]);
  });

  it("does not transfer candidacies from elections outside the live lifecycle", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    const electionId = new ObjectId();

    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("campaigns");
    db.collection("electionVoteTallies");
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          electionId,
          characterId,
          party: "independent",
          status: "active",
        },
      ],
    } as never);
    db.collectionMocks.elections!.find.mockReturnValue({ toArray: async () => [] } as never);

    const result = await transferIndependentCandidaciesToParty(
      db as unknown as Db,
      characterId,
      "7"
    );

    expect(result).toEqual({ transferredCount: 0, elections: [] });
    expect(db.collectionMocks.electionCandidates!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.campaigns!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionVoteTallies!.bulkWrite).not.toHaveBeenCalled();
  });
});
