import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

// The payload builder has its own tests. Here it is a seam, so the backfill can
// be observed without standing up the whole results computation.
const buildResultsPayload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/elections/liveResults/buildResultsPayload", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/elections/liveResults/buildResultsPayload")>();
  return { ...actual, buildResultsPayload };
});

import { migration } from "./2026-09-20-election-result-snapshots";

const presidential = {
  _id: new ObjectId(),
  countryId: "US",
  electionType: "president",
  state: "US",
  status: "resolved",
  cycle: 3,
  electionYear: 1960,
  totalSeats: 0,
  startTurn: 1,
  endTurn: 2,
};

/** Already captured on a previous run, so a re-run must skip it. */
const alreadyCaptured = {
  ...presidential,
  _id: new ObjectId(),
  cycle: 4,
  electionYear: 1964,
};

/** Ended, but never recorded a vote, so there is nothing to freeze. */
const noTally = {
  ...presidential,
  _id: new ObjectId(),
  cycle: 5,
  electionYear: 1968,
};

/** Delegation size retained by the House race that ran alongside 1960. */
const historicalHouse = {
  _id: new ObjectId(),
  countryId: "US",
  electionType: "house",
  state: "CA",
  status: "resolved",
  cycle: 3,
  electionYear: 1960,
  totalSeats: 30,
};

function payloadFor(id: ObjectId) {
  return {
    election: {
      id: id.toString(),
      countryId: "US",
      electionType: "president",
      state: "US",
      status: "resolved",
      cycle: 3,
      electionYear: 1960,
      currentTurn: 0,
      startTurn: 1,
      endTurn: 2,
      totalSeats: 0,
      evNeeded: 266,
      totalEv: 531,
      finalHour: null,
    },
    candidates: [],
    units: [],
    national: null,
    summary: {
      totalVotes: 0,
      unitsReporting: 0,
      totalUnits: 0,
      unitsCalled: 0,
      projectedWinner: null,
    },
    isAdmin: false,
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };
}

function cursor(rows: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function mockDb() {
  const createIndex = vi.fn().mockResolvedValue("ok");
  const bulkWrite = vi.fn().mockImplementation(async (ops: unknown[]) => ({
    insertedCount: 0,
    upsertedCount: ops.length,
  }));
  const db = {
    collection: (name: string) => {
      switch (name) {
        case "electionResultSnapshots":
          return {
            createIndex,
            bulkWrite,
            find: () => cursor([{ electionId: alreadyCaptured._id }]),
          };
        case "elections":
          return {
            find: () => cursor([presidential, alreadyCaptured, noTally, historicalHouse]),
          };
        case "electionVoteTallies":
          return {
            find: () =>
              cursor([{ electionId: presidential._id }, { electionId: alreadyCaptured._id }]),
          };
        case "gameState":
          return {
            findOne: vi
              .fn()
              .mockResolvedValue({ _id: "current", currentTurn: 900, preset: "1953-default" }),
          };
        default:
          return { find: () => cursor([]), findOne: vi.fn().mockResolvedValue(null) };
      }
    },
  } as unknown as Db;
  return { db, createIndex, bulkWrite };
}

beforeEach(() => {
  buildResultsPayload.mockReset();
  buildResultsPayload.mockImplementation(async (_db: unknown, election: { _id: ObjectId }) =>
    payloadFor(election._id)
  );
});

describe("2026-09-20-election-result-snapshots migration", () => {
  it("is idempotent, because a re-run must skip what it already captured", () => {
    expect(migration.id).toBe("2026-09-20-election-result-snapshots");
    expect(migration.idempotent).toBe(true);
  });

  it("creates the unique electionId index BEFORE writing anything", async () => {
    // The unique index is what makes the capture at resolution idempotent, and
    // building it first means a half-finished run cannot leave duplicates
    // behind for the second run to trip on.
    const { db, createIndex, bulkWrite } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledWith(
      { electionId: 1 },
      expect.objectContaining({ unique: true })
    );
    expect(createIndex.mock.invocationCallOrder[0]).toBeLessThan(
      bulkWrite.mock.invocationCallOrder[0]
    );
  });

  it("indexes the history browse path as well", async () => {
    const { db, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });
    expect(createIndex).toHaveBeenCalledWith(
      { countryId: 1, electionType: 1, cycle: -1 },
      expect.objectContaining({ name: expect.any(String) })
    );
  });

  it("scores each race against its own year, not the world's", async () => {
    // This is the whole point of the backfill. Rebuilding a 1960 race against
    // the current map hands it a college that was never in force.
    const { db } = mockDb();
    await migration.execute(db, { dryRun: false });
    expect(buildResultsPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: presidential._id }),
      expect.anything(),
      expect.objectContaining({ apportionmentYear: 1960 })
    );
  });

  it("reconstructs presidential state weights from that year's House races", async () => {
    const { db } = mockDb();
    await migration.execute(db, { dryRun: false });
    expect(buildResultsPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: presidential._id }),
      expect.anything(),
      expect.objectContaining({ houseSeatsByState: { CA: 30 } })
    );
  });

  it("skips a race that already has a snapshot", async () => {
    const { db, bulkWrite } = mockDb();
    await migration.execute(db, { dryRun: false });
    const inserted = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $setOnInsert: { electionId: ObjectId } } };
    }>;
    const ids = inserted.map((op) => op.updateOne.update.$setOnInsert.electionId.toString());
    expect(ids).not.toContain(alreadyCaptured._id.toString());
  });

  it("skips a race that never recorded a vote", async () => {
    const { db, bulkWrite } = mockDb();
    await migration.execute(db, { dryRun: false });
    const inserted = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $setOnInsert: { electionId: ObjectId } } };
    }>;
    const ids = inserted.map((op) => op.updateOne.update.$setOnInsert.electionId.toString());
    expect(ids).toEqual([presidential._id.toString()]);
  });

  it("writes unordered, so one bad row cannot abort the batch", async () => {
    const { db, bulkWrite } = mockDb();
    await migration.execute(db, { dryRun: false });
    expect(bulkWrite.mock.calls[0][1]).toMatchObject({ ordered: false });
  });

  it("upserts with setOnInsert so a concurrent capture is a no-op", async () => {
    const { db, bulkWrite } = mockDb();
    await migration.execute(db, { dryRun: false });
    const [op] = bulkWrite.mock.calls[0][0];
    expect(op.updateOne).toMatchObject({
      filter: { electionId: presidential._id },
      upsert: true,
      update: { $setOnInsert: { electionId: presidential._id } },
    });
  });

  it("keeps going when one race fails to rebuild, and says which", async () => {
    const { db, bulkWrite } = mockDb();
    buildResultsPayload.mockRejectedValueOnce(new Error("tally is corrupt"));
    const res = await migration.execute(db, { dryRun: false });
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(res.notes?.join(" ")).toContain("tally is corrupt");
  });

  it("writes nothing on a dry run, and reports what it would do", async () => {
    const { db, createIndex, bulkWrite } = mockDb();
    const res = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
    const notes = res.notes?.join("\n") ?? "";
    expect(notes).toContain("Would write 1 snapshot");
    // The pinned year is the thing a reviewer needs to eyeball before applying.
    expect(notes).toContain("1960");
  });
});
