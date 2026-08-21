import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();

function live(over: Record<string, unknown> = {}) {
  return { _id: CRISIS_ID, status: "open", conflictId: null, ...over };
}

describe("closeSettlementCrisis", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").findOne.mockResolvedValue(live());
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("refuses when nothing is live", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    const { closeSettlementCrisis } = await import("./closeCrisis");
    const res = await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res).toMatchObject({ closed: false, reason: "No settlement crisis is live." });
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("marks the crisis cancelled with no outcome", async () => {
    const { closeSettlementCrisis } = await import("./closeCrisis");
    const res = await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res.closed).toBe(true);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: "cancelled",
      outcome: null,
      resolvedTurn: 412,
      cooldownUntilTurn: null,
    });
  });

  it("leaves NOTHING for the actuation sweep to enact", async () => {
    // The whole meaning of "as if it never started": the sweep looks for
    // `status: "resolved"`, and a cancelled crisis is not that. A cancelled
    // crisis carrying `outcome: "challenger"` would merge two countries a turn
    // after an admin called the question off.
    const { closeSettlementCrisis } = await import("./closeCrisis");
    await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set.status).not.toBe("resolved");
    expect(update.$set.outcome).toBeNull();
  });

  it("guards on the status it read, so a tick that resolved it first wins", async () => {
    const { closeSettlementCrisis } = await import("./closeCrisis");
    await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: CRISIS_ID, status: "open" });
  });

  it("reports a lost race instead of claiming it closed", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { closeSettlementCrisis } = await import("./closeCrisis");
    const res = await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res.closed).toBe(false);
    expect(res.reason).toContain("changed state");
  });

  it("closes a frozen crisis and names the war it leaves behind", async () => {
    // The conflict is real — combatants, occupations, history. Cancelling the
    // question must not silently erase it, so the caller is told.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      live({ status: "frozen", conflictId: "gq_de_400" })
    );
    const { closeSettlementCrisis } = await import("./closeCrisis");
    const res = await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res).toMatchObject({ closed: true, orphanedConflictId: "gq_de_400" });
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter.status).toBe("frozen");
  });

  it("reports no orphan when the crisis never went to war", async () => {
    const { closeSettlementCrisis } = await import("./closeCrisis");
    expect(
      (await closeSettlementCrisis(db as unknown as Db, { turn: 412 })).orphanedConflictId
    ).toBeNull();
  });

  it("does not delete the crisis or its plays", async () => {
    // The plays are the record of what players really spent. A delete would
    // strand them pointing at a document that no longer exists.
    const { closeSettlementCrisis } = await import("./closeCrisis");
    await closeSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(prime(db, "settlementCrises").deleteOne).not.toHaveBeenCalled();
    expect(prime(db, "settlementCrises").deleteMany).not.toHaveBeenCalled();
    expect(prime(db, "settlementPlays").deleteMany).not.toHaveBeenCalled();
  });
});
