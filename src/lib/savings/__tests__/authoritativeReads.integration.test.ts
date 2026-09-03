/**
 * Once a currency is in the read cohort, the player balances a bank holds are
 * cash-backed liabilities everywhere the balance sheet is read: reserves and
 * headroom, the health report, the snapshot the rules decide on, the failure
 * waterfall, and the shadow comparison's liability check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import { buildBankingHealth } from "@/lib/banking/health";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { returnDepositBook } from "@/lib/banking/depositBookReturn";
import { buildSavingsComparison } from "@/lib/savings/shadow";
import {
  bankBalanceSheet,
  cashBackedDeposits,
  pointerDeposits,
} from "@/lib/banking/rules/balanceSheet";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const BANK = new ObjectId();
const OWNER = new ObjectId();
const TURN = 120;

function world(readCurrencies: string[]): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: readCurrencies,
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 50_000,
      householdSavingsLiability: 0,
      bankReserveRequirement: 0.1,
    },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Savings Bank",
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
        postedCapital: 10_000,
        cashReserves: 10_000,
        npcDeposits: 4_000,
        totalDeposits: 4_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
        blacklist: {},
      },
    },
  ]);
  db.seed("corporateSectors", [
    { _id: new ObjectId(), corporationId: BANK, sectorType: "financial", capitalStock: 1_000 },
  ]);
  db.seed("characters", [
    {
      _id: OWNER,
      name: "Saver",
      countryId: "US",
      savingsAccountsOpened: { USD: true },
      currencyBalances: { personal: { USD: 5_000 }, savings: { USD: 1_000 } },
    },
  ]);
  return db;
}

function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    bankCharter: {
      status: string;
      cashReserves: number;
      npcDeposits: number;
      playerDeposits?: number;
      totalDeposits: number;
    };
  };
}
function cb(db: InMemoryDb) {
  return db.collection("centralBanks").docs[0] as {
    externalBroadMoney: number;
    householdSavingsLiability: number;
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}

async function bind(db: InMemoryDb) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
}

describe("balance sheet with player deposits as liabilities", () => {
  const charter = {
    type: "retail" as const,
    status: "active" as const,
    cashReserves: 10_000,
    npcDeposits: 4_000,
    playerDeposits: 1_000,
    totalDeposits: 5_000,
    totalLoans: 0,
    postedCapital: 10_000,
    capitalStanding: "adequate" as const,
  };

  it("keeps the pointer reading by default", () => {
    expect(cashBackedDeposits(charter)).toBe(4_000);
    expect(pointerDeposits(charter)).toBe(1_000);
    const sheet = bankBalanceSheet({ charter, reserveRatio: 0.1 });
    expect(sheet.playerDeposits).toBe(0);
    expect(sheet.pointerDeposits).toBe(1_000);
    expect(sheet.requiredReserves).toBe(400);
    expect(sheet.bookEquity).toBe(6_000);
  });

  it("counts the player book as cash-backed when asked", () => {
    expect(cashBackedDeposits(charter, { playerDepositsAreLiabilities: true })).toBe(5_000);
    const sheet = bankBalanceSheet({
      charter,
      reserveRatio: 0.1,
      playerDepositsAreLiabilities: true,
    });
    expect(sheet.cashBackedDeposits).toBe(5_000);
    expect(sheet.playerDeposits).toBe(1_000);
    expect(sheet.pointerDeposits).toBe(0);
    expect(sheet.requiredReserves).toBe(500);
    expect(sheet.bookEquity).toBe(5_000);
  });
});

describe("authoritative savings reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the bank onto the account reading only for currencies in the cohort", async () => {
    for (const cohort of [[], ["USD"]]) {
      const db = world(cohort);
      await bind(db);
      const moved = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
      expect(moved.ok).toBe(true);
      expect(bank(db).bankCharter.playerDeposits).toBe(1_000);
      expect(bank(db).bankCharter.cashReserves).toBe(11_000);

      const inCohort = cohort.length > 0;
      const loaded = await loadBankingSnapshot(db as unknown as Db, BANK);
      expect(loaded?.snapshot.playerDepositsAreLiabilities).toBe(inCohort);

      const health = await buildBankingHealth(db as unknown as Db);
      const usd = health.currencies.find((c) => c.currency === "USD")!;
      expect(usd.playerCashDeposits).toBe(inCohort ? 1_000 : 0);
      expect(usd.cashBackedDeposits).toBe(inCohort ? 5_000 : 4_000);
      expect(usd.requiredReserves).toBeCloseTo(inCohort ? 500 : 400, 6);
    }
  });

  it("returns the player book with the household book when a cohort bank fails", async () => {
    const db = world(["USD"]);
    await bind(db);
    await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    expect(cb(db).householdSavingsLiability).toBe(0);
    expect(cb(db).externalBroadMoney).toBe(49_000);

    const result = await returnDepositBook(db as unknown as Db, BANK, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(result.returned).toBe(true);
    // Household 4_000 plus the player's 1_000, all from the bank's own cash.
    expect(result.npcReturned).toBe(5_000);
    expect(result.fromBankCash).toBe(5_000);
    expect(result.fromInsuranceFund).toBe(0);
    expect(bank(db).bankCharter.cashReserves).toBe(6_000);
    expect(bank(db).bankCharter.playerDeposits).toBe(0);
    expect(bank(db).bankCharter.npcDeposits).toBe(0);
    // The account is back with the central bank, and so is its backing and liability.
    expect(account(db).holder).toBe("centralBank");
    expect(cb(db).externalBroadMoney).toBe(54_000);
    expect(cb(db).householdSavingsLiability).toBe(1_000);
    const owner = db.collection("characters").docs[0] as {
      currencyBalances: { savings: { USD: number }; savingsHolder?: { USD: string } };
    };
    expect(owner.currencyBalances.savings.USD).toBe(1_000);
    expect(owner.currencyBalances.savingsHolder?.USD).toBe("centralBank");
  });

  it("counts a liability drift as a discrepancy only inside the cohort", async () => {
    const db = world(["USD"]);
    await bind(db);
    await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    const clean = await buildSavingsComparison(db as unknown as Db, TURN, {
      authoritativeCurrencies: ["USD"],
    });
    expect(clean.totalDiscrepancies).toBe(0);
    expect(clean.currencies[0].banks[0]).toMatchObject({
      charterPlayerDeposits: 1_000,
      accountLiability: 1_000,
      liabilityDrift: 0,
    });

    // Corrupt the recorded liability; the accounts still say 1_000.
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.playerDeposits": 900 } });
    const inCohort = await buildSavingsComparison(db as unknown as Db, TURN, {
      authoritativeCurrencies: ["USD"],
    });
    expect(inCohort.currencies[0].banks[0].liabilityDrift).toBe(100);
    expect(inCohort.totalDiscrepancies).toBe(1);
    // Outside the cohort the liability line is not judged at all. The pointer
    // aggregate is, and it lags the holder change until the next banking pass,
    // so that comparison reports the same single drift before and after the
    // corruption.
    const outside = await buildSavingsComparison(db as unknown as Db, TURN, {
      authoritativeCurrencies: [],
    });
    expect(outside.currencies[0].banks[0]).toMatchObject({ drift: 1_000, liabilityDrift: 100 });
    expect(outside.totalDiscrepancies).toBe(1);
  });
});
