import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyCrossCountryTrustHit } from "../trustHit";

const FAMILY = "governance.integrity";

function boardDb(value = 60): MockDb {
  const db = createMockDb();
  db.collection("politicalMetrics");
  db.collection("stateMetrics");
  db.collection("politicalMetrics")
    .find()
    .toArray.mockResolvedValue([
      { _id: "KAN", countryId: "JP", values: { [FAMILY]: value }, residuals: { [FAMILY]: 0 } },
    ]);
  return db;
}

function writtenValues(db: MockDb): Record<string, number> {
  const ops = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls[0][0] as Array<{
    updateOne: { update: { $set: { values: Record<string, number> } } };
  }>;
  return ops[0].updateOne.update.$set.values;
}

describe("applyCrossCountryTrustHit", () => {
  it("moves governance.integrity on the board for a board country", async () => {
    // publicTrust maps to governance.integrity through ADAPTER_TIER1; the
    // fractional delta is scaled x100 to legacy units, then converted to board
    // points by the same conversion the legislation bridge uses.
    const db = boardDb(60);
    const r = await applyCrossCountryTrustHit(db as unknown as Db, "JP", -0.3);
    expect(r).toEqual({ statesUpdated: 1 });
    expect(writtenValues(db)[FAMILY]).toBeLessThan(60);
    // Never the legacy store — JP has no doc there any more.
    expect(db.collectionMocks.stateMetrics!.updateMany).not.toHaveBeenCalled();
  });

  it("shifts the VALUE, not the residual — a default fades, it does not redefine the country", async () => {
    // THE modelling decision. Shifting the residual would move the equilibrium
    // and make one default permanently redefine how trustworthy the country is;
    // that is what enacted LAW does. An event damages trust and trust recovers,
    // which is what a value shift gives, because the dynamics phase drifts the
    // value back toward its law-implied target every turn.
    const db = boardDb(60);
    await applyCrossCountryTrustHit(db as unknown as Db, "JP", -0.3);
    const set = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(set[0].updateOne.update.$set.values).toBeDefined();
    expect(set[0].updateOne.update.$set.residuals).toBeUndefined();
  });

  it("recovers on a positive delta (the same channel, both directions)", async () => {
    const db = boardDb(60);
    const r = await applyCrossCountryTrustHit(db as unknown as Db, "JP", 0.05);
    expect(r).toEqual({ statesUpdated: 1 });
    expect(writtenValues(db)[FAMILY]).toBeGreaterThan(60);
  });

  it("scales with the size of the hit", async () => {
    const small = boardDb(60);
    await applyCrossCountryTrustHit(small as unknown as Db, "JP", -0.05);
    const big = boardDb(60);
    await applyCrossCountryTrustHit(big as unknown as Db, "JP", -0.3);
    expect(writtenValues(big)[FAMILY]).toBeLessThan(writtenValues(small)[FAMILY]);
  });

  it("never writes a dotted sub-path, which would silently do nothing", async () => {
    // Board keys are literal dotted strings; `{ $inc: { "values.a.b": d } }`
    // creates a nested object the read side never looks at.
    const db = boardDb(60);
    await applyCrossCountryTrustHit(db as unknown as Db, "JP", -0.3);
    expect(db.collectionMocks.politicalMetrics!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the country has no board docs", async () => {
    // No legacy fallback exists any more — since Phase 3 nothing has a
    // stateMetrics doc, so a fallback would be dead code pretending to be a
    // safety net.
    const db = createMockDb();
    db.collection("politicalMetrics");
    db.collection("stateMetrics");
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    const r = await applyCrossCountryTrustHit(db as unknown as Db, "ZZ" as never, -0.3);
    expect(r).toEqual({ statesUpdated: 0 });
    expect(db.collectionMocks.stateMetrics!.updateMany).not.toHaveBeenCalled();
  });
});
