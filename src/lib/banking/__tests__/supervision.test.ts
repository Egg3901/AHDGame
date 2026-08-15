import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

const TURN = 118;
// 12 turns back == RECAP_GRACE_TURNS, so the recap deadline has just expired.
const BREACHED_SINCE = TURN - 12;

function bankCorp(charter: Partial<BankCharter>): Corporation {
  return {
    _id: new ObjectId(),
    name: "Oppenheimer Property Trust",
    type: "financial",
    userId: new ObjectId(),
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
    bankCharter: {
      type: "investment",
      status: "active",
      currency: "USD",
      charteredTurn: 10,
      postedCapital: 0,
      depositOffset: 0,
      lendingOffset: 0,
      ...charter,
    },
  } as unknown as Corporation;
}

/** Make `corporations.find(...).project(...).toArray()` yield exactly `corps`. */
function seedActiveCharters(db: MockDb, corps: Corporation[]) {
  db.collectionMocks.corporations!.find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(corps),
  } as never);
}

async function importSupervision() {
  return import("../supervision");
}

describe("processBankSupervision — revoke refunds capital (ticket 1093)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("corporations");
    db.collection("bankLoans");
    db.collection("gameState");
    db.collection("bankCharterHistory");
    // revokeCharter reads the current turn from gameState.
    db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: TURN });
  });

  it("unwinds the prop book into cash and refunds the whole balance to the shareholder", async () => {
    // Investment bank, no depositors: value sits in the prop book plus cash.
    // cashReserves (100k) against a 10M book is a 1% capital ratio — well under
    // the 8% minimum — so it is undercapitalized, and the deadline has expired.
    const cashReserves = 100_000;
    const propBookMarkValue = 10_000_000;
    const corp = bankCorp({
      cashReserves,
      propBookMarkValue,
      propBook: [{ asset: "equity", ref: "abc", units: 1, costBasis: 9_000_000 }],
      totalLoans: 0,
      totalDeposits: 0,
      undercapitalizedSinceTurn: BREACHED_SINCE,
    } as Partial<BankCharter>);
    seedActiveCharters(db, [corp]);

    // After the unwind persists, revokeCharter re-reads the corp: the book value
    // is now on the cash side, so the refund is the full 10.1M.
    db.collectionMocks.corporations!.findOne.mockResolvedValue(
      bankCorp({
        cashReserves: cashReserves + propBookMarkValue,
        propBookMarkValue: 0,
        propBook: [],
        totalLoans: 0,
        totalDeposits: 0,
      } as Partial<BankCharter>)
    );

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(db as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);

    const updates = db.collectionMocks.corporations!.updateOne.mock.calls;
    // Two writes: (1) unwind the prop book into cash, (2) revoke + refund.
    expect(updates.length).toBe(2);

    const [, unwind] = updates[0];
    expect(unwind.$inc["bankCharter.cashReserves"]).toBe(propBookMarkValue);
    expect(unwind.$set["bankCharter.propBook"]).toEqual([]);
    expect(unwind.$set["bankCharter.propBookMarkValue"]).toBe(0);

    const [, revoke] = updates[1];
    expect(revoke.$set["bankCharter.status"]).toBe("revoked");
    expect(revoke.$set["bankCharter.revokedReason"]).toBe("undercapitalized");
    // The regression: the whole balance returns to the corporation treasury
    // instead of vanishing with the licence.
    expect(revoke.$inc.liquidCapital).toBe(cashReserves + propBookMarkValue);
    expect(revoke.$set["bankCharter.cashReserves"]).toBe(0);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0][1]).toMatchObject({
      type: "bank_prop_trade_sell",
      amount: propBookMarkValue,
      meta: { reason: "supervision_revoke_unwind" },
    });
  });

  it("refunds cash reserves with no prop book to unwind (retail bank, no deposits)", async () => {
    const cashReserves = 3_000_000;
    const corp = bankCorp({
      type: "retail",
      cashReserves,
      totalLoans: 50_000_000, // heavy book vs thin capital -> undercapitalized
      totalDeposits: 0,
      undercapitalizedSinceTurn: BREACHED_SINCE,
    } as Partial<BankCharter>);
    seedActiveCharters(db, [corp]);
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(db as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);
    // No prop book: a single write (the revoke), and no unwind transaction.
    const updates = db.collectionMocks.corporations!.updateOne.mock.calls;
    expect(updates.length).toBe(1);
    expect(updates[0][1].$inc.liquidCapital).toBe(cashReserves);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("revokes but does not refund while depositors remain", async () => {
    const corp = bankCorp({
      type: "retail",
      cashReserves: 1_000_000,
      totalLoans: 50_000_000,
      totalDeposits: 8_000_000, // depositors still owed -> no shareholder refund
      undercapitalizedSinceTurn: BREACHED_SINCE,
    } as Partial<BankCharter>);
    seedActiveCharters(db, [corp]);
    db.collectionMocks.corporations!.findOne.mockResolvedValue(corp);

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(db as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);
    const revoke = db.collectionMocks.corporations!.updateOne.mock.calls.at(-1)![1];
    expect(revoke.$set["bankCharter.status"]).toBe("revoked");
    expect(revoke.$inc).toBeUndefined(); // nothing refunded
  });

  it("does not revoke a bank still within its recap grace window", async () => {
    const corp = bankCorp({
      type: "retail",
      cashReserves: 1_000_000,
      totalLoans: 50_000_000,
      totalDeposits: 0,
      undercapitalizedSinceTurn: TURN - 3, // breached, but deadline not reached
    } as Partial<BankCharter>);
    seedActiveCharters(db, [corp]);

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(db as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(0);
    expect(summary.undercapitalized).toBe(1);
  });
});
