import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
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

  /**
   * State-based world for the revoke path.
   *
   * Revocation now runs the shared deposit-book waterfall, which touches the
   * money supply, the insurance fund and the parent's treasury. Counting
   * `updateOne` calls cannot say whether the money added up at the end of that,
   * which is the only question worth asking here.
   */
  function revokeWorld(charter: Partial<BankCharter>, options: { npcDeposits?: number } = {}) {
    const memory = createInMemoryDb();
    const corpId = new ObjectId();
    memory.seed("corporations", [
      {
        _id: corpId,
        name: "Oppenheimer Property Trust",
        type: "financial",
        countryId: "US",
        liquidCapital: 0,
        bankCharter: {
          type: "investment",
          status: "active",
          currency: "USD",
          charteredTurn: 10,
          postedCapital: 0,
          depositOffset: 0,
          lendingOffset: 0,
          npcDeposits: options.npcDeposits ?? 0,
          ...charter,
        },
      },
    ]);
    memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 100_000_000 }]);
    memory.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
    memory.seed("federalBudget", [
      { _id: "federal", treasuryBalance: 10_000_000, spending: { total: 0, byCategory: {} } },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    return { memory, corpId };
  }

  function corpState(memory: InMemoryDb) {
    return memory.collection("corporations").docs[0] as {
      liquidCapital: number;
      bankCharter: Record<string, unknown>;
    };
  }

  it("unwinds the prop book into cash and pays the whole balance to the shareholder", async () => {
    // Investment bank, no depositors: value sits in the prop book plus cash.
    // cashReserves (100k) against a 10M book is a 1% capital ratio, well under
    // the 8% minimum, so it is undercapitalized and the deadline has expired.
    const cashReserves = 100_000;
    const propBookMarkValue = 10_000_000;
    const { memory, corpId } = revokeWorld({
      cashReserves,
      propBookMarkValue,
      propBook: [{ asset: "equity", ref: "abc", units: 1, costBasis: 9_000_000 }],
      totalLoans: 0,
      totalDeposits: 0,
      undercapitalizedSinceTurn: BREACHED_SINCE,
    } as Partial<BankCharter>);

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(memory as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);
    const corp = corpState(memory);
    expect(corp.bankCharter.status).toBe("revoked");
    expect(corp.bankCharter.revokedReason).toBe("undercapitalized");
    expect(corp.bankCharter.propBookMarkValue).toBe(0);
    // The regression: the whole balance returns to the corporation treasury
    // instead of vanishing with the licence.
    expect(corp.liquidCapital).toBe(cashReserves + propBookMarkValue);
    expect(corp.bankCharter.cashReserves).toBe(0);
    expect(corpId.equals((corp as unknown as { _id: ObjectId })._id)).toBe(true);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0][1]).toMatchObject({
      type: "bank_prop_trade_sell",
      amount: propBookMarkValue,
      meta: { reason: "supervision_revoke_unwind" },
    });
  });

  it("pays cash reserves out with no prop book to unwind (retail bank, no deposits)", async () => {
    const cashReserves = 3_000_000;
    const { memory } = revokeWorld({
      type: "retail",
      cashReserves,
      totalLoans: 50_000_000, // heavy book vs thin capital, so undercapitalized
      totalDeposits: 0,
      undercapitalizedSinceTurn: BREACHED_SINCE,
    } as Partial<BankCharter>);

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(memory as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);
    expect(corpState(memory).liquidCapital).toBe(cashReserves);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("pays the household deposit book back before the shareholder", async () => {
    const { memory } = revokeWorld(
      {
        type: "retail",
        cashReserves: 1_000_000,
        totalLoans: 50_000_000,
        totalDeposits: 8_000_000,
        undercapitalizedSinceTurn: BREACHED_SINCE,
      } as Partial<BankCharter>,
      { npcDeposits: 8_000_000 }
    );

    const { processBankSupervision } = await importSupervision();
    const summary = await processBankSupervision(memory as unknown as Db, TURN);

    expect(summary.chartersRevoked).toBe(1);
    const corp = corpState(memory);
    expect(corp.bankCharter.status).toBe("revoked");
    // Every unit of cash went to the depositors, and the treasury covered the
    // 7M the bank could not pay. The shareholder, who ranks last, gets nothing.
    expect(corp.liquidCapital).toBe(0);
    expect(corp.bankCharter.cashReserves).toBe(0);
    const cb = memory.collection("centralBanks").docs[0] as { externalBroadMoney: number };
    expect(cb.externalBroadMoney).toBe(108_000_000);
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
