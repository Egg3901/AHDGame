import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { UnionLeaderVote } from "@/lib/db/types/union";
import {
  dedupeUnionLeaderVotes,
  leadingUnionCandidate,
  tallyUnionLeaderVotes,
} from "./unionLeadershipVote";

describe("unionLeadershipVote", () => {
  it("dedupes to the latest vote per organizer", () => {
    const voterId = new ObjectId();
    const first = {
      _id: new ObjectId(),
      unionId: new ObjectId(),
      voterCharacterId: voterId,
      candidateCharacterId: new ObjectId(),
      createdAt: new Date("2020-01-01"),
      updatedAt: new Date("2020-01-01"),
    } as UnionLeaderVote;
    const second = {
      ...first,
      _id: new ObjectId(),
      candidateCharacterId: new ObjectId(),
      updatedAt: new Date("2020-01-02"),
    };
    const deduped = dedupeUnionLeaderVotes([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].candidateCharacterId).toEqual(second.candidateCharacterId);
  });

  it("picks the winner by banked strength, not headcount", () => {
    const unionId = new ObjectId();
    const a = new ObjectId();
    const b = new ObjectId();
    const votes = [
      {
        _id: new ObjectId(),
        unionId,
        voterCharacterId: new ObjectId(),
        candidateCharacterId: a,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        unionId,
        voterCharacterId: new ObjectId(),
        candidateCharacterId: b,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        unionId,
        voterCharacterId: new ObjectId(),
        candidateCharacterId: a,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as UnionLeaderVote[];
    const [first, second, third] = votes;
    const weights = new Map([
      [first.voterCharacterId.toString(), 10],
      [second.voterCharacterId.toString(), 10],
      [third.voterCharacterId.toString(), 10],
    ]);
    expect(tallyUnionLeaderVotes(votes, weights)).toEqual({
      leaderId: a.toString(),
      voteCount: 20,
    });

    const lopsided = new Map([
      [first.voterCharacterId.toString(), 10],
      [second.voterCharacterId.toString(), 500],
      [third.voterCharacterId.toString(), 10],
    ]);
    expect(tallyUnionLeaderVotes(votes, lopsided)).toEqual({
      leaderId: b.toString(),
      voteCount: 500,
    });
  });

  it("ignores voters with no banked strength", () => {
    const unionId = new ObjectId();
    const candidate = new ObjectId();
    const voter = new ObjectId();
    const votes = [
      {
        _id: new ObjectId(),
        unionId,
        voterCharacterId: voter,
        candidateCharacterId: candidate,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as UnionLeaderVote[];
    expect(tallyUnionLeaderVotes(votes, new Map())).toBeNull();
    expect(tallyUnionLeaderVotes(votes, new Map([[voter.toString(), 0]]))).toBeNull();
  });

  it("keeps the incumbent on a tie", () => {
    const incumbent = "inc-1";
    const challenger = "chal-1";
    const counts = new Map([
      [challenger, 50],
      [incumbent, 50],
    ]);
    expect(leadingUnionCandidate(counts, incumbent)).toBe(incumbent);
    expect(leadingUnionCandidate(counts, null)).toBe(challenger);
    expect(
      leadingUnionCandidate(
        new Map([
          [challenger, 51],
          [incumbent, 50],
        ]),
        incumbent
      )
    ).toBe(challenger);
  });
});
