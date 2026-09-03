/**
 * Retry safety under crashes at every interruption point.
 *
 * A transition is committed as: claim the key, land the legs, apply the
 * projections, record completion. The tests below kill the process at each
 * boundary and then run the same transition again, asserting the property
 * that matters on a database without transactions: money never moves twice,
 * and whatever the crash left half done is either finished by the retry or
 * visible in the repair queue. Never silently lost.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { MONEY_MOVE_COLLECTION, listUnfinishedMoneyMoves } from "@/lib/banking/moneyMove";
import { listUnfinishedProjections, settleTransition } from "@/lib/banking/settlementJournal";
import { injectBankCapital, upstreamBankCash } from "@/lib/banking/bankCash";
import { drawDiscountWindow, repayDiscountWindow } from "@/lib/banking/discountWindowCommands";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

const BANK = new ObjectId();
const TURN = 77;

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", primeRate: 4, bankReserveRequirement: 0.1 },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Crash Bank",
      liquidCapital: 300_000,
      liquidCurrencyCode: "USD",
      countryId: "US",
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 100_000,
        cashReserves: 500_000,
        npcDeposits: 1_000_000,
        totalDeposits: 1_000_000,
        totalLoans: 800_000,
        depositOffset: 0,
        lendingOffset: 0,
        capitalStanding: "adequate",
      },
    },
  ]);
  return db;
}

function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    liquidCapital: number;
    bankCharter: { cashReserves: number; postedCapital: number; discountWindowDebt?: number };
  };
}

function totalMoney(db: InMemoryDb): number {
  const b = bank(db);
  return b.liquidCapital + b.bankCharter.cashReserves;
}

function injection(): BankingTransition {
  return {
    key: `bank_capital_injection:${BANK}:${TURN}:cmd`,
    kind: "bank_capital_injection",
    turn: TURN,
    currency: "USD",
    legs: [
      {
        kind: "debit",
        amount: 100_000,
        collection: "corporations",
        filter: { _id: oid(BANK.toHexString()) },
        path: "liquidCapital",
        note: "treasury",
      },
      {
        kind: "credit",
        amount: 100_000,
        collection: "corporations",
        filter: { _id: oid(BANK.toHexString()), "bankCharter.status": "active" },
        path: "bankCharter.cashReserves",
        note: "vault",
      },
    ],
    projections: [
      {
        collection: "corporations",
        filter: { _id: oid(BANK.toHexString()) },
        update: { $inc: { "bankCharter.postedCapital": 100_000 } },
        note: "posted capital memo",
      },
    ],
    event: { kind: "charter.issued", command: "bank.capital.inject" },
  };
}

async function crashAt(memory: InMemoryDb, plan: Parameters<typeof withInjectedCrash>[1]) {
  const faulty = withInjectedCrash(memory, plan);
  await expect(settleTransition(faulty.db, injection())).rejects.toBeInstanceOf(InjectedCrash);
  faulty.disarm();
  return faulty;
}

describe("settleTransition under injected crashes", () => {
  let memory: InMemoryDb;
  beforeEach(() => {
    vi.clearAllMocks();
    memory = world();
  });

  it("before the claim: nothing is written and the retry applies cleanly", async () => {
    const before = totalMoney(memory);
    await crashAt(memory, { collection: MONEY_MOVE_COLLECTION, op: "insertOne", onCall: 1 });
    expect(memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);

    const retry = await settleTransition(memory as unknown as Db, injection());
    expect(retry.status).toBe("applied");
    expect(bank(memory).bankCharter.cashReserves).toBe(600_000);
    expect(bank(memory).liquidCapital).toBe(200_000);
    expect(bank(memory).bankCharter.postedCapital).toBe(200_000);
    expect(totalMoney(memory)).toBe(before);
  });

  it("after the claim, before any leg: the retry moves nothing and the hole is visible, not doubled", async () => {
    const before = totalMoney(memory);
    await crashAt(memory, {
      collection: MONEY_MOVE_COLLECTION,
      op: "insertOne",
      onCall: 1,
      afterWrite: true,
    });
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);

    const retry = await settleTransition(memory as unknown as Db, injection());
    // At-most-once: the key is owned, so the retry moves nothing and says so.
    // The record sits in the repair queue with every leg outstanding.
    expect(retry.status).toBe("replayed");
    expect(retry.error).toMatch(/not landed every leg/);
    expect(bank(memory).bankCharter.postedCapital).toBe(100_000);
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);
    expect(totalMoney(memory)).toBe(before);
    const queue = await listUnfinishedMoneyMoves(memory as unknown as Db);
    expect(queue).toHaveLength(1);
    expect(queue[0].outstandingLegs).toHaveLength(2);
    expect(queue[0].appliedLegs).toHaveLength(0);
  });

  it("between the two legs: the debit landed, the credit did not, and the retry does not re-debit", async () => {
    const before = totalMoney(memory);
    // Writes so far: claim insert (moneyMoves), then leg 1 update (corporations).
    // Crashing after the debit but before its stamp is the worst case: the
    // record does not yet know the debit landed.
    await crashAt(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    expect(bank(memory).liquidCapital).toBe(200_000);
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);

    const retry = await settleTransition(memory as unknown as Db, injection());
    // A replay over a money hole writes nothing: no second debit, no
    // projection on top of undelivered cash, and it says the key is unsettled.
    expect(retry.status).toBe("replayed");
    expect(retry.error).toBeDefined();
    expect(bank(memory).liquidCapital).toBe(200_000);
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);
    expect(bank(memory).bankCharter.postedCapital).toBe(100_000);
    expect(totalMoney(memory)).toBe(before - 100_000);
    const queue = await listUnfinishedMoneyMoves(memory as unknown as Db);
    expect(queue).toHaveLength(1);
    expect(queue[0].outstandingLegs).toHaveLength(2);
  });

  it("between the debit's stamp and the credit: the queue names the missing leg exactly", async () => {
    const before = totalMoney(memory);
    // Writes: claim insert (moneyMoves #1), debit (corp #1), debit stamp
    // (moneyMoves #2), credit (corp #2). Crash before the credit.
    await crashAt(memory, { collection: "corporations", op: "updateOne", onCall: 2 });
    expect(totalMoney(memory)).toBe(before - 100_000);
    const retry = await settleTransition(memory as unknown as Db, injection());
    expect(retry.status).toBe("replayed");
    expect(retry.error).toBeDefined();
    expect(retry.appliedLegs).toEqual([0]);
    const queue = await listUnfinishedMoneyMoves(memory as unknown as Db);
    expect(queue[0].appliedLegs.map((l) => l.note)).toEqual(["treasury"]);
    expect(queue[0].outstandingLegs.map((l) => l.note)).toEqual(["vault"]);
    expect(bank(memory).bankCharter.postedCapital).toBe(100_000);
  });

  it("after the legs, before the projection: the retry finishes the projection and moves no money", async () => {
    const before = totalMoney(memory);
    // Corporation writes: debit (#1), credit (#2), then the projection (#3).
    // Crash before the projection lands, after it was claimed.
    await crashAt(memory, { collection: "corporations", op: "updateOne", onCall: 3 });
    expect(bank(memory).bankCharter.cashReserves).toBe(600_000);
    expect(bank(memory).liquidCapital).toBe(200_000);
    expect(bank(memory).bankCharter.postedCapital).toBe(100_000);
    expect(await listUnfinishedProjections(memory as unknown as Db)).toHaveLength(0);

    const retry = await settleTransition(memory as unknown as Db, injection());
    expect(retry.status).toBe("replayed");
    expect(retry.appliedProjections).toEqual([0]);
    expect(bank(memory).bankCharter.cashReserves).toBe(600_000);
    expect(bank(memory).bankCharter.postedCapital).toBe(200_000);
    expect(totalMoney(memory)).toBe(before);
  });

  it("after everything: the retry is a pure replay", async () => {
    const before = totalMoney(memory);
    const first = await settleTransition(memory as unknown as Db, injection());
    expect(first.status).toBe("applied");
    const retry = await settleTransition(memory as unknown as Db, injection());
    expect(retry.status).toBe("replayed");
    expect(bank(memory).bankCharter.cashReserves).toBe(600_000);
    expect(bank(memory).bankCharter.postedCapital).toBe(200_000);
    expect(totalMoney(memory)).toBe(before);
  });
});

describe("capital and window commands through the journal", () => {
  let memory: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    memory = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  });

  it("injects, upstreams within the distributable line, and conserves money", async () => {
    const before = totalMoney(memory);
    const injected = await injectBankCapital(memory as unknown as Db, BANK, 100_000, "c1");
    expect(injected).toEqual({
      ok: true,
      amount: 100_000,
      cashReserves: 600_000,
      liquidCapital: 200_000,
    });
    expect(bank(memory).bankCharter.postedCapital).toBe(200_000);

    // equity = 600k + 800k - 1M = 400k; required 100k; surplus 500k; distributable 400k
    const upstreamed = await upstreamBankCash(memory as unknown as Db, BANK, 10_000_000, 0.1, "c2");
    expect(upstreamed).toEqual({
      ok: true,
      amount: 400_000,
      cashReserves: 200_000,
      liquidCapital: 600_000,
    });
    expect(bank(memory).bankCharter.postedCapital).toBe(0);
    expect(totalMoney(memory)).toBe(before);
  });

  it("refuses and reports through the same result shape", async () => {
    expect(await injectBankCapital(memory as unknown as Db, BANK, 900_000, "c3")).toEqual({
      ok: false,
      error: "The corporation does not hold that much cash.",
    });
    expect(await upstreamBankCash(memory as unknown as Db, BANK, -1)).toEqual({
      ok: false,
      error: "Amount must be a positive number.",
    });
  });

  it("draws and repays the window as mint and burn, with the debt counter in step", async () => {
    const drawn = await drawDiscountWindow(memory as unknown as Db, BANK, 50_000, TURN);
    expect(drawn).toEqual({ ok: true, outstanding: 50_000, ratePercent: 7 });
    expect(bank(memory).bankCharter.cashReserves).toBe(550_000);
    expect(bank(memory).bankCharter.discountWindowDebt).toBe(50_000);
    expect(memory.collection("centralBanks").docs[0]).toMatchObject({
      netMoneyCreatedLifetime: 50_000,
    });

    const repaid = await repayDiscountWindow(memory as unknown as Db, BANK, 80_000, TURN);
    expect(repaid).toEqual({ ok: true, outstanding: 0, ratePercent: 7 });
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);
    expect(bank(memory).bankCharter.discountWindowDebt).toBe(0);
    expect(memory.collection("centralBanks").docs[0]).toMatchObject({ netMoneyCreatedLifetime: 0 });
  });

  it("refuses a window draw past the cap without touching balances", async () => {
    const result = await drawDiscountWindow(memory as unknown as Db, BANK, 300_000, TURN);
    expect(result.ok).toBe(false);
    expect(bank(memory).bankCharter.cashReserves).toBe(500_000);
    expect(bank(memory).bankCharter.discountWindowDebt ?? 0).toBe(0);
  });
});

describe("named loan origination under injected crashes, per charter type", () => {
  const BORROWER = new ObjectId();
  const LOAN = new ObjectId();

  function loanWorld(type: "retail" | "universal" | "investment"): InMemoryDb {
    const memory = world();
    const b = bank(memory) as unknown as { bankCharter: Record<string, unknown> };
    b.bankCharter.type = type;
    if (type === "investment") {
      b.bankCharter.npcDeposits = 0;
      b.bankCharter.totalDeposits = 0;
    }
    memory.seed("corporations", [{ _id: BORROWER, name: "Borrower", liquidCapital: 50_000 }]);
    return memory;
  }

  function origination(): BankingTransition {
    return {
      key: `named_loan_origination:${BANK}:${LOAN}`,
      kind: "named_loan_origination",
      turn: TURN,
      currency: "USD",
      legs: [
        {
          kind: "debit",
          amount: 40_000,
          collection: "corporations",
          filter: { _id: oid(BANK.toHexString()), "bankCharter.status": "active" },
          path: "bankCharter.cashReserves",
          note: "vault",
        },
        {
          kind: "credit",
          amount: 40_000,
          collection: "corporations",
          filter: { _id: oid(BORROWER.toHexString()) },
          path: "liquidCapital",
          note: "proceeds",
        },
      ],
      projections: [
        {
          collection: "bankLoans",
          insert: {
            _id: oid(LOAN.toHexString()),
            bankCorporationId: oid(BANK.toHexString()),
            borrowerType: "corporation",
            borrowerId: oid(BORROWER.toHexString()),
            principal: 40_000,
            outstanding: 40_000,
            status: "current",
          },
          note: "loan record",
        },
        {
          collection: "corporations",
          filter: { _id: oid(BANK.toHexString()) },
          update: { $inc: { "bankCharter.totalLoans": 40_000 } },
          note: "loan book total",
        },
      ],
      event: { kind: "loan.originated", command: "bank.loan.originate" },
    };
  }

  function borrowerCash(memory: InMemoryDb): number {
    return (
      memory.collection("corporations").docs.find((d) => (d._id as ObjectId).equals(BORROWER)) as {
        liquidCapital: number;
      }
    ).liquidCapital;
  }

  function loanMoney(memory: InMemoryDb): number {
    return totalMoney(memory) + borrowerCash(memory);
  }

  const points: Array<[string, Parameters<typeof withInjectedCrash>[1]]> = [
    ["before the claim", { collection: MONEY_MOVE_COLLECTION, op: "insertOne", onCall: 1 }],
    [
      "after the claim",
      { collection: MONEY_MOVE_COLLECTION, op: "insertOne", onCall: 1, afterWrite: true },
    ],
    [
      "after the vault debit",
      { collection: "corporations", op: "updateOne", onCall: 1, afterWrite: true },
    ],
    ["before the loan record", { collection: "bankLoans", op: "insertOne", onCall: 1 }],
    ["before the loan book total", { collection: "corporations", op: "updateOne", onCall: 3 }],
  ];

  describe.each(["retail", "universal", "investment"] as const)("%s charter", (type) => {
    it.each(points)(
      "crash %s: the retry never moves money twice or books a loan over a hole",
      async (_label, plan) => {
        const memory = loanWorld(type);
        const before = loanMoney(memory);
        const faulty = withInjectedCrash(memory, plan);
        // A crash inside an insert is caught by the journal and recorded as a
        // partial settlement with the claim released; everywhere else the
        // process dies mid-flight. Both must be safe to retry.
        const first = await settleTransition(faulty.db, origination()).then(
          (r) => r,
          (err: unknown) => {
            expect(err).toBeInstanceOf(InjectedCrash);
            return null;
          }
        );
        if (first) expect(first.status).toBe("partial");
        faulty.disarm();

        const retry = await settleTransition(memory as unknown as Db, origination());
        const bankDoc = bank(memory) as unknown as {
          bankCharter: { cashReserves: number; totalLoans: number };
        };
        const loans = memory.collection("bankLoans").docs;

        // Whatever happened, the borrower was never paid twice and the vault
        // was never debited twice.
        expect(borrowerCash(memory)).toBeLessThanOrEqual(90_000);
        expect(bankDoc.bankCharter.cashReserves).toBeGreaterThanOrEqual(460_000);
        expect(loans.length).toBeLessThanOrEqual(1);

        if (retry.error) {
          // A hole the primitive left: no loan may sit on top of it, and the
          // repair queue must show it.
          expect(retry.status).toBe("replayed");
          expect(loans).toHaveLength(0);
          expect(bankDoc.bankCharter.totalLoans).toBe(800_000);
          expect(await listUnfinishedMoneyMoves(memory as unknown as Db)).toHaveLength(1);
        } else {
          // Fully settled by the retry: every projection present exactly once.
          expect(["applied", "replayed"]).toContain(retry.status);
          expect(loans).toHaveLength(1);
          expect(bankDoc.bankCharter.totalLoans).toBe(840_000);
          expect(bankDoc.bankCharter.cashReserves).toBe(460_000);
          expect(borrowerCash(memory)).toBe(90_000);
          expect(loanMoney(memory)).toBe(before);
          expect(await listUnfinishedProjections(memory as unknown as Db)).toHaveLength(0);
        }
      }
    );
  });
});
