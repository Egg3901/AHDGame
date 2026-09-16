import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/congress/leadership/reconcilePartyEligibility", () => ({
  vacateAllLeadershipRoles: vi.fn().mockResolvedValue([]),
}));

/**
 * The sweep that empties a leadership chair whose holder no longer sits in the
 * chamber. It is the path that actually left the US House with no Speaker: the
 * holder withdrew from his re-election race, the general resolved, and the
 * sweep vacated him without opening anything to refill the seat.
 */
describe("vacateLeadershipForLostSeats", () => {
  let db: MockDb;
  const speakerId = new ObjectId();
  const seatedId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("congressLeaders");
    db.collection("electedOfficials");
  });

  /** `leaders` hold the named roles; `seated` are the only House members. */
  function seed(
    leaders: Array<{ role: string; characterId: ObjectId; characterName?: string }>,
    seated: ObjectId[]
  ) {
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(leaders),
    } as never);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(seated.map((id) => ({ officeType: "house", characterId: id }))),
    } as never);
  }

  it("opens a race for the chair it empties", async () => {
    seed(
      [{ role: "speaker_of_the_house", characterId: speakerId, characterName: "Sean Oppenheimer" }],
      [seatedId]
    );

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    vi.mocked(vacateAllLeadershipRoles).mockResolvedValue(["speaker_of_the_house"]);

    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");
    const vacated = await vacateLeadershipForLostSeats(db as unknown as Db);

    expect(vacated).toBe(1);
    expect(vacateAllLeadershipRoles).toHaveBeenCalledWith(
      db,
      [
        {
          leaderRole: "speaker_of_the_house",
          holderId: speakerId,
          formerHolderName: "Sean Oppenheimer",
        },
      ],
      expect.any(Date)
    );
  });

  it("leaves a leader who still holds their seat alone", async () => {
    seed([{ role: "speaker_of_the_house", characterId: speakerId }], [speakerId, seatedId]);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });

  it("vacates nothing when a chamber reads back empty", async () => {
    // Running every turn rather than only after a general means a transient
    // empty read would otherwise vacate the chamber's entire leadership slate
    // and announce a race for each. No seats at all is a failed read, not a
    // chamber that lost every member.
    seed([{ role: "speaker_of_the_house", characterId: speakerId }], []);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });

  it("ignores a chair that is already vacant, so it cannot re-open a race forever", async () => {
    // A race nobody enters resolves by vacating the role and closing. Keying on
    // "the holder lost their seat" rather than "the seat is empty" is what stops
    // that from reading as a fresh vacancy on the next turn.
    seed([{ role: "speaker_of_the_house", characterId: null as never }], [seatedId]);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });
});
