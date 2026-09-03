import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date("2026-09-01T00:00:00Z"),
  }),
}));
vi.mock("./resolveVacateMotion", () => ({
  resolveSpeakerVacateMotion: vi.fn().mockResolvedValue(false),
  vacateThreshold: (seats: number) => Math.floor(seats / 2) + 1,
}));

/**
 * A hard Player Whip stores the member's pre-whip ballot on the motion so the
 * "Whipped by Party" badge can offer a revert. Voting for yourself has to drop
 * that snapshot, or the badge sticks around claiming you were whipped.
 */
describe("handleSpeakerAction — vote_vacate_motion", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const userId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("characters").findOne.mockResolvedValue({ _id: characterId, userId });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      officeType: "house",
    });
    db.collection("speakerVacateMotions").findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
      targetSpeakerName: "Sitting Speaker",
      startedAt: new Date("2026-08-31T00:00:00Z"),
      endsOnTurn: 124,
      votes: {},
    });
    db.collectionMocks["speakerVacateMotions"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  async function vote(vacateVote: "for" | "against") {
    const { handleSpeakerAction } = await import("./actions");
    return handleSpeakerAction({
      db: db as unknown as Db,
      partyMap: new Map(),
      house: { totalSeats: 435 } as never,
      authUser: { userId: userId.toString() },
      action: "vote_vacate_motion",
      vacateVote,
    });
  }

  it("records the ballot and clears the player whip snapshot", async () => {
    const result = await vote("against");

    expect(result.success).toBe(true);

    const calls = db.collectionMocks["speakerVacateMotions"]!.updateOne.mock.calls;
    // First write records the vote, second unsets the whip snapshot.
    expect(calls[0][1]).toEqual(
      expect.objectContaining({
        $set: expect.objectContaining({ [`votes.${characterId.toString()}`]: "against" }),
      })
    );
    expect(calls[1][1]).toEqual({
      $unset: { [`whippedFromVote.${characterId.toString()}`]: "" },
    });
  });

  it("rejects a ballot that is neither for nor against", async () => {
    const { handleSpeakerAction } = await import("./actions");
    const result = await handleSpeakerAction({
      db: db as unknown as Db,
      partyMap: new Map(),
      house: { totalSeats: 435 } as never,
      authUser: { userId: userId.toString() },
      action: "vote_vacate_motion",
    });

    expect(result).toEqual(expect.objectContaining({ success: false, status: 400 }));
    expect(db.collectionMocks["speakerVacateMotions"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses to record a vote once the motion's window has closed", async () => {
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 130,
      effectiveNow: new Date("2026-09-03T00:00:00Z"),
    } as never);

    const result = await vote("for");

    expect(result).toEqual(expect.objectContaining({ success: false, status: 409 }));
    expect(db.collectionMocks["speakerVacateMotions"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses when the caller holds no House seat", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue(null);

    const result = await vote("for");

    expect(result).toEqual(expect.objectContaining({ success: false, status: 403 }));
  });
});
