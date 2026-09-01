import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";

const { actuateSettlementOutcome } = vi.hoisted(() => ({
  actuateSettlementOutcome: vi.fn(async (..._a: unknown[]) => ({
    actuated: true,
    outcome: "challenger",
    deferred: false,
  })),
}));
vi.mock("@/lib/settlement/actuate", () => ({ actuateSettlementOutcome }));

import { reunifyByPeaceTerm } from "./reunifyByPeaceTerm";

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "frozen",
    conflictId: "war_us_dd_415",
    cooldownUntilTurn: null,
    ...over,
  } as SettlementCrisisDoc;
}

describe("reunifyByPeaceTerm", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    prime(db, "settlementCrises").findOne.mockResolvedValue(crisis());
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("resolves the crisis for the CHALLENGER", async () => {
    await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect((update as { $set: Record<string, unknown> }).$set).toMatchObject({
      status: "resolved",
      outcome: "challenger",
      resolvedTurn: 533,
    });
  });

  it("claims it guarded on `frozen`, so two roads cannot both actuate", async () => {
    await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: CRISIS_ID, status: "frozen" });
  });

  it("only looks at a crisis riding THIS war", async () => {
    // createMockDb ignores filters, so the filter itself is the assertion.
    await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    const [filter] = prime(db, "settlementCrises").findOne.mock.calls[0];
    expect(filter).toMatchObject({ conflictId: "war_us_dd_415", status: "frozen" });
  });

  it("actuates the RESOLVED crisis, not the frozen one it read", async () => {
    // actuateSettlementOutcome refuses anything that is not already resolved with an
    // outcome, so handing it the document as read would silently do nothing.
    await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    const [, passed] = actuateSettlementOutcome.mock.calls[0] as [unknown, SettlementCrisisDoc];
    expect(passed.status).toBe("resolved");
    expect(passed.outcome).toBe("challenger");
  });

  it("does nothing when no question is riding that war", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    const r = await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    expect(r.actuated).toBe(false);
    expect(actuateSettlementOutcome).not.toHaveBeenCalled();
  });

  it("actuates nothing when another road claimed the crisis first", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const r = await reunifyByPeaceTerm(db as unknown as Db, "war_us_dd_415", 533);
    expect(r.actuated).toBe(false);
    expect(actuateSettlementOutcome).not.toHaveBeenCalled();
  });
});
