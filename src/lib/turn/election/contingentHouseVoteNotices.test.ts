import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const notify = vi.fn();
const news = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...args: unknown[]) => notify(...args),
}));
vi.mock("@/lib/news", () => ({
  createSystemNewsPost: (...args: unknown[]) => news(...args),
}));

import {
  notifyHouseVoteClosed,
  notifyHouseVoteOpened,
  notifyHouseVoteReminder,
} from "./contingentHouseVoteNotices";

const election = { _id: new ObjectId(), countryId: "US" } as never;
const memberChar = new ObjectId();
const voterChar = new ObjectId();
const candidateChar = new ObjectId();
const chairChar = new ObjectId();
const coalChairChar = new ObjectId();
const userOf = new Map<string, ObjectId>([
  [memberChar.toString(), new ObjectId()],
  [voterChar.toString(), new ObjectId()],
  [candidateChar.toString(), new ObjectId()],
  [chairChar.toString(), new ObjectId()],
  [coalChairChar.toString(), new ObjectId()],
]);

const vote = {
  status: "open" as const,
  openedTurn: 10,
  closesTurn: 34,
  actingPresidentId: "x",
  actingPresidentName: "Acting Person",
  eligibleCandidateIds: [new ObjectId().toString()],
  votes: { [voterChar.toString()]: "a" },
};

describe("House vote notices", () => {
  let db: MockDb;
  beforeEach(() => {
    notify.mockReset().mockResolvedValue(undefined);
    news.mockReset().mockResolvedValue(undefined);
    db = createMockDb();
    db.collection("electedOfficials").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { characterId: memberChar, party: "3" },
          { characterId: voterChar, party: "3" },
          // The chair also sits in the House.
          { characterId: chairChar, party: "3" },
        ],
      }),
    });
    db.collection("electionCandidates").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { characterId: candidateChar, isNPP: false, party: "5" },
          { isNPP: true, party: "6" },
        ],
      }),
    });
    db.collection("politicalParties").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: 3, chairId: chairChar },
          // A party with no House seats and no candidate is not asked to whip.
          { sequentialId: 9, chairId: new ObjectId() },
        ],
      }),
    });
    db.collection("coalitions").find.mockReturnValue({
      project: () => ({ toArray: async () => [{ chairCharacterId: coalChairChar }] }),
    });
    db.collection("characters").find.mockImplementation((filter: { _id: { $in: ObjectId[] } }) => ({
      project: () => ({
        toArray: async () =>
          filter._id.$in
            .filter((id) => userOf.has(id.toString()))
            .map((id) => ({ _id: id, userId: userOf.get(id.toString()) })),
      }),
    }));
  });

  const asDb = () => db as unknown as Db;
  const sent = () => notify.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);

  it("tells members, candidates and chairs what happened, how to act and the deadline", async () => {
    await notifyHouseVoteOpened(asDb(), election, vote, 26);
    const byUser = new Map(sent().map((n) => [String(n.userId), n]));
    expect(byUser.size).toBe(5);
    const member = byUser.get(String(userOf.get(memberChar.toString())))!;
    expect(member.message).toContain("Acting Person");
    expect(member.message).toContain("26 state delegations");
    expect(member.message).toContain("turn 34");
    expect(member.message).toContain("vote on the election page");
    expect(member.message).not.toContain("whip");
    const candidate = byUser.get(String(userOf.get(candidateChar.toString())))!;
    expect(candidate.message).toContain("one of the three candidates");
    const chair = byUser.get(String(userOf.get(chairChar.toString())))!;
    expect(chair.message).toContain("vote on the election page");
    expect(chair.message).toContain("set a whip");
    expect(byUser.get(String(userOf.get(coalChairChar.toString())))!.message).toContain(
      "set a whip"
    );
    expect(sent().every((n) => n.type === "election_opened")).toBe(true);
    expect(JSON.stringify(sent())).not.toMatch(/[–—]/);
  });

  it("reminds only members who have not voted", async () => {
    const count = await notifyHouseVoteReminder(
      asDb(),
      election,
      vote,
      { leaderName: "Ada Alpha", leaderDelegations: 20, threshold: 26 },
      20
    );
    const targets = sent().map((n) => String(n.userId));
    // Members and the chair-member, not the one who voted, not non-members.
    expect(count).toBe(2);
    expect(targets).toContain(String(userOf.get(memberChar.toString())));
    expect(targets).toContain(String(userOf.get(chairChar.toString())));
    expect(targets).not.toContain(String(userOf.get(voterChar.toString())));
    expect(sent()[0].message).toContain("Ada Alpha leads with 20 of 26");
    expect(sent()[0].message).toContain("14 turns left");
  });

  it("announces a House choice to everyone and posts one news item", async () => {
    await notifyHouseVoteClosed(asDb(), election, vote, {
      winnerName: "Ada Alpha",
      delegations: 27,
      threshold: 26,
    });
    expect(sent()).toHaveLength(5);
    expect(sent()[0].message).toContain("chose Ada Alpha as president");
    expect(sent()[0].message).toContain("Acting Person becomes vice president");
    expect(news).toHaveBeenCalledTimes(1);
    expect(news.mock.calls[0][1]).toBe("election");
  });

  it("announces a close without a choice", async () => {
    await notifyHouseVoteClosed(asDb(), election, vote, {
      winnerName: null,
      delegations: 0,
      threshold: 26,
    });
    expect(sent()[0].message).toContain("ended its vote without a majority");
    expect(sent()[0].message).toContain("continues as acting president");
    expect(news).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the notification write fails", async () => {
    notify.mockRejectedValue(new Error("down"));
    await expect(notifyHouseVoteOpened(asDb(), election, vote, 26)).resolves.toBeUndefined();
  });
});
