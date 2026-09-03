/**
 * The civil-liberties basket write, and specifically what it must NOT do to a
 * board that has no structural residuals yet.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyCivilLibertiesDelta } from "./civilLiberties";
import { DEMOCRATIC_HEALTH_METRIC_IDS } from "@/lib/governanceStyle/score";

const BASKET = DEMOCRATIC_HEALTH_METRIC_IDS;

function board(id: string, withResiduals: boolean) {
  const values: Record<string, number> = { "economy.stability": 50 };
  const residuals: Record<string, number> = { "economy.stability": 7 };
  for (const metricId of BASKET) {
    values[metricId] = 60;
    residuals[metricId] = 5;
  }
  return {
    _id: id,
    countryId: "DD",
    values,
    ...(withResiduals ? { residuals } : {}),
  };
}

describe("applyCivilLibertiesDelta", () => {
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

  it("moves values and residuals together on a board that already has residuals", async () => {
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: async () => [board("SN", true)],
    });
    await applyCivilLibertiesDelta(db as unknown as Db, "DD", -4);
    const [set] = written();
    expect(set.values?.[BASKET[0]]).toBe(56);
    expect(set.residuals?.[BASKET[0]]).toBe(1);
    // Families outside the basket are carried through untouched.
    expect(set.residuals?.["economy.stability"]).toBe(7);
  });

  it("does NOT invent a residuals map on a board that has none", async () => {
    // A board with no residuals is one the dynamics phase has not healed yet —
    // which is now every region for the turn after it changes country, since the
    // transfer drops the field so the heal can re-derive it. Writing a PARTIAL
    // map here (just this basket) would make the doc look healed: the heal only
    // fires on `!residuals`, so it would never run, and every family outside the
    // basket would fall through to an unpersisted per-turn fallback instead of
    // getting a real structural baseline. The value change alone already carries
    // the cost, because the heal derives the baseline from the lowered value.
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: async () => [board("BY", false)],
    });
    await applyCivilLibertiesDelta(db as unknown as Db, "DD", -4);
    const [set] = written();
    expect(set.values?.[BASKET[0]]).toBe(56);
    expect(set).not.toHaveProperty("residuals");
  });

  it("still writes the value change for an unhealed board", async () => {
    db.collectionMocks.politicalMetrics!.find.mockReturnValue({
      toArray: async () => [board("BY", false)],
    });
    const updated = await applyCivilLibertiesDelta(db as unknown as Db, "DD", -4);
    expect(updated).toBe(1);
  });
});
