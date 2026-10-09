import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const loadData = vi.fn();
vi.mock("@/lib/turn/election/loadContingentElectionData", () => ({
  loadContingentElectionData: (...args: unknown[]) => loadData(...args),
}));

import {
  loadHouseVoteStandings,
  partitionEligibleCandidates,
} from "./contingentHouseVoteStandings";

const idA = new ObjectId();
const idB = new ObjectId();
const idC = new ObjectId();
const charA = new ObjectId();
const charB = new ObjectId();
const nppC = new ObjectId();

function candidacy(id: ObjectId, extra: Record<string, unknown>) {
  return { _id: id, status: "active", party: "1", ...extra };
}

describe("partitionEligibleCandidates", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function setup(opts: {
    candidacies: unknown[];
    chars?: ObjectId[];
    npps?: Array<{ _id: ObjectId; retiredAt: Date | null }>;
  }) {
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: async () => opts.candidacies,
    });
    db.collection("characters").find.mockReturnValue({
      project: () => ({ toArray: async () => (opts.chars ?? []).map((_id) => ({ _id })) }),
    });
    db.collection("npps").find.mockReturnValue({
      project: () => ({ toArray: async () => opts.npps ?? [] }),
    });
  }
  const run = () =>
    partitionEligibleCandidates(db as unknown as Db, [
      idA.toString(),
      idB.toString(),
      idC.toString(),
    ]);

  it("keeps candidacies whose holder is present", async () => {
    setup({
      candidacies: [
        candidacy(idA, { characterId: charA, isNPP: false }),
        candidacy(idB, { characterId: charB, isNPP: false }),
        candidacy(idC, { nppId: nppC, isNPP: true }),
      ],
      chars: [charA, charB],
      npps: [{ _id: nppC, retiredAt: null }],
    });
    const { active, droppedIds } = await run();
    expect(active).toHaveLength(3);
    expect(droppedIds).toEqual([]);
  });

  it("drops withdrawn, deleted, retired and missing candidacies", async () => {
    setup({
      candidacies: [
        candidacy(idA, { characterId: charA, isNPP: false, status: "withdrawn" }),
        // idB's character was deleted: not in the characters result.
        candidacy(idB, { characterId: charB, isNPP: false }),
        candidacy(idC, { nppId: nppC, isNPP: true }),
      ],
      chars: [charA],
      npps: [{ _id: nppC, retiredAt: new Date() }],
    });
    const { active, droppedIds } = await run();
    expect(active).toHaveLength(0);
    expect(droppedIds.sort()).toEqual([idA, idB, idC].map(String).sort());
  });

  it("drops a candidacy whose document is gone", async () => {
    setup({
      candidacies: [candidacy(idA, { characterId: charA, isNPP: false })],
      chars: [charA],
    });
    const { active, droppedIds } = await run();
    expect(active.map((c) => c._id.toString())).toEqual([idA.toString()]);
    expect(droppedIds.sort()).toEqual([idB.toString(), idC.toString()].sort());
  });
});

describe("loadHouseVoteStandings", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    loadData.mockReset();
  });

  it("ballots only the candidacies still running, applying whips through the coalition map", async () => {
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: async () => [
        candidacy(idA, { characterId: charA, isNPP: false }),
        candidacy(idB, { characterId: charB, isNPP: false, status: "withdrawn" }),
      ],
    });
    db.collection("characters").find.mockReturnValue({
      project: () => ({ toArray: async () => [{ _id: charA }] }),
    });
    db.collection("npps").find.mockReturnValue({ project: () => ({ toArray: async () => [] }) });
    db.collection("coalitions").find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ sequentialId: 7, members: [{ partySequentialId: 2 }] }],
      }),
    });
    loadData.mockResolvedValue({
      presidentCandidates: [
        { id: idA.toString(), party: "1", economic: 0, social: 0 },
        { id: idB.toString(), party: "2", economic: 0, social: 0 },
      ],
      houseDelegations: [
        {
          stateId: "AA",
          voters: [{ id: "npp_x", party: "2", economic: 5, social: 0, weight: 1 }],
        },
      ],
    });

    const standings = await loadHouseVoteStandings(
      db as unknown as Db,
      { _id: new ObjectId(), countryId: "US" },
      { electoralVotesByCandidate: {} },
      {
        eligibleCandidateIds: [idA.toString(), idB.toString()],
        votes: {},
        whips: { "coalition:7": { candidateId: idA.toString() } } as never,
      }
    );

    expect(standings.activeCandidateIds).toEqual([idA.toString()]);
    expect(standings.droppedCandidateIds).toEqual([idB.toString()]);
    // The coalition whip moved the party 2 NPP to the only candidate left.
    expect(standings.delegationVotes.AA).toBe(idA.toString());
    expect(Object.keys(standings.delegationTotals)).toEqual([idA.toString()]);
    // Only live candidacies were handed to the engine's loader.
    expect(loadData.mock.calls[0][3]).toHaveLength(1);
  });
});
