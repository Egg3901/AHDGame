import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { UnionLeaderVote } from "@/lib/db/types/union";
import { dedupeUnionLeaderVotes, tallyUnionLeaderVotes } from "./unionLeadershipVote";

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

  it("picks a plurality winner", () => {
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
    expect(tallyUnionLeaderVotes(votes)).toEqual({
      leaderId: a.toString(),
      voteCount: 2,
    });
  });
});
