import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processGeneralTenure } from "./generalTenure";
import { TENURE_POINT_TURNS } from "@/lib/military/generals";

function doc(over: Record<string, unknown> = {}) {
  return {
    characterId: "c1",
    commissioned: true,
    general: { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 0 },
    ...over,
  };
}

describe("processGeneralTenure", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("characterGenerals");
    db.collectionMocks.characterGenerals.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
  });

  const seed = (docs: unknown[]) =>
    db.collectionMocks.characterGenerals.find.mockReturnValue({ toArray: async () => docs });

  it("pays a commissioned general a point per year of service", async () => {
    seed([doc()]);
    const out = await processGeneralTenure(db as unknown as Db, TENURE_POINT_TURNS * 2);
    expect(out).toEqual({ updated: 1, pointsGranted: 2 });
    const op = db.collectionMocks.characterGenerals.bulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.general.pts).toBe(2);
    expect(op.updateOne.update.$set.general.lastTenurePointTurn).toBe(TENURE_POINT_TURNS * 2);
  });

  // A dismissed officer keeps their record for re-appointment but is not serving,
  // and must not be paid for the years they sat out.
  it("does not pay a dismissed general", async () => {
    seed([doc({ commissioned: false })]);
    const out = await processGeneralTenure(db as unknown as Db, TENURE_POINT_TURNS * 5);
    expect(out).toEqual({ updated: 0, pointsGranted: 0 });
    expect(db.collectionMocks.characterGenerals.bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing on a turn where nobody is owed anything", async () => {
    seed([doc({ general: { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 10 } })]);
    const out = await processGeneralTenure(db as unknown as Db, 11);
    expect(out).toEqual({ updated: 0, pointsGranted: 0 });
    expect(db.collectionMocks.characterGenerals.bulkWrite).not.toHaveBeenCalled();
  });

  // Every profile predating tenure accrual has no marker. Starting their clock is a
  // write but not a payout — back-paying would hand out a career's points at once.
  it("starts the clock for a general with no marker without paying them", async () => {
    seed([doc({ general: { level: 1, xp: 0, pts: 0 } })]);
    const out = await processGeneralTenure(db as unknown as Db, 400);
    expect(out).toEqual({ updated: 1, pointsGranted: 0 });
    const op = db.collectionMocks.characterGenerals.bulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$set.general.pts).toBe(0);
    expect(op.updateOne.update.$set.general.lastTenurePointTurn).toBe(400);
  });

  it("skips a commission record that carries no general profile", async () => {
    seed([doc({ general: undefined })]);
    const out = await processGeneralTenure(db as unknown as Db, 400);
    expect(out).toEqual({ updated: 0, pointsGranted: 0 });
  });
});
