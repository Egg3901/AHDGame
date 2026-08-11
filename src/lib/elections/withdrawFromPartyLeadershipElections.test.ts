import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { withdrawFromPartyLeadershipElections } from "./withdrawFromPartyLeadershipElections";

function makeDb(opts: {
  votingElectionIds?: ObjectId[];
  candidatesModified?: number;
  votesDeleted?: number;
}) {
  const calls: Record<string, unknown[]> = {
    electionFind: [],
    candidateUpdate: [],
    voteDelete: [],
  };
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "nationalPartyElections") {
      return {
        find: vi.fn().mockImplementation((q: unknown) => {
          calls.electionFind.push(q);
          return {
            project: vi.fn().mockReturnValue({
              toArray: vi
                .fn()
                .mockResolvedValue((opts.votingElectionIds ?? []).map((_id) => ({ _id }))),
            }),
          };
        }),
      };
    }
    if (name === "nationalPartyCandidates") {
      return {
        updateMany: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          calls.candidateUpdate.push({ filter, update });
          return Promise.resolve({ modifiedCount: opts.candidatesModified ?? 0 });
        }),
      };
    }
    if (name === "nationalPartyVotes") {
      return {
        deleteMany: vi.fn().mockImplementation((filter: unknown) => {
          calls.voteDelete.push(filter);
          return Promise.resolve({ deletedCount: opts.votesDeleted ?? 0 });
        }),
      };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, calls };
}

describe("withdrawFromPartyLeadershipElections", () => {
  it("withdraws candidacies and deletes votes by AND for the departing members, scoped to the party's voting elections", async () => {
    const e1 = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const { db, calls } = makeDb({
      votingElectionIds: [e1],
      candidatesModified: 2,
      votesDeleted: 5,
    });

    const result = await withdrawFromPartyLeadershipElections(db, [c1, c2], "2", "IE");

    expect(result).toEqual({ candidatesWithdrawn: 2, votesDeleted: 5 });

    // Election lookup is scoped to the party + country + active voting status.
    expect(calls.electionFind[0]).toMatchObject({
      partyId: "2",
      countryId: "IE",
      status: "voting",
    });

    // Candidacies withdrawn only within those elections, for these characters, only active.
    const cand = calls.candidateUpdate[0] as { filter: Record<string, unknown>; update: unknown };
    expect(cand.filter.electionId).toEqual({ $in: [e1] });
    expect(cand.filter.characterId).toEqual({ $in: [c1, c2] });
    expect(cand.filter.status).toBe("active");
    expect(JSON.stringify(cand.update)).toContain("withdrawn");

    // Votes deleted in those elections where the member is EITHER the voter OR the candidate.
    const vote = calls.voteDelete[0] as Record<string, unknown>;
    expect(vote.electionId).toEqual({ $in: [e1] });
    expect(vote.$or).toEqual([{ voterId: { $in: [c1, c2] } }, { candidateId: { $in: [c1, c2] } }]);
  });

  it("omits the country scope when no countryId is supplied", async () => {
    const e1 = new ObjectId();
    const { db, calls } = makeDb({
      votingElectionIds: [e1],
      candidatesModified: 1,
      votesDeleted: 0,
    });

    await withdrawFromPartyLeadershipElections(db, [new ObjectId()], "2");

    const electionQuery = calls.electionFind[0] as Record<string, unknown>;
    expect(electionQuery.partyId).toBe("2");
    expect(electionQuery.status).toBe("voting");
    expect(electionQuery.countryId).toBeUndefined();
  });

  it("is a no-op when no characters are supplied", async () => {
    const { db, calls } = makeDb({});
    const result = await withdrawFromPartyLeadershipElections(db, [], "2", "IE");
    expect(result).toEqual({ candidatesWithdrawn: 0, votesDeleted: 0 });
    expect(calls.electionFind).toHaveLength(0);
    expect(calls.candidateUpdate).toHaveLength(0);
    expect(calls.voteDelete).toHaveLength(0);
  });

  it("is a no-op when the party has no active voting elections", async () => {
    const { db, calls } = makeDb({ votingElectionIds: [] });
    const result = await withdrawFromPartyLeadershipElections(db, [new ObjectId()], "2", "IE");
    expect(result).toEqual({ candidatesWithdrawn: 0, votesDeleted: 0 });
    expect(calls.candidateUpdate).toHaveLength(0);
    expect(calls.voteDelete).toHaveLength(0);
  });
});
