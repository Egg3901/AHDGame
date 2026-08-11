import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  campaignStrengthLookupKey,
  invalidateSuspendEndorsementsForWithdrawnCandidate,
} from "./suspendEndorseLifecycle";

describe("suspendEndorseLifecycle", () => {
  it("campaignStrengthLookupKey prefers nppId for NPP rows", () => {
    const nppId = new ObjectId();
    expect(
      campaignStrengthLookupKey({
        isNPP: true,
        nppId,
        characterId: new ObjectId(),
      })
    ).toBe(nppId.toString());
  });

  it("invalidateSuspendEndorsementsForWithdrawnCandidate clears active endorsement links", async () => {
    const db = createMockDb();
    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates!.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const electionId = new ObjectId();
    const withdrawnId = new ObjectId();
    const modified = await invalidateSuspendEndorsementsForWithdrawnCandidate(
      db as never,
      electionId,
      withdrawnId
    );

    expect(modified).toBe(2);
    expect(db.collectionMocks.electionCandidates!.updateMany).toHaveBeenCalledWith(
      {
        electionId,
        status: "active",
        campaignSuspended: true,
        endorsedElectionCandidateId: withdrawnId,
      },
      expect.objectContaining({
        $unset: { endorsedElectionCandidateId: "" },
      })
    );
  });
});
