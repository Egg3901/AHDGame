import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/election/presidentExecutiveSeating", () => ({
  seatPresidentialExecutive: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/elections/liveResults/captureResultSnapshot", () => ({
  captureElectionResultSnapshot: vi.fn().mockResolvedValue(undefined),
}));
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { resolveBrazilPresidentialElection } from "./resolvePresidentialElection";

let db: MockDb;
const now = new Date("2026-10-04T03:00:00Z");
const election = {
  _id: new ObjectId(),
  countryId: "BR",
  electionType: "president",
  state: "BR",
  cycle: 1,
  status: "completed",
} as Election;
const candidates = [1, 2, 3].map((party) => ({
  _id: new ObjectId(),
  electionId: election._id,
  countryId: "BR",
  nppId: new ObjectId(),
  isNPP: true,
  party: String(party),
  characterName: `Candidate ${party}`,
  status: "active",
})) as ElectionCandidate[];
const totals = Object.fromEntries(candidates.map((c, i) => [String(c._id), [40, 35, 25][i]]));
const tally = {
  _id: new ObjectId(),
  electionId: election._id,
  totalVotes: totals,
  candidateParties: Object.fromEntries(candidates.map((c) => [String(c._id), c.party])),
} as ElectionVoteTally;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
  db.collection("electionCandidates").find().toArray.mockResolvedValue(candidates);
});

describe("Brazil presidential pipeline", () => {
  it("finishes interrupted cleanup without seating a finalized executive twice", async () => {
    expect(
      await resolveBrazilPresidentialElection(
        db as unknown as Db,
        election,
        { ...tally, finalized: true, executiveSeatingPending: false },
        now,
        192
      )
    ).toBe(true);
    expect(seatPresidentialExecutive).not.toHaveBeenCalled();
  });
  it("opens a fresh runoff with only the two finalists and no executive handover", async () => {
    expect(
      await resolveBrazilPresidentialElection(db as unknown as Db, election, tally, now, 192)
    ).toBe(true);
    expect(seatPresidentialExecutive).not.toHaveBeenCalled();
    const race = db.collection("elections").updateOne.mock.calls[0][1].$setOnInsert;
    expect(race.brazilPresidentialRound).toBe(2);
    expect(race.endTurn).toBe(216);
    expect(race.primaryEndTurn).toBe(192);
    const fresh = db.collection("electionVoteTallies").replaceOne.mock.calls[0][1];
    expect(Object.values(fresh.totalVotes)).toEqual([0, 0]);
    expect(Object.values(fresh.candidateParties)).toEqual(["1", "2"]);
    expect(fresh.primaryResults).toBeDefined();
  });
  it("seats the second-round winner rather than reusing the first-round leader", async () => {
    const votes = { [String(candidates[0]._id)]: 49, [String(candidates[1]._id)]: 51 };
    expect(
      await resolveBrazilPresidentialElection(
        db as unknown as Db,
        { ...election, brazilPresidentialRound: 2 },
        { ...tally, totalVotes: votes },
        now,
        216
      )
    ).toBe(true);
    expect(seatPresidentialExecutive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ winnerCandidate: candidates[1], turn: 216 })
    );
  });
  it("uses congressional seats for 1979 instead of the unrelated popular tally", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1979-default" });
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { party: "2", nppId: new ObjectId(), seatsHeld: 300 },
        { party: "1", nppId: new ObjectId(), seatsHeld: 200 },
      ]);
    await resolveBrazilPresidentialElection(db as unknown as Db, election, tally, now, 336);
    expect(seatPresidentialExecutive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ winnerCandidate: candidates[1] })
    );
  });
  it("retains a certified decision after interrupted seating without recounting changed support", async () => {
    const certified = {
      ...tally,
      brazilPresidentialResult: { outcome: "won" as const, winnerId: String(candidates[1]._id) },
    };
    await resolveBrazilPresidentialElection(db as unknown as Db, election, certified, now, 192);
    expect(seatPresidentialExecutive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ winnerCandidate: candidates[1] })
    );
  });
});
