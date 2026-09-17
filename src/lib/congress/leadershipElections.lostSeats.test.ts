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

  /**
   * `leaders` hold the named roles; `seatedHolders` are the ones the seat query
   * finds still sitting. `chamberSeatCount` is how many seats the House has at
   * all, which is what separates "this holder lost their seat" from "the read
   * came back empty".
   */
  function seed(
    leaders: Array<{ role: string; characterId: ObjectId; characterName?: string }>,
    seatedHolders: ObjectId[],
    chamberSeatCount = 435
  ) {
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(leaders),
    } as never);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(seatedHolders.map((id) => ({ officeType: "house", characterId: id }))),
    } as never);
    db.collectionMocks["electedOfficials"]!.countDocuments.mockResolvedValue(chamberSeatCount);
  }

  it("reads only the holders' seat rows, never the whole chamber", async () => {
    // This runs every turn now. Scanning every house/senate/bundestag/npcDelegate
    // official hourly is thousands of documents for a question about at most
    // thirteen people — CN alone seats ~2,980 delegates.
    seed([{ role: "speaker_of_the_house", characterId: speakerId }], [speakerId]);

    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");
    await vacateLeadershipForLostSeats(db as unknown as Db);

    const [filter, options] = db.collectionMocks["electedOfficials"]!.find.mock.calls[0]!;
    expect(JSON.stringify(filter)).toContain(speakerId.toString());
    expect(options?.projection).toBeDefined();
  });

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

  it("counts an NPP-held seat row as seating its NPP holder", async () => {
    // An NPP-held chair stores the NPP id in `congressLeaders.characterId`, and
    // its seat row carries that id under `nppId`. Reading only one id per row
    // would leave the holder looking seatless and vacate a chair that is filled.
    const nppId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ role: "chair_npcsc", characterId: nppId }]),
    } as never);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ officeType: "npcDelegate", characterId: null, nppId }]),
    } as never);
    db.collectionMocks["electedOfficials"]!.countDocuments.mockResolvedValue(2980);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });

  it("counts both ids on a seat row that carries a character and an NPP", async () => {
    // The sweep this replaced registered both, and narrowing that to one would
    // vacate a filled chair whose row happens to carry the other id too.
    const nppId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ role: "chair_npcsc", characterId: nppId }]),
    } as never);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ officeType: "npcDelegate", characterId: seatedId, nppId }]),
    } as never);
    db.collectionMocks["electedOfficials"]!.countDocuments.mockResolvedValue(2980);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });

  it("leaves a leader who still holds their seat alone", async () => {
    seed([{ role: "speaker_of_the_house", characterId: speakerId }], [speakerId, seatedId]);

    const { vacateAllLeadershipRoles } =
      await import("@/lib/congress/leadership/reconcilePartyEligibility");
    const { vacateLeadershipForLostSeats } = await import("./leadershipElections");

    expect(await vacateLeadershipForLostSeats(db as unknown as Db)).toBe(0);
    expect(vacateAllLeadershipRoles).not.toHaveBeenCalled();
  });

  it("vacates nothing when the chamber holds no seats at all", async () => {
    // Running every turn rather than only after a general means a transient
    // empty read would otherwise vacate the chamber's entire leadership slate
    // and announce a race for each. No seats at all is a failed read, not a
    // chamber that lost every member.
    seed([{ role: "speaker_of_the_house", characterId: speakerId }], [], 0);

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
