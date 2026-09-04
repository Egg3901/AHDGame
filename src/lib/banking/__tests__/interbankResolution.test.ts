/**
 * Interbank claims through a bank's resolution: who gets paid, who does not,
 * and what a replay does.
 *
 * - Borrower failure: lenders recover pro rata from the estate after the
 *   central bank and the household book.
 * - Lender already resolved: its recovery goes to the insurer, never to a
 *   closed estate's vault.
 * - Lender failed but unresolved: its recovery lands in its estate.
 * - Simultaneous resolution: both estates settle in one turn without money
 *   appearing or vanishing.
 * - Replay: running the resolution again moves nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankCharter, InterbankLoan } from "@/lib/db/types/bank";
import { interbankRecoveryTarget, returnDepositBook } from "@/lib/banking/depositBookReturn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const TURN = 400;
const BORROWER = new ObjectId();
const LENDER_A = new ObjectId();
const LENDER_B = new ObjectId();

function charter(type: BankCharter["type"], overrides: Partial<BankCharter>): BankCharter {
  return {
    type,
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 0,
    npcDeposits: 0,
    totalDeposits: 0,
    totalLoans: 0,
    cashReserves: 0,
    blacklist: {},
    ...overrides,
  };
}

function world(opts: {
  borrowerCash: number;
  lenderA?: Partial<BankCharter>;
  lenderB?: Partial<BankCharter>;
}): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", externalBroadMoney: 0, netMoneyCreatedLifetime: 0 },
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
    { _id: "federal", treasuryBalance: 0, spending: { total: 0, byCategory: {} }, surplus: 0 },
  ]);
  db.seed("corporations", [
    {
      _id: BORROWER,
      name: "Failed IB",
      liquidCapital: 0,
      bankCharter: charter("investment", {
        status: "failed",
        failedTurn: TURN,
        cashReserves: opts.borrowerCash,
        interbankDebt: 300_000,
      }),
    },
    {
      _id: LENDER_A,
      name: "Lender A",
      liquidCapital: 0,
      bankCharter: charter("retail", { cashReserves: 10_000, ...opts.lenderA }),
    },
    {
      _id: LENDER_B,
      name: "Lender B",
      liquidCapital: 0,
      bankCharter: charter("retail", { cashReserves: 10_000, ...opts.lenderB }),
    },
  ]);
  db.seed("interbankLoans", [
    {
      _id: new ObjectId(),
      lenderCorporationId: LENDER_A,
      borrowerCorporationId: BORROWER,
      currency: "USD",
      principal: 200_000,
      outstanding: 200_000,
      ratePercent: 5,
      originatedTurn: 1,
      status: "current",
    },
    {
      _id: new ObjectId(),
      lenderCorporationId: LENDER_B,
      borrowerCorporationId: BORROWER,
      currency: "USD",
      principal: 100_000,
      outstanding: 100_000,
      ratePercent: 5,
      originatedTurn: 1,
      status: "current",
    },
  ]);
  return db;
}

function corp(db: InMemoryDb, id: ObjectId) {
  return db.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(id)) as {
    liquidCapital: number;
    bankCharter: BankCharter;
  };
}
function loans(db: InMemoryDb): InterbankLoan[] {
  return db.collection("interbankLoans").docs as unknown as InterbankLoan[];
}
function fundBalance(db: InMemoryDb): number {
  return (db.collection("depositInsuranceFunds").docs[0] as { balance: number }).balance;
}
function money(db: InMemoryDb): number {
  const corps = (
    db.collection("corporations").docs as {
      liquidCapital: number;
      bankCharter?: { cashReserves?: number };
    }[]
  ).reduce((s, c) => s + c.liquidCapital + (c.bankCharter?.cashReserves ?? 0), 0);
  const cb = (db.collection("centralBanks").docs[0] as { externalBroadMoney: number })
    .externalBroadMoney;
  return corps + cb + fundBalance(db);
}

describe("interbankRecoveryTarget", () => {
  it("credits a live lender's vault", () => {
    const target = interbankRecoveryTarget(
      { _id: LENDER_A, name: "A", bankCharter: charter("retail", {}) },
      "USD"
    );
    expect(target.collection).toBe("corporations");
    expect(target.path).toBe("bankCharter.cashReserves");
  });
  it("credits an unresolved failed lender's estate", () => {
    const target = interbankRecoveryTarget(
      { _id: LENDER_A, name: "A", bankCharter: charter("retail", { status: "failed" }) },
      "USD"
    );
    expect(target.collection).toBe("corporations");
    expect(target.note).toMatch(/estate/);
  });
  it("sends a resolved or revoked lender's recovery to the insurer", () => {
    for (const bankCharter of [
      charter("retail", { status: "failed", depositorsResolvedTurn: 5 }),
      charter("retail", { status: "revoked" }),
    ]) {
      const target = interbankRecoveryTarget({ _id: LENDER_A, name: "A", bankCharter }, "USD");
      expect(target).toMatchObject({
        collection: "depositInsuranceFunds",
        filter: { _id: "USD" },
        path: "balance",
      });
    }
    expect(interbankRecoveryTarget(undefined, "USD").collection).toBe("depositInsuranceFunds");
  });
});

describe("borrower failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays lenders pro rata from the estate and settles every claim", async () => {
    const db = world({ borrowerCash: 150_000 });
    const before = money(db);
    const result = await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(result.error).toBeUndefined();
    expect(result.interbankRepaid).toBe(150_000);
    expect(result.interbankWrittenOff).toBe(150_000);
    // 200k and 100k claims share 150k in a 2:1 ratio.
    expect(corp(db, LENDER_A).bankCharter.cashReserves).toBe(110_000);
    expect(corp(db, LENDER_B).bankCharter.cashReserves).toBe(60_000);
    expect(corp(db, BORROWER).bankCharter.cashReserves).toBe(0);
    expect(corp(db, BORROWER).bankCharter.interbankDebt).toBe(0);
    expect(loans(db).map((l) => [l.status, l.outstanding])).toEqual([
      ["defaulted", 100_000],
      ["defaulted", 50_000],
    ]);
    expect(money(db)).toBe(before);
  });

  it("pays the household book and the central bank before the lenders", async () => {
    const db = world({ borrowerCash: 100_000 });
    corp(db, BORROWER).bankCharter.cbMarginDebt = 40_000;
    corp(db, BORROWER).bankCharter.npcDeposits = 50_000;
    corp(db, BORROWER).bankCharter.totalDeposits = 50_000;
    const result = await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(result.centralBankRepaid).toBe(40_000);
    expect(result.npcReturned).toBe(50_000);
    expect(result.interbankRepaid).toBe(10_000);
    expect(corp(db, LENDER_A).bankCharter.cashReserves).toBeCloseTo(16_666.67, 2);
    expect(corp(db, LENDER_B).bankCharter.cashReserves).toBeCloseTo(13_333.33, 2);
  });
});

describe("lender states at resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a resolved lender's share to the insurer and an unresolved failed lender's share to its estate", async () => {
    const db = world({
      borrowerCash: 300_000,
      lenderA: { status: "failed", depositorsResolvedTurn: TURN - 1 },
      lenderB: { status: "failed" },
    });
    const before = money(db);
    const result = await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(result.error).toBeUndefined();
    expect(result.interbankRepaid).toBe(300_000);
    // Lender A's estate is closed: nothing reaches its vault.
    expect(corp(db, LENDER_A).bankCharter.cashReserves).toBe(10_000);
    expect(fundBalance(db)).toBe(200_000);
    // Lender B failed this turn and is not yet resolved: its estate grows.
    expect(corp(db, LENDER_B).bankCharter.cashReserves).toBe(110_000);
    expect(money(db)).toBe(before);
  });

  it("settles two estates in one turn without creating or destroying money", async () => {
    const db = world({ borrowerCash: 300_000, lenderB: { status: "failed", cashReserves: 5_000 } });
    const before = money(db);
    const first = await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(first.error).toBeUndefined();
    expect(corp(db, LENDER_B).bankCharter.cashReserves).toBe(105_000);
    const second = await returnDepositBook(db as unknown as Db, LENDER_B, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(second.error).toBeUndefined();
    expect(money(db)).toBe(before);
  });

  it("replays a resolution without moving anything again", async () => {
    const db = world({ borrowerCash: 150_000 });
    await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    const snapshot = JSON.stringify(db.collection("corporations").docs);
    const again = await returnDepositBook(db as unknown as Db, BORROWER, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(again.error).toBeUndefined();
    expect(JSON.stringify(db.collection("corporations").docs)).toBe(snapshot);
  });
});
