import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter } from "@/lib/db/types/bank";
import { unwindBank } from "../adminUnwind";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const CORP_ID = new ObjectId();

function makeActiveCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 10,
    postedCapital: 10_000_000,
    cashReserves: 10_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    npcDeposits: 2_500_000,
    totalDeposits: 3_000_000,
    totalLoans: 500_000,
    ...overrides,
  };
}

function makeWorld(charter: BankCharter): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("corporations", [
    {
      _id: CORP_ID,
      name: "Stuck Bank Corp",
      type: "financial",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
      countryId: "US",
      headquartersState: "NY",
      bankCharter: charter,
    },
  ]);
  db.seed("centralBanks", [{ _id: "US", externalBroadMoney: 50_000_000 }]);
  db.seed("gameState", [{ _id: "current", currentTurn: 99, preset: "2019-default" }]);
  // Flag OFF: unwind must still work, it is the recovery tool.
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: false }]);
  db.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
  db.seed("characters", [
    {
      _id: new ObjectId(),
      name: "Saver",
      currencyBalances: {
        savings: { USD: 400_000 },
        savingsHolder: { USD: CORP_ID.toString() },
      },
    },
  ]);
  return db;
}

function corpOf(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    liquidCapital: number;
    bankCharter: Record<string, number | string>;
  };
}

describe("adminUnwind.unwindBank", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeWorld(makeActiveCharter());
  });

  it("returns the deposit book, pays the owner only the residual, and archives", async () => {
    const externalBefore = 50_000_000;
    const result = await unwindBank(db as unknown as Db, CORP_ID, "stuck freeze recovery");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyRevoked).toBe(false);
    expect(result.depositorsFlipped).toBe(1);
    expect(result.npcDepositsReturned).toBe(2_500_000);

    // The household book goes back into the money supply out of the bank's own
    // cash. The old unwind credited the money supply and ALSO handed the same
    // cash to the shareholder, so the money existed twice.
    const cb = db.collection("centralBanks").docs[0] as { externalBroadMoney: number };
    expect(cb.externalBroadMoney).toBe(externalBefore + 2_500_000);

    // Residual to the owner is cash less the deposit book, capped at book
    // equity (10M cash + 0.5M loans - 2.5M deposits = 8M equity, so the 7.5M
    // surplus is what moves).
    expect(result.refundedCapital).toBe(7_500_000);
    expect(corpOf(db).liquidCapital).toBe(8_500_000);
    expect(corpOf(db).bankCharter.cashReserves).toBe(0);
    expect(corpOf(db).bankCharter.status).toBe("revoked");
    expect(corpOf(db).bankCharter.npcDeposits).toBe(0);

    // Pointer flip only: the player's balance is untouched.
    const saver = db.collection("characters").docs[0] as {
      currencyBalances: { savings: { USD: number }; savingsHolder: { USD: string } };
    };
    expect(saver.currencyBalances.savingsHolder.USD).toBe("centralBank");
    expect(saver.currencyBalances.savings.USD).toBe(400_000);

    const history = db.collection("bankCharterHistory").docs as { reason: string }[];
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe("revoked");

    // Loans are not touched: they keep amortizing.
    expect(corpOf(db).bankCharter.totalLoans).toBe(500_000);
  });

  it("works with privateBankingEnabled false (no feature-flag gate)", async () => {
    db = makeWorld(makeActiveCharter({ npcDeposits: 0, totalDeposits: 0, totalLoans: 0 }));
    const result = await unwindBank(db as unknown as Db, CORP_ID, "flag-off recovery");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyRevoked).toBe(false);
    // No deposit book, so the whole cash balance is the owner's residual.
    expect(result.refundedCapital).toBe(10_000_000);
    expect(corpOf(db).liquidCapital).toBe(11_000_000);
  });

  it("is idempotent when the charter is already revoked", async () => {
    db = makeWorld(makeActiveCharter({ status: "revoked" }));
    const first = await unwindBank(db as unknown as Db, CORP_ID, "already done");
    const second = await unwindBank(db as unknown as Db, CORP_ID, "already done");

    expect(first).toEqual({
      ok: true,
      alreadyRevoked: true,
      depositorsFlipped: 0,
      npcDepositsReturned: 0,
      refundedCapital: 0,
    });
    expect(second).toEqual(first);
    expect(db.collection("bankCharterHistory").docs).toHaveLength(0);
  });

  it("refuses without a reason", async () => {
    const result = await unwindBank(db as unknown as Db, CORP_ID, "   ");
    expect(result.ok).toBe(false);
  });
});
