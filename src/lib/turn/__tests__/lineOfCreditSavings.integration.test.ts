/**
 * A line-of-credit payment that overflows into savings.
 *
 * The payment drains the wallet first and takes the rest from savings. Under
 * the legacy pointer model that was a bare decrement of a number nothing stood
 * behind. Once a currency's savings accounts are the book of record the
 * balance IS the account and its backing sits in the central bank's household
 * pool, so the overflow has to be withdrawn through the journal: backing out
 * of the pool, into the wallet, out of the wallet to the lender.
 *
 * The bug this covers: the payment decremented the legacy projection directly
 * while the account kept the money and no backing moved, so the player's real
 * balance never fell and the world gained cash. Nothing else in the turn or
 * the savings suites could see it, because the two representations are only
 * compared once a currency is in the read cohort.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { processLineOfCreditTurn } from "@/lib/turn/lineOfCreditTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/lineOfCredit/ledger", () => ({
  insertLocLedgerEntry: vi.fn().mockResolvedValue(undefined),
}));

const OWNER = new ObjectId();
const TURN = 500;
/** Drawn principal, with no wallet cash: the whole payment must come from savings. */
const DRAWN = 100_000;

function world(readCurrencies: string[]): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      forexEnabled: true,
      lineOfCreditEnabled: true,
      privateBankingEnabled: false,
      savingsAccountsMode: readCurrencies.length > 0 ? "authoritative" : "shadow",
      savingsAccountsReadCurrencies: readCurrencies,
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 5,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 1_000_000,
      householdSavingsLiability: 50_000,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("exchangeRates", [{ _id: "USD", code: "USD", rateToInternal: 1 }]);
  db.seed("characters", [
    {
      _id: OWNER,
      name: "Borrower",
      countryId: "US",
      savingsAccountsOpened: { USD: true },
      currencyBalances: {
        personal: { USD: 0 },
        savings: { USD: 50_000 },
      },
      lineOfCredit: {
        balances: { USD: DRAWN },
        arrears: {},
        accountsOpened: { USD: true },
      },
    },
  ]);
  db.seed("savingsAccounts", [
    {
      _id: new ObjectId(),
      ownerType: "character",
      ownerId: OWNER,
      currency: "USD",
      balance: 50_000,
      holder: "centralBank",
      status: "open",
      version: 0,
      accruedInterest: 0,
      interestEarned: 0,
      openedTurn: 1,
    },
  ]);
  return db;
}

function character(db: InMemoryDb) {
  return db.collection("characters").docs[0] as {
    currencyBalances: { personal: { USD: number }; savings: { USD: number } };
    lineOfCredit: { balances: { USD?: number }; arrears: { USD?: number } };
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}
function pool(db: InMemoryDb): number {
  return (db.collection("centralBanks").docs[0] as { externalBroadMoney: number })
    .externalBroadMoney;
}

async function run(db: InMemoryDb) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  return processLineOfCreditTurn(
    db as unknown as Db,
    TURN,
    new Map([[OWNER.toString(), 0]]),
    new Map(),
    true
  );
}

describe("line-of-credit payment overflowing into savings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("withdraws through the account and moves the backing when the currency reads authoritatively", async () => {
    const db = world(["USD"]);
    const poolBefore = pool(db);
    const savingsBefore = account(db).balance;

    await run(db);

    const paid = savingsBefore - account(db).balance;
    expect(paid).toBeGreaterThan(0);
    // The account is the balance of record and it fell by what was paid.
    expect(account(db).balance).toBeCloseTo(savingsBefore - paid, 6);
    // Its backing left the central bank's pool: the money is real.
    expect(poolBefore - pool(db)).toBeCloseTo(paid, 6);
    // The legacy projection followed the account rather than being written past it.
    expect(character(db).currencyBalances.savings.USD).toBeCloseTo(account(db).balance, 6);
    // The wallet is a conduit, not a resting place.
    expect(character(db).currencyBalances.personal.USD).toBeCloseTo(0, 6);
    // The debt actually came down.
    expect(character(db).lineOfCredit.balances.USD ?? 0).toBeLessThan(DRAWN);
  });

  it("keeps the legacy decrement when the currency is not in the cohort", async () => {
    const db = world([]);
    const poolBefore = pool(db);
    const accountBefore = account(db).balance;

    await run(db);

    const paid = 50_000 - character(db).currencyBalances.savings.USD;
    expect(paid).toBeGreaterThan(0);
    // Pointer model: the number goes down, nothing stands behind it, and the
    // shadow account is left for the next shadow refresh to re-sync.
    expect(account(db).balance).toBe(accountBefore);
    expect(pool(db)).toBe(poolBefore);
  });
});
