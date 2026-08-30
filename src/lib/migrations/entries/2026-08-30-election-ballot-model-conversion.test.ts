import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-30-election-ballot-model-conversion";

const cursor = <T>(docs: T[]) => ({
  toArray: async () => docs,
  sort: () => cursor(docs),
  project: () => cursor(docs),
});

function setupGeneral(db: ReturnType<typeof createMockDb>) {
  const electionId = new ObjectId();
  db.collection("gameState");
  db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: 30 });
  db.collection("elections");
  db.collectionMocks.elections!.find.mockReturnValue(
    cursor([
      {
        _id: electionId,
        countryId: "US",
        electionType: "senate",
        state: "PA",
        status: "active",
        startTurn: 0,
        primaryEndTurn: 26,
        endTurn: 74, // 48-turn general, 5 turns banked
      },
    ]) as never
  );
  db.collection("electionVoteTallies");
  const snap = (turn: number, a: number, b: number) => ({
    turn,
    recordedAt: new Date(),
    cumulativeVotes: { a, b },
    sharesPct: { a: 60, b: 40 },
  });
  db.collectionMocks.electionVoteTallies!.find.mockReturnValue(
    cursor([
      {
        _id: electionId,
        electionId,
        state: "PA",
        totalVotes: { a: 3_000, b: 2_000 },
        candidateNames: {},
        candidateParties: {},
        finalized: false,
        // Turn 28 was banked twice by a stalled-turn re-run.
        turnSnapshots: [
          snap(26, 600, 400),
          snap(27, 1_200, 800),
          snap(28, 1_800, 1_200),
          snap(28, 2_400, 1_600),
          snap(29, 3_000, 2_000),
        ],
      },
    ]) as never
  );
  db.collection("states");
  db.collectionMocks.states!.find.mockReturnValue(
    cursor([
      { _id: "PA", countryId: "US", population: 1_000_000, votingEligiblePopulation: 700_000 },
    ]) as never
  );
  db.collection("stateRegistrationPool");
  db.collectionMocks.stateRegistrationPool!.find.mockReturnValue(
    cursor([{ stateId: "PA", countryId: "US", unregistered: 20, independent: 10 }]) as never
  );
  for (const name of [
    "statePartyOrg",
    "stateDemographics",
    "stateDemographicTurnout",
    "demographicCategories",
    "primarySnapshots",
    "electionCandidates",
  ]) {
    db.collection(name);
    db.collectionMocks[name]!.find.mockReturnValue(cursor([]) as never);
  }
  return electionId;
}

describe(migration.id, () => {
  it("is a read-only no-op without a game clock", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue(null);
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(result.notes?.[0]).toContain("skipped");
    expect(db.collectionMocks.electionVoteTallies).toBeUndefined();
  });

  it("reports the conversion without writing in dry-run mode", async () => {
    const db = createMockDb();
    setupGeneral(db);
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(result.documentsScanned).toBe(1);
    expect(result.notes?.join("\n")).toContain("generals converted 1");
    expect(result.notes?.join("\n")).toContain("duplicate turn record(s) dropped 1");
    expect(db.collectionMocks.electionVoteTallies!.bulkWrite).not.toHaveBeenCalled();
  });

  it("rescales a banked general to the registered, inclusive-window count and drops the repeat", async () => {
    const db = createMockDb();
    setupGeneral(db);
    db.collectionMocks.electionVoteTallies!.bulkWrite.mockResolvedValue({
      modifiedCount: 1,
      upsertedCount: 0,
    });

    await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.electionVoteTallies!.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    const set = ops[0].updateOne.update.$set;
    // Four distinct turns survive; the re-run of turn 28 is gone.
    expect(set.turnSnapshots.map((s: { turn: number }) => s.turn)).toEqual([26, 27, 28, 29]);
    // Every turn was an early-band slice of a 48-turn general: old weight
    // 0.5/36, new 0.5/37, times the 80% registered share.
    const factor = (36 / 37) * 0.8;
    const expected = Math.round(600 * factor) * 4; // four turns of 600 for "a" (the repeat removed)
    expect(set.totalVotes.a).toBe(expected);
    // Shares are untouched by a uniform per-turn factor.
    expect(set.turnSnapshots[3].sharesPct).toEqual({ a: 60, b: 40 });
    expect(set.ballotModelVersion).toBe(1);
  });

  it("skips a tally that was already converted", async () => {
    const db = createMockDb();
    const electionId = setupGeneral(db);
    db.collectionMocks.electionVoteTallies!.find.mockReturnValue(
      cursor([
        {
          _id: electionId,
          electionId,
          totalVotes: { a: 1 },
          turnSnapshots: [
            { turn: 26, recordedAt: new Date(), cumulativeVotes: { a: 1 }, sharesPct: { a: 100 } },
          ],
          finalized: false,
          ballotModelVersion: 1,
        },
      ]) as never
    );
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(result.notes?.join("\n")).toContain("generals converted 0");
    expect(db.collectionMocks.electionVoteTallies!.bulkWrite).not.toHaveBeenCalled();
  });
});
