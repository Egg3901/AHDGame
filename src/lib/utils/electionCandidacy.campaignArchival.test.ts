import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/electionEngine/tallyCleaner", () => ({
  removeWithdrawnCandidateFromTally: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Every path that marks an `electionCandidates` row `withdrawn` must also
 * archive that candidate's campaign. The Campaign Operations list hides
 * archived campaigns, so a path that skips the archive leaves a withdrawn
 * candidate's campaign on an active surface (live: Iskra + Fujimori on the
 * US presidential race, both withdrawn by a party switch).
 */
describe("electionCandidacy — campaign archival on withdrawal", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const electionId = new ObjectId();
  const candidacyId = new ObjectId();

  /** Stub a `find()` chain that supports both `.toArray()` and `.project().toArray()`. */
  function stubFind(collection: string, docs: unknown[]) {
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      toArray: async () => docs,
    };
    db.collectionMocks[collection]!.find.mockReturnValue(cursor as never);
  }

  /**
   * Stateful `electionCandidates` stub. The production paths withdraw the rows
   * and THEN archive, and `archiveCampaignsForCandidates` re-reads the
   * still-active rows to avoid archiving someone who is still standing. A stub
   * that replayed the same docs to every query would hand that re-read the rows
   * the caller just withdrew, so `updateMany` mutates the fixture here the way
   * the real collection would, and `find` honours a `status` filter.
   */
  function stubCandidates(docs: Record<string, unknown>[]) {
    const rows = docs.map((d) => ({ ...d }));

    db.collectionMocks.electionCandidates!.find.mockImplementation((filter = {}) => {
      const f = filter as { status?: string };
      const matched = f.status ? rows.filter((r) => r.status === f.status) : rows;
      const cursor = {
        project: () => cursor,
        sort: () => cursor,
        toArray: async () => matched,
      };
      return cursor as never;
    });

    db.collectionMocks.electionCandidates!.updateMany.mockImplementation(
      async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const ids = (filter._id as { $in?: ObjectId[] })?.$in;
        const status = (update.$set as { status?: string })?.status;
        let modifiedCount = 0;
        for (const r of rows) {
          if (ids && !ids.some((id) => id.toString() === (r._id as ObjectId).toString())) continue;
          if (status) r.status = status;
          modifiedCount++;
        }
        return { modifiedCount } as never;
      }
    );

    return rows;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("campaigns");
    db.collection("characters");
    db.collection("statePartyElections");
    db.collection("statePartyCandidates");
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");
    db.collection("nationalCommitteeElections");
    db.collection("nationalCommitteeCandidates");

    for (const c of [
      "statePartyElections",
      "nationalPartyElections",
      "nationalCommitteeElections",
    ]) {
      stubFind(c, []);
    }
    db.collectionMocks.campaigns!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.electionCandidates!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  /** Assert the campaign for `characterId` in `electionId` was archived. */
  function expectCampaignArchived(reason: string) {
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalled();
    const [filter, update] = db.collectionMocks.campaigns!.updateMany.mock.calls[0];
    expect(filter.electionId).toEqual(electionId);
    expect(filter.candidateId.$in.map(String)).toContain(characterId.toString());
    expect(filter.status).toEqual({ $ne: "archived" });
    expect(update.$set.status).toBe("archived");
    expect(update.$set.archivedReason).toBe(reason);
  }

  it("withdrawFromMismatchedPrimaries archives the campaign of a party switcher", async () => {
    stubCandidates([{ _id: candidacyId, electionId, characterId, party: "4", status: "active" }]);
    stubFind("elections", [{ _id: electionId, electionType: "president", state: "US" }]);

    const { withdrawFromMismatchedPrimaries } = await import("./electionCandidacy");
    const result = await withdrawFromMismatchedPrimaries(characterId, "1");

    expect(result.withdrawnCount).toBe(1);
    expectCampaignArchived("withdrawn");
  });

  it("sweepPartyMismatchedCandidates archives the campaign of a stale-party candidacy", async () => {
    stubFind("elections", [{ _id: electionId }]);
    stubCandidates([{ _id: candidacyId, electionId, characterId, party: "4", status: "active" }]);
    stubFind("characters", [{ _id: characterId, party: "1" }]);

    const { sweepPartyMismatchedCandidates } = await import("./electionCandidacy");
    const withdrawn = await sweepPartyMismatchedCandidates();

    expect(withdrawn).toBe(1);
    expectCampaignArchived("withdrawn");
  });

  it("sweepPartyMismatchedCandidates leaves the campaign live when a correct-party candidacy remains", async () => {
    // The character re-entered the same race under their new party before the
    // sweep ran, so only the stale-party row is withdrawn. They are still in
    // the race, so their campaign must NOT be archived out from under them.
    stubFind("elections", [{ _id: electionId }]);
    stubCandidates([
      { _id: candidacyId, electionId, characterId, party: "4", status: "active" },
      { _id: new ObjectId(), electionId, characterId, party: "1", status: "active" },
    ]);
    stubFind("characters", [{ _id: characterId, party: "1" }]);

    const { sweepPartyMismatchedCandidates } = await import("./electionCandidacy");
    await sweepPartyMismatchedCandidates();

    expect(db.collectionMocks.campaigns!.updateMany).not.toHaveBeenCalled();
  });

  it("withdrawNPPFromMismatchedPrimaries archives the campaign of an NPP party switcher", async () => {
    const nppId = new ObjectId();
    stubCandidates([
      { _id: candidacyId, electionId, nppId, isNPP: true, party: "4", status: "active" },
    ]);
    stubFind("elections", [{ _id: electionId, electionType: "president", state: "US" }]);

    const { withdrawNPPFromMismatchedPrimaries } = await import("./electionCandidacy");
    const result = await withdrawNPPFromMismatchedPrimaries(nppId, "1");

    expect(result.withdrawnCount).toBe(1);
    expect(db.collectionMocks.campaigns!.updateMany).toHaveBeenCalled();
    const [filter, update] = db.collectionMocks.campaigns!.updateMany.mock.calls[0];
    // NPP campaigns key `candidateId` by the NPP id.
    expect(filter.candidateId.$in.map(String)).toContain(nppId.toString());
    expect(update.$set.status).toBe("archived");
  });

  it("withdrawAllActiveCandidacies archives the campaign on relocation", async () => {
    stubCandidates([{ _id: candidacyId, electionId, characterId, party: "4", status: "active" }]);
    stubFind("elections", [{ _id: electionId }]);
    db.collectionMocks.statePartyCandidates!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.nationalPartyCandidates!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.nationalCommitteeCandidates!.updateMany.mockResolvedValue({
      modifiedCount: 0,
    });

    const { withdrawAllActiveCandidacies } = await import("./electionCandidacy");
    const result = await withdrawAllActiveCandidacies(characterId);

    expect(result.withdrawnGeneralElections).toBe(1);
    expectCampaignArchived("withdrawn");
  });
});
