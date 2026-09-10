import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/governorOffice/isSittingLeader", () => ({
  isSittingLeader: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/governorOffice/endorsements/withdrawExecutiveEndorsement", () => ({
  withdrawExecutiveEndorsement: vi.fn().mockResolvedValue({ status: 200, body: { success: true } }),
}));
vi.mock("@/lib/governorOffice/endorsements/withdrawEndorsement", () => ({
  withdrawEndorsement: vi.fn().mockResolvedValue({ status: 200, body: { success: true } }),
}));

const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
const { withdrawExecutiveEndorsement } =
  await import("@/lib/governorOffice/endorsements/withdrawExecutiveEndorsement");
const { withdrawEndorsement } =
  await import("@/lib/governorOffice/endorsements/withdrawEndorsement");
const { processExecutiveEndorsements } = await import("@/lib/turn/executiveEndorsements");
const { processGovernorEndorsements } = await import("@/lib/turn/governorEndorsements");

const ACTIVE_ELECTION = new ObjectId();
const DEAD_ELECTION = new ObjectId();
const ACTIVE_CANDIDATE = new ObjectId();
const DEAD_CANDIDATE = new ObjectId();
const LEADER = new ObjectId();

describe("endorsement withdrawal phases — batched reads (#575)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    vi.mocked(isSittingLeader).mockResolvedValue(true);
  });

  function wire(rows: Record<string, unknown[]>) {
    const real = db.collection.getMockImplementation()!;
    db.collection.mockImplementation((name: string) => {
      const col = real(name);
      col.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows[name] ?? []) });
      return col;
    });
  }

  describe("processExecutiveEndorsements", () => {
    function endorsement(over: Record<string, unknown> = {}) {
      return {
        _id: new ObjectId(),
        isActive: true,
        countryId: "US",
        electionId: ACTIVE_ELECTION,
        candidateId: ACTIVE_CANDIDATE,
        endorsedByCharacterId: LEADER,
        ...over,
      };
    }

    it("withdraws for an ended election, an inactive candidate, and a departed leader", async () => {
      wire({
        executiveEndorsements: [
          endorsement({ electionId: DEAD_ELECTION }),
          endorsement({ candidateId: DEAD_CANDIDATE }),
          endorsement(),
        ],
        elections: [
          { _id: ACTIVE_ELECTION, status: "active" },
          { _id: DEAD_ELECTION, status: "completed" },
        ],
        electionCandidates: [
          { _id: ACTIVE_CANDIDATE, status: "active" },
          { _id: DEAD_CANDIDATE, status: "withdrawn" },
        ],
      });
      vi.mocked(isSittingLeader).mockResolvedValue(false);

      const res = await processExecutiveEndorsements(db as unknown as Db);

      expect(res.withdrawn).toBe(3);
      expect(res.byReason).toEqual({
        election_ended: 1,
        candidate_inactive: 1,
        leader_left_office: 1,
      });
    });

    it("keeps an endorsement whose election, candidate and leader all still hold", async () => {
      wire({
        executiveEndorsements: [endorsement()],
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
      });

      const res = await processExecutiveEndorsements(db as unknown as Db);

      expect(res.withdrawn).toBe(0);
      expect(withdrawExecutiveEndorsement).not.toHaveBeenCalled();
    });

    it("treats a missing election row as an ended election", async () => {
      wire({
        executiveEndorsements: [endorsement()],
        elections: [],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
      });

      const res = await processExecutiveEndorsements(db as unknown as Db);

      expect(res.byReason).toEqual({ election_ended: 1 });
    });

    // The point of #575: cost must not scale with the number of endorsements.
    it("issues a fixed number of reads regardless of endorsement volume", async () => {
      const many = Array.from({ length: 200 }, () => endorsement());
      wire({
        executiveEndorsements: many,
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
      });

      await processExecutiveEndorsements(db as unknown as Db);

      // 1 load of active endorsements + 1 elections $in + 1 candidates $in.
      expect(db.collectionMocks.elections.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.electionCandidates.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.elections.findOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.electionCandidates.findOne).not.toHaveBeenCalled();
    });
  });

  describe("processGovernorEndorsements", () => {
    const GOV = new ObjectId();
    function endorsement(over: Record<string, unknown> = {}) {
      return {
        _id: new ObjectId(),
        isActive: true,
        countryId: "US",
        stateId: "CA",
        electionId: ACTIVE_ELECTION,
        candidateId: ACTIVE_CANDIDATE,
        endorsedByCharacterId: GOV,
        ...over,
      };
    }

    it("withdraws when the endorsing governor no longer holds the office", async () => {
      wire({
        governorEndorsements: [endorsement()],
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
        electedOfficials: [],
      });

      const res = await processGovernorEndorsements(db as unknown as Db);

      expect(res.byReason).toEqual({ governor_left_office: 1 });
    });

    it("keeps the endorsement while that governor still holds that state's office", async () => {
      wire({
        governorEndorsements: [endorsement()],
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
        electedOfficials: [{ countryId: "US", state: "CA", characterId: GOV }],
      });

      const res = await processGovernorEndorsements(db as unknown as Db);

      expect(res.withdrawn).toBe(0);
      expect(withdrawEndorsement).not.toHaveBeenCalled();
    });

    // The holder set is keyed on all three fields, so the right character in
    // the wrong state must not satisfy the check.
    it("does not let a governor of another state keep the endorsement alive", async () => {
      wire({
        governorEndorsements: [endorsement()],
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
        electedOfficials: [{ countryId: "US", state: "TX", characterId: GOV }],
      });

      const res = await processGovernorEndorsements(db as unknown as Db);

      expect(res.byReason).toEqual({ governor_left_office: 1 });
    });

    it("issues a fixed number of reads regardless of endorsement volume", async () => {
      const many = Array.from({ length: 200 }, () => endorsement());
      wire({
        governorEndorsements: many,
        elections: [{ _id: ACTIVE_ELECTION, status: "active" }],
        electionCandidates: [{ _id: ACTIVE_CANDIDATE, status: "active" }],
        electedOfficials: [{ countryId: "US", state: "CA", characterId: GOV }],
      });

      await processGovernorEndorsements(db as unknown as Db);

      expect(db.collectionMocks.elections.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.electionCandidates.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.electedOfficials.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.electedOfficials.findOne).not.toHaveBeenCalled();
    });
  });
});
