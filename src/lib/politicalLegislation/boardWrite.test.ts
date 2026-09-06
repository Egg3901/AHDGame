import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyBoardDelta, applyBoardValueDeltasByRegion } from "./boardWrite";

const FAMILY = "governance.integrity";

function doc(id: string, value: number, residual?: number) {
  return {
    _id: id,
    countryId: "JP",
    values: { [FAMILY]: value, "economy.stability": 50 },
    ...(residual != null ? { residuals: { [FAMILY]: residual } } : {}),
  };
}

describe("applyBoardDelta", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalMetrics");
  });

  function written(): Array<{
    values?: Record<string, number>;
    residuals?: Record<string, number>;
  }> {
    const calls = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls;
    if (calls.length === 0) return [];
    return (calls[0][0] as Array<{ updateOne: { update: { $set: Record<string, never> } } }>).map(
      (op) => op.updateOne.update.$set
    );
  }

  it("writes the WHOLE values object, never a dotted sub-path", async () => {
    // The bug this module exists to prevent: board keys are literal dotted
    // strings, so `{ $inc: { "values.governance.integrity": d } }` creates a
    // nested object and the read side never sees it. A whole-object rewrite is
    // the only unambiguous way to move one family.
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("KAN", 60)]);
    await applyBoardDelta(db as unknown as Db, { countryId: "JP" }, FAMILY, -10, "value");
    const set = written()[0];
    expect(set.values![FAMILY]).toBe(50);
    // Siblings survive the rewrite.
    expect(set.values!["economy.stability"]).toBe(50);
    expect(db.collectionMocks.politicalMetrics!.updateMany).not.toHaveBeenCalled();
  });

  it("clamps a VALUE into 0-100", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("A", 5), doc("B", 96)]);
    await applyBoardDelta(db as unknown as Db, {}, FAMILY, -20, "value");
    expect(written()[0].values![FAMILY]).toBe(0); // A: 5 - 20 floors at 0
    expect(written()[1].values![FAMILY]).toBe(76); // B: 96 - 20
    // Second run is a separate invocation — clear so `written()` reads it.
    db.collectionMocks.politicalMetrics!.bulkWrite.mockClear();
    await applyBoardDelta(db as unknown as Db, {}, FAMILY, 20, "value");
    expect(written()[0].values![FAMILY]).toBe(25); // A: 5 + 20
    expect(written()[1].values![FAMILY]).toBe(100); // B: 96 + 20 ceils at 100
  });

  it("does NOT clamp a residual — it is a signed gap", async () => {
    // Clamping would quietly cap how far a structural effect can push; the
    // composed target is clamped at read time by composeTarget instead.
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("KAN", 60, -80)]);
    await applyBoardDelta(db as unknown as Db, {}, FAMILY, -50, "residual");
    expect(written()[0].residuals![FAMILY]).toBe(-130);
  });

  it("leaves an unhealed doc alone in residual mode", async () => {
    // No residuals yet → the dynamics phase heals it to `value - lawTarget` on
    // its next touch. Pre-empting that would bake this delta into what is meant
    // to be the reset-time structural gap.
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("KAN", 60)]);
    const r = await applyBoardDelta(db as unknown as Db, {}, FAMILY, -5, "residual");
    expect(r.regionsUpdated).toBe(0);
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
  });

  it("no-ops on a zero or non-finite delta, and on an empty match", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("KAN", 60)]);
    expect(await applyBoardDelta(db as unknown as Db, {}, FAMILY, 0, "value")).toEqual({
      regionsUpdated: 0,
    });
    expect(await applyBoardDelta(db as unknown as Db, {}, FAMILY, Number.NaN, "value")).toEqual({
      regionsUpdated: 0,
    });
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    expect(await applyBoardDelta(db as unknown as Db, {}, FAMILY, -5, "value")).toEqual({
      regionsUpdated: 0,
    });
  });

  it("skips a region whose family is already at the clamp", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([doc("KAN", 0)]);
    const r = await applyBoardDelta(db as unknown as Db, {}, FAMILY, -5, "value");
    expect(r.regionsUpdated).toBe(0);
  });
});

describe("applyBoardValueDeltasByRegion", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalMetrics");
  });

  it("applies every region's deltas in one read and one write, clamping step by step", async () => {
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: async () => [doc("JP-13", 98), doc("JP-27", 50), doc("JP-01", 50)],
    });

    const result = await applyBoardValueDeltasByRegion(
      db as unknown as Db,
      new Map([
        // 98 + 5 clamps to 100, then -1 lands on 99: sequential clamping, not summed.
        [
          "JP-13",
          [
            { familyId: FAMILY, scoreDelta: 5 },
            { familyId: FAMILY, scoreDelta: -1 },
          ],
        ],
        ["JP-27", [{ familyId: "economy.stability", scoreDelta: 2.5 }]],
        // A zero delta and an unknown family change nothing, so the region is skipped.
        [
          "JP-01",
          [
            { familyId: FAMILY, scoreDelta: 0 },
            { familyId: "no.such", scoreDelta: 3 },
          ],
        ],
      ])
    );

    expect(result).toEqual({ regionsUpdated: 2 });
    expect(db.collectionMocks.politicalMetrics!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.politicalMetrics!.find.mock.calls[0][0]).toEqual({
      _id: { $in: ["JP-13", "JP-27", "JP-01"] },
    });
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { values: Record<string, number> } } };
    }>;
    expect(ops.map((op) => op.updateOne.filter._id)).toEqual(["JP-13", "JP-27"]);
    expect(ops[0]!.updateOne.update.$set.values).toEqual({
      [FAMILY]: 99,
      "economy.stability": 50,
    });
    expect(ops[1]!.updateOne.update.$set.values).toEqual({
      [FAMILY]: 50,
      "economy.stability": 52.5,
    });
  });

  it("does nothing for an empty map", async () => {
    await applyBoardValueDeltasByRegion(db as unknown as Db, new Map());
    expect(db.collectionMocks.politicalMetrics!.find).not.toHaveBeenCalled();
  });
});
