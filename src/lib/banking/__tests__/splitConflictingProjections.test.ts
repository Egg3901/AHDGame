import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { resumeSettlement, settleTransition } from "../settlementJournal";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const BOND = new ObjectId("650000000000000000000501");
const BANK = new ObjectId("650000000000000000000502");

describe("a projection that pulls from and pushes to one array", () => {
  it("is split in the journal on recovery and both halves land once", async () => {
    const memory = createInMemoryDb();
    memory.seed("bonds", [
      {
        _id: BOND,
        holders: [{ bankId: BANK, units: 5, bankTreasuryTradeId: "trade-1" }],
      },
    ]);
    const db = memory as unknown as Db;
    // The first attempt dies before its projection writes, as MongoDB's
    // conflict error does: nothing on the bond changes.
    const crash = withInjectedCrash(memory, { collection: "bonds", op: "updateOne", onCall: 1 });
    await expect(
      settleTransition(crash.db, {
        key: "bank-treasury:trade-1:cash",
        kind: "bank_treasury_buy",
        turn: 47,
        currency: "USD",
        legs: [],
        projections: [
          {
            collection: "bonds",
            filter: { _id: BOND },
            update: {
              $pull: { holders: { bankTreasuryTradeId: "trade-1" } },
              $push: { holders: { bankId: BANK, units: 5, bankTreasuryLotId: "trade-1" } },
              $set: { updatedAt: new Date(0) },
            },
            note: "Activate the reserved bank bond units after cash settles",
          },
        ],
        event: { kind: "bank.resolved", command: "test" },
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    crash.disarm();

    const resumed = await resumeSettlement(db, "bank-treasury:trade-1:cash");
    expect(resumed.status).toBe("applied");
    const record = memory.collection("bankMoneyMoves").docs[0] as {
      projections: { note: string; applied: boolean; projection: { update: object } }[];
    };
    expect(record.projections.map((p) => [p.note, p.applied])).toEqual([
      ["Activate the reserved bank bond units after cash settles", true],
      ["Activate the reserved bank bond units after cash settles (array add)", true],
    ]);
    expect(record.projections[0].projection.update).not.toHaveProperty("$push");
    const holders = memory.collection("bonds").docs[0]?.holders as Record<string, unknown>[];
    expect(holders).toEqual([{ bankId: BANK, units: 5, bankTreasuryLotId: "trade-1" }]);

    // A further recovery changes nothing.
    await resumeSettlement(db, "bank-treasury:trade-1:cash");
    expect(memory.collection("bonds").docs[0]?.holders).toHaveLength(1);
  });
});
