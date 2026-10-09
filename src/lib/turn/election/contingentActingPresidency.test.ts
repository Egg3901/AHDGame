import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const seat = vi.fn();
const noticeOpened = vi.fn();
vi.mock("./contingentHouseVoteNotices", () => ({
  notifyHouseVoteOpened: (...args: unknown[]) => noticeOpened(...args),
}));
vi.mock("@/lib/turn/election/presidentExecutiveSeating", () => ({
  seatPresidentialExecutive: (...args: unknown[]) => seat(...args),
}));

import {
  CONTINGENT_HOUSE_VOTE_TURNS,
  needsActingPresidency,
  seatActingPresidencyForHouseVote,
} from "./contingentActingPresidency";

describe("acting presidency after a House deadlock", () => {
  let db: MockDb;
  const election = { _id: new ObjectId(), countryId: "US" } as never;

  beforeEach(() => {
    seat.mockReset();
    noticeOpened.mockReset().mockResolvedValue(undefined);
    db = createMockDb();
  });

  it("needs a deadlock and a Senate-elected vice president", () => {
    expect(needsActingPresidency({ houseDeadlocked: true, vicePresidentWinnerId: "x" })).toBe(true);
    expect(needsActingPresidency({ houseDeadlocked: true, vicePresidentWinnerId: null })).toBe(
      false
    );
    expect(needsActingPresidency({ houseDeadlocked: false, vicePresidentWinnerId: "x" })).toBe(
      false
    );
    expect(needsActingPresidency(undefined)).toBe(false);
  });

  it("seats the vice president as acting president with no running mate and opens the House vote", async () => {
    const vpId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({ name: "Acting Person", party: "5" });
    const result = await seatActingPresidencyForHouseVote(db as unknown as Db, {
      election,
      contingentResult: {
        vicePresidentWinnerId: vpId.toString(),
        eligiblePresidentCandidateIds: ["a", "b", "c"],
        houseThreshold: 26,
      },
      now: new Date(),
      turn: 49,
    });

    expect(seat).toHaveBeenCalledTimes(1);
    const params = seat.mock.calls[0][1];
    expect(params.winnerCandidate.characterId.equals(vpId)).toBe(true);
    expect(params.winnerCandidate.characterName).toBe("Acting Person");
    expect(params.vpCharId).toBeUndefined();
    expect(params.vpNppId).toBeUndefined();

    expect(result).toMatchObject({
      status: "open",
      openedTurn: 49,
      closesTurn: 49 + CONTINGENT_HOUSE_VOTE_TURNS,
      actingPresidentName: "Acting Person",
      eligibleCandidateIds: ["a", "b", "c"],
    });
    const update = db.collection("electionVoteTallies").updateOne.mock.calls[0][1];
    expect(update.$set.contingentHouseVote.status).toBe("open");
    expect(update.$set.executiveSeatingPending).toBe(false);
    // The first seating announces the vote, with the majority it needs.
    expect(noticeOpened).toHaveBeenCalledTimes(1);
    expect(noticeOpened.mock.calls[0][3]).toBe(26);
  });

  it("keeps the original window on a seating retry", async () => {
    const nppId = new ObjectId();
    db.collection("npps").findOne.mockResolvedValue({ name: "Acting NPP", party: "2" });
    const existing = {
      status: "open" as const,
      openedTurn: 49,
      closesTurn: 73,
      actingPresidentId: `npp_${nppId.toString()}`,
      actingPresidentName: "Acting NPP",
      eligibleCandidateIds: ["a"],
      votes: {},
    };
    const result = await seatActingPresidencyForHouseVote(db as unknown as Db, {
      election,
      contingentResult: {
        vicePresidentWinnerId: `npp_${nppId.toString()}`,
        eligiblePresidentCandidateIds: ["a"],
        houseThreshold: 26,
      },
      existingVote: existing,
      now: new Date(),
      turn: 50,
    });
    expect(result.closesTurn).toBe(73);
    expect(noticeOpened).not.toHaveBeenCalled();
    expect(seat.mock.calls[0][1].winnerCandidate.isNPP).toBe(true);
  });
});
