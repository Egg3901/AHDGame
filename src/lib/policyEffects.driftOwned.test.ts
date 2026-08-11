import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

/**
 * Regression guard: `governance.independenceDesire` is owned exclusively by the
 * dedicated drift engine (`src/lib/turn/independenceDesireDrift.ts`). The policy-
 * effects engine iterates every metric DEFINITION, so — because the field stays
 * registered in metricDefinitions for display/scoring — it used to also decay
 * independenceDesire toward its default-50 baseline every turn, fighting the
 * drift engine to a standstill (the live SCO/WAL freeze). It must now skip it.
 *
 * See docs/design/uk-independence-desire-ownership-fix.md (Follow-up section).
 */

/** Configure a collection's `find().toArray()` and `findOne`. */
function setCollection(
  db: MockDb,
  name: string,
  docs: unknown[],
  findOneDoc: unknown = null
): void {
  const coll = db.collection(name);
  coll.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
  if (findOneDoc !== null) coll.findOne.mockResolvedValue(findOneDoc);
}

describe("processStatePolicyEffects — drift-owned metric exclusion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    // Both metrics displaced 10 points above their (default-50) target so
    // the policy-decay engine would write BOTH absent the ownership guard.
    // SP4: the UK is country-gated out of this engine entirely, so the
    // drift-ownership exclusion is exercised on a non-playable fixture — the
    // guard is generic (any country whose doc carried the metric).
    setCollection(db, "gameState", [], { _id: "current", currentTurn: 100 });
    setCollection(db, "states", [{ _id: "WAL", countryId: "IE" }]);
    setCollection(db, "statePolicies", []);
    setCollection(db, "legislationTypes", []);
    setCollection(db, "stateMetrics", [
      {
        _id: "WAL",
        governance: {
          independenceDesire: { value: 60, trend: 0 },
          publicTrust: { value: 60 },
        },
      },
    ]);
    // No `independenceDesire` baseline → defaults to 50. publicTrust baseline 50.
    setCollection(db, "stateBaselines", [
      { _id: "WAL", baselines: { governance: { publicTrust: 50 } } },
    ]);
  });

  async function runAndGetWrittenKeys(): Promise<string[]> {
    const { processStatePolicyEffects } = await import("./policyEffects");
    await processStatePolicyEffects(db as unknown as Db);
    const bulk = db.collectionMocks.stateMetrics!.bulkWrite;
    if (bulk.mock.calls.length === 0) return [];
    const ops = bulk.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    return ops.flatMap((op) => Object.keys(op.updateOne.update.$set));
  }

  it("does NOT write governance.independenceDesire (drift engine owns it)", async () => {
    const keys = await runAndGetWrittenKeys();
    expect(keys).not.toContain("governance.independenceDesire.value");
  });

  it("writes nothing at all for a BOARD country (step-6 Phase 3)", async () => {
    // The fixture is IE, which has a political board. The legacy decay/policy
    // loop skips every board country now: their metrics live on the board,
    // whose sole animator is the dynamics phase, so running this loop for them
    // would fight that phase over the same numbers. The drift-owned exclusion
    // above still holds — it is simply subsumed by the country-level skip.
    const keys = await runAndGetWrittenKeys();
    expect(keys).toEqual([]);
  });
});
