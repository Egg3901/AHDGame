import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stubElectionCandidates } from "@/lib/test-utils/stubElectionCandidates";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const NOW = new Date("2026-09-15T12:00:00Z");

/**
 * Candidacies swept out by a completed or cancelled election are withdrawn the
 * same way a manual withdrawal is, so their campaigns must be archived too —
 * otherwise the race's Campaign Operations list keeps rendering them.
 */
describe("stale / cancelled election sweeps — campaign archival", () => {
  let db: MockDb;
  const electionId = new ObjectId();
  const characterId = new ObjectId();
  const candidacyId = new ObjectId();

  function stubFind(collection: string, docs: unknown[]) {
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      toArray: async () => docs,
    };
    db.collectionMocks[collection]!.find.mockReturnValue(cursor as never);
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("elections");
    db.collection("electionCandidates");
    db.collection("campaigns");
    db.collectionMocks.campaigns!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("cleanupStaleElectionCandidates archives campaigns of candidates in completed elections", async () => {
    stubFind("elections", [{ _id: electionId }]);
    stubElectionCandidates(db, [{ _id: candidacyId, electionId, characterId, status: "active" }]);

    const { cleanupStaleElectionCandidates } = await import("./perpetualElections/engine");
    await cleanupStaleElectionCandidates(NOW);

    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalled();
    const [filter, update] = db.collectionMocks.campaigns!.updateMany.mock.calls[0];
    expect(filter.electionId).toEqual(electionId);
    expect(filter.candidateId.$in.map(String)).toContain(characterId.toString());
    expect(update.$set.status).toBe("archived");
  });

  // snapElection's cancellation sweep deliberately has no campaign archival:
  // `triggerSnapElection` is gated to parliamentary countries and cancels the
  // country's lowerChamber races, while `isCampaignEligibleElection` limits
  // campaigns to US races and direct-election presidencies. No campaign can
  // exist on an election that sweep cancels, so archiving there is dead code.
});
