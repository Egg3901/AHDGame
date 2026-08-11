import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/congress/leadershipElections", () => ({
  vacateCongressLeadershipRole: vi.fn().mockResolvedValue(undefined),
  isLeadershipElectionClosed: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCongressLeadershipTally: vi.fn().mockResolvedValue({ votesFor: 0, votesAgainst: 0 }),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date(0) }),
}));

const HOUSE = { totalSeats: 435 } as never;

async function deps() {
  return {
    resolveSpeakerVacateMotion: (await import("./resolveVacateMotion")).resolveSpeakerVacateMotion,
    vacateThreshold: (await import("./resolveVacateMotion")).vacateThreshold,
    vacate: (await import("@/lib/congress/leadershipElections")).vacateCongressLeadershipRole,
    tally: (await import("@/lib/congress/governmentVoteBreakdown")).computeCongressLeadershipTally,
    closed: (await import("@/lib/congress/leadershipElections")).isLeadershipElectionClosed,
  };
}

describe("resolveSpeakerVacateMotion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("speakerVacateMotions");
    db.collection("speakerNominations");
    db.collection("speakerElections");
  });

  function seedVotingMotion() {
    db.collectionMocks.speakerVacateMotions!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
      votes: {},
      endsAt: new Date(0),
      endsOnTurn: 200,
    });
    db.collectionMocks.speakerVacateMotions!.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.speakerNominations!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.speakerElections!.updateOne.mockResolvedValue({ modifiedCount: 1 });
  }

  it("vacateThreshold is an absolute majority of the chamber", async () => {
    const { vacateThreshold } = await deps();
    expect(vacateThreshold(435)).toBe(218);
    expect(vacateThreshold(100)).toBe(51);
  });

  it("passes at an absolute majority: vacates the chair and opens a new election", async () => {
    seedVotingMotion();
    const { resolveSpeakerVacateMotion, vacate, tally, closed } = await deps();
    vi.mocked(closed).mockReturnValue(false); // window still open
    vi.mocked(tally).mockResolvedValue({ votesFor: 218, votesAgainst: 5, voteByParty: [] });

    const resolved = await resolveSpeakerVacateMotion(db as unknown as Db, HOUSE);

    expect(resolved).toBe(true);
    expect(vacate).toHaveBeenCalledWith(db, "speaker_of_the_house", expect.any(Date));
    // A fresh Speaker election is opened to refill the seat.
    expect(db.collectionMocks.speakerElections!.updateOne).toHaveBeenCalled();
    const setArg = db.collectionMocks.speakerElections!.updateOne.mock.calls[0][1].$set;
    expect(setArg.status).toBe("voting");
  });

  it("does nothing while the window is open and the motion has not passed", async () => {
    seedVotingMotion();
    const { resolveSpeakerVacateMotion, vacate, tally, closed } = await deps();
    vi.mocked(closed).mockReturnValue(false);
    vi.mocked(tally).mockResolvedValue({ votesFor: 100, votesAgainst: 0, voteByParty: [] });

    const resolved = await resolveSpeakerVacateMotion(db as unknown as Db, HOUSE);

    expect(resolved).toBe(false);
    expect(vacate).not.toHaveBeenCalled();
    expect(db.collectionMocks.speakerVacateMotions!.updateOne).not.toHaveBeenCalled();
  });

  it("fails the motion (no vacate) when the window closes short of a majority", async () => {
    seedVotingMotion();
    const { resolveSpeakerVacateMotion, vacate, tally, closed } = await deps();
    vi.mocked(closed).mockReturnValue(true); // window closed
    vi.mocked(tally).mockResolvedValue({ votesFor: 100, votesAgainst: 0, voteByParty: [] });

    const resolved = await resolveSpeakerVacateMotion(db as unknown as Db, HOUSE);

    expect(resolved).toBe(true);
    expect(vacate).not.toHaveBeenCalled();
    const setArg = db.collectionMocks.speakerVacateMotions!.updateOne.mock.calls[0][1].$set;
    expect(setArg.status).toBe("failed");
  });

  it("bails without side effects if it loses the atomic claim", async () => {
    seedVotingMotion();
    db.collectionMocks.speakerVacateMotions!.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const { resolveSpeakerVacateMotion, vacate, tally, closed } = await deps();
    vi.mocked(closed).mockReturnValue(false);
    vi.mocked(tally).mockResolvedValue({ votesFor: 300, votesAgainst: 0, voteByParty: [] });

    const resolved = await resolveSpeakerVacateMotion(db as unknown as Db, HOUSE);

    expect(resolved).toBe(false);
    expect(vacate).not.toHaveBeenCalled();
  });
});
