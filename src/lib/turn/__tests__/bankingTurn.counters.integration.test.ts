/**
 * Lifetime counters are replay-safe projections of the money that moved.
 *
 * The premium counter on the insurance fund and the payout counters written
 * on resolution used to be separate writes after the money move. A crash
 * between the two either lost the counter (retry replays the move, skips the
 * counter) or doubled it (retry re-runs the counter write). Both are checked
 * here by killing the flow right after the money lands and running it again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { BankCharter, DepositInsuranceFund } from "@/lib/db/types/bank";
import { returnDepositBook } from "@/lib/banking/depositBookReturn";
import { processBankingTurn } from "../bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const TURN = 300;
const BANK = new ObjectId();

function world(charter: Partial<BankCharter> = {}): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 0,
      bankReserveRequirement: 0.1,
      netMoneyCreatedLifetime: 0,
    },
  ]);
  db.seed("depositInsuranceFunds", [
    {
      _id: "USD",
      balance: 0,
      insuredCap: 5_000_000,
      premiumsCollectedLifetime: 0,
      payoutsLifetime: 0,
      treasuryBackstopLifetime: 0,
    },
  ]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      treasuryBalance: 10_000_000,
      spending: { total: 0, byCategory: {} },
      surplus: 0,
    },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Counter Bank",
      type: "financial",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      userId: new ObjectId(),
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        npcDeposits: 2_000_000,
        totalDeposits: 2_000_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
        ...charter,
      },
    },
  ]);
  return db;
}

function fund(db: InMemoryDb): DepositInsuranceFund {
  return db.collection("depositInsuranceFunds").docs[0] as unknown as DepositInsuranceFund;
}

function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    liquidCapital: number;
    bankCharter: BankCharter;
  };
}

describe("insurance premium counter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lands exactly once when the turn crashes after the premium moved and is re-run", async () => {
    const db = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Fund writes in the pass: ensureFund's upsert (#1), the premium credit
    // leg (#2), then the counter projection (#3). Crash before the counter.
    const faulty = withInjectedCrash(db, {
      collection: "depositInsuranceFunds",
      op: "updateOne",
      onCall: 3,
    });
    await expect(processBankingTurn(faulty.db, TURN)).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    const paid = fund(db).balance;
    expect(paid).toBeGreaterThan(0);
    expect(fund(db).premiumsCollectedLifetime).toBe(0);

    const rerun = await processBankingTurn(db as unknown as Db, TURN);
    expect(rerun.banksProcessed).toBe(1);
    // The cash moved once; the counter now matches it exactly.
    expect(fund(db).balance).toBeCloseTo(paid, 9);
    expect(fund(db).premiumsCollectedLifetime).toBeCloseTo(paid, 9);

    const again = await processBankingTurn(db as unknown as Db, TURN);
    expect(again.banksProcessed).toBe(0);
    expect(fund(db).premiumsCollectedLifetime).toBeCloseTo(paid, 9);
  });
});

describe("deposit-book return counters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("books the payout and treasury counters once across a crash and a retry", async () => {
    // Cash covers 100k of a 2M household book; the fund has 300k; the
    // treasury backstops the rest.
    const db = world({ cashReserves: 100_000, status: "failed" });
    fund(db).balance = 300_000;
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Kill the flow at the first federalBudget write, which is the first
    // projection after the money legs.
    const faulty = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
    });
    await expect(
      returnDepositBook(faulty.db, BANK, {
        cause: "failure",
        turn: TURN,
        releaseResidualToOwner: false,
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    expect(bank(db).bankCharter.cashReserves).toBe(0);
    expect(fund(db).balance).toBe(0);
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ externalBroadMoney: 2_000_000 });
    expect(fund(db).payoutsLifetime).toBe(0);

    const retry = await returnDepositBook(db as unknown as Db, BANK, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(retry.error).toBeUndefined();
    expect(fund(db).payoutsLifetime).toBe(1_900_000);
    expect(fund(db).treasuryBackstopLifetime).toBe(1_600_000);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: 10_000_000 - 1_600_000,
      spending: { total: 1_600_000, byCategory: { depositInsurance: 1_600_000 } },
    });
    expect(bank(db).bankCharter).toMatchObject({
      npcDeposits: 0,
      totalDeposits: 0,
      depositorsResolvedTurn: TURN,
    });
    // Money did not move a second time.
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ externalBroadMoney: 2_000_000 });

    const third = await returnDepositBook(db as unknown as Db, BANK, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(third.error).toBeUndefined();
    expect(fund(db).payoutsLifetime).toBe(1_900_000);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({ treasuryBalance: 8_400_000 });
  });
});
