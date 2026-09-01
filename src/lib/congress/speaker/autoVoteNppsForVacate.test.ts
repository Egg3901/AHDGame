import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { autoVoteNppsForVacateMotion } from "./autoVoteNppsForVacate";
import type { SpeakerVacateMotion } from "@/lib/db/types";

/** rng pinned so the graded branches are deterministic. */
const alwaysLow = () => 0;

const speakerId = new ObjectId();

function makeMotion(overrides: Partial<SpeakerVacateMotion> = {}): SpeakerVacateMotion {
  return {
    _id: "current",
    status: "voting",
    filedById: new ObjectId(),
    filedByName: "Filer",
    targetSpeakerId: speakerId,
    targetSpeakerName: "Sitting Speaker",
    startedAt: new Date("2026-08-31T00:00:00Z"),
    endsAt: new Date("2026-09-02T00:00:00Z"),
    votes: {},
    updatedAt: new Date(),
    ...overrides,
  } as SpeakerVacateMotion;
}

function cursorOf(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

describe("autoVoteNppsForVacateMotion", () => {
  let db: MockDb;
  const oppositionNpp = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "electedOfficials",
      "npps",
      "characters",
      "politicalParties",
      "speakerVacateMotions",
    ]) {
      db.collection(name);
    }

    // One NPP bloc seated in the House, in an opposing major party.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf([{ nppId: oppositionNpp }])
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(
      cursorOf([{ _id: oppositionNpp, party: "2", policies: { economic: 0, social: 0 } }])
    );
    // The Speaker sits for party "1".
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({ party: "1" });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      policies: { economic: 5, social: 5 },
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      cursorOf([
        { sequentialId: 1, tier: "major" },
        { sequentialId: 2, tier: "major" },
      ])
    );
    db.collectionMocks["speakerVacateMotions"]!.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    // The function re-reads the motion after the batch so the tally runs on
    // what actually landed; by default every op is taken to have applied.
    db.collectionMocks["speakerVacateMotions"]!.findOne.mockResolvedValue({
      _id: "current",
      votes: { [`npp_${oppositionNpp.toString()}`]: "for" },
    });
  });

  it("gives a silent opposition bloc a ballot so the all-seats bar is reachable", async () => {
    const votes = await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    expect(votes[`npp_${oppositionNpp.toString()}`]).toBe("for");
    expect(db.collectionMocks["speakerVacateMotions"]!.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("batches the whole chamber into a single round trip", async () => {
    // Resolution is lazy and runs inside a page read, so a write per bloc
    // would stall the Speaker page for every seated bloc.
    const blocs = Array.from({ length: 40 }, () => new ObjectId());
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf(blocs.map((nppId) => ({ nppId })))
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(
      cursorOf(blocs.map((id) => ({ _id: id, party: "2", policies: { economic: 0, social: 0 } })))
    );

    await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    expect(db.collectionMocks["speakerVacateMotions"]!.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = db.collectionMocks["speakerVacateMotions"]!.bulkWrite.mock.calls[0] as [
      unknown[],
    ];
    expect(ops).toHaveLength(40);
  });

  it("writes conditionally so a concurrent whip is never clobbered", async () => {
    await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    const [ops] = db.collectionMocks["speakerVacateMotions"]!.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: Record<string, unknown> } }>,
    ];
    expect(ops[0].updateOne.filter).toMatchObject({
      _id: "current",
      status: "voting",
      [`votes.npp_${oppositionNpp.toString()}`]: { $exists: false },
    });
  });

  it("leaves an already-whipped bloc alone", async () => {
    const nppKey = `npp_${oppositionNpp.toString()}`;
    const votes = await autoVoteNppsForVacateMotion(
      db as unknown as Db,
      makeMotion({ votes: { [nppKey]: "against" } }),
      alwaysLow
    );

    // The whip said keep the Speaker; the heuristic would have said vacate.
    expect(votes[nppKey]).toBe("against");
    expect(db.collectionMocks["speakerVacateMotions"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("votes a bloc once even when it holds several official rows", async () => {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf([{ nppId: oppositionNpp }, { nppId: oppositionNpp }])
    );

    await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    const [ops] = db.collectionMocks["speakerVacateMotions"]!.bulkWrite.mock.calls[0] as [
      unknown[],
    ];
    expect(ops).toHaveLength(1);
  });

  it("defends a Speaker of the bloc's own party", async () => {
    db.collectionMocks["npps"]!.find.mockReturnValue(
      cursorOf([{ _id: oppositionNpp, party: "1", policies: { economic: 0, social: 0 } }])
    );

    await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    const [ops] = db.collectionMocks["speakerVacateMotions"]!.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>,
    ];
    expect(ops[0].updateOne.update.$set[`votes.npp_${oppositionNpp.toString()}`]).toBe("against");
  });

  it("does nothing on a motion that is no longer open", async () => {
    const votes = await autoVoteNppsForVacateMotion(
      db as unknown as Db,
      makeMotion({ status: "passed" }),
      alwaysLow
    );

    expect(votes).toEqual({});
    expect(db.collectionMocks["speakerVacateMotions"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("returns the existing votes untouched when the House holds no NPP blocs", async () => {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(cursorOf([]));

    const votes = await autoVoteNppsForVacateMotion(
      db as unknown as Db,
      makeMotion({ votes: { someCharacter: "for" } }),
      alwaysLow
    );

    expect(votes).toEqual({ someCharacter: "for" });
    expect(db.collectionMocks["speakerVacateMotions"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("reports only what the re-read shows, not what it tried to write", async () => {
    // A guard rejected the op (a whip landed first), so the motion holds no
    // ballot for this bloc and the tally must not be told otherwise.
    db.collectionMocks["speakerVacateMotions"]!.findOne.mockResolvedValue({
      _id: "current",
      votes: {},
    });

    const votes = await autoVoteNppsForVacateMotion(db as unknown as Db, makeMotion(), alwaysLow);

    expect(votes[`npp_${oppositionNpp.toString()}`]).toBeUndefined();
  });
});
