/**
 * With accounts authoritative, every savings write goes through the account
 * command and the journal; the character's legacy fields follow as
 * projections; and interest paid by a bank or the central bank moves the
 * account and the holder's liability together.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import { runSavingsCommand } from "@/lib/savings/accountsShell";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import { buildSavingsComparison } from "@/lib/savings/shadow";
import { processBankingTurn } from "@/lib/turn/bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const BANK = new ObjectId();
const OWNER = new ObjectId();
const TURN = 120;

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, savingsAccountsMode: "authoritative" },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 50_000,
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
        postedCapital: 100_000,
        cashReserves: 100_000,
        npcDeposits: 0,
        totalDeposits: 0,
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

function owner(db: InMemoryDb) {
  return db.collection("characters").docs[0] as {
    currencyBalances: {
      personal: { USD: number };
      savings: { USD: number };
      savingsHolder?: { USD: string };
    };
  };
}
function account(db: InMemoryDb): SavingsAccount {
  return db.collection("savingsAccounts").docs[0] as unknown as SavingsAccount;
}
function bank(db: InMemoryDb) {
  return db.collection("corporations").docs[0] as {
    bankCharter: { cashReserves: number; playerDeposits?: number };
  };
}
function pool(db: InMemoryDb): number {
  return (db.collection("centralBanks").docs[0] as { externalBroadMoney: number })
    .externalBroadMoney;
}

describe("authoritative savings writes", () => {
  let db: InMemoryDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = world();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("materializes the account on first use and keeps the legacy fields as projections", async () => {
    const deposited = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "deposit", amount: 250 },
      "c1"
    );
    expect(deposited.ok).toBe(true);
    expect(account(db)).toMatchObject({ balance: 1_250, holder: "centralBank", version: 1 });
    expect(owner(db).currencyBalances.personal.USD).toBe(4_750);
    expect(owner(db).currencyBalances.savings.USD).toBe(1_250);
    // The central bank holds the backing: the pool grew by the deposit.
    expect(pool(db)).toBe(50_250);
    // The migration transition claimed the existing 1_000 as central-bank liability first.
    expect(
      (db.collection("centralBanks").docs[0] as { householdSavingsLiability: number })
        .householdSavingsLiability
    ).toBe(1_250);
  });

  it("moves the whole backing on a holder change and leaves the balance untouched", async () => {
    const moved = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    expect(moved).toEqual({ ok: true, holder: BANK.toString() });
    expect(account(db)).toMatchObject({ balance: 1_000, holder: BANK.toString() });
    expect(owner(db).currencyBalances.savings.USD).toBe(1_000);
    expect(owner(db).currencyBalances.savingsHolder?.USD).toBe(BANK.toString());
    expect(pool(db)).toBe(49_000);
    expect(bank(db).bankCharter.cashReserves).toBe(101_000);
    expect(bank(db).bankCharter.playerDeposits).toBe(1_000);

    // Same holder again is a no-op for the player.
    expect(await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString())).toEqual({
      ok: true,
      holder: BANK.toString(),
    });
    expect(bank(db).bankCharter.playerDeposits).toBe(1_000);

    // Back to the central bank: the bank pays the backing out of its vault.
    const back = await moveCharacterSavings(db as unknown as Db, OWNER, "USD", "centralBank");
    expect(back.ok).toBe(true);
    expect(bank(db).bankCharter.cashReserves).toBe(100_000);
    expect(bank(db).bankCharter.playerDeposits).toBe(0);
    expect(pool(db)).toBe(50_000);
  });

  it("refuses a withdrawal a bank cannot cover, and pays it out when it can", async () => {
    await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    bank(db).bankCharter.cashReserves = 100;
    const refused = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "withdraw", amount: 500 },
      "w1"
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/cannot cover/);
    bank(db).bankCharter.cashReserves = 101_000;
    const paid = await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "withdraw", amount: 500 },
      "w2"
    );
    expect(paid.ok).toBe(true);
    expect(account(db).balance).toBe(500);
    expect(owner(db).currencyBalances.personal.USD).toBe(5_500);
    expect(bank(db).bankCharter.cashReserves).toBe(100_500);
    expect(bank(db).bankCharter.playerDeposits).toBe(500);
  });

  it("keeps the shadow comparison clean after a sequence of writes", async () => {
    await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "deposit", amount: 100 },
      "s1"
    );
    await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    await runSavingsCommand(
      db as unknown as Db,
      OWNER,
      "USD",
      { type: "withdraw", amount: 40 },
      "s2"
    );
    const comparison = await buildSavingsComparison(db as unknown as Db, TURN);
    // The charter's legacy pointer aggregate is only refreshed by the banking
    // turn; everything else agrees to the cent.
    expect(comparison.currencies[0].rowDiscrepancies).toBe(0);
    expect(comparison.currencies[0].accountOwnerTotal).toBe(1_060);
    expect(comparison.currencies[0].legacyOwnerTotal).toBe(1_060);
  });

  it("mirrors bank-paid deposit interest onto the account and the bank's liability", async () => {
    await moveCharacterSavings(db as unknown as Db, OWNER, "USD", BANK.toString());
    const summary = await processBankingTurn(db as unknown as Db, TURN + 1);
    // 1_000 at 4% over 48 turns = 0.83 for the player; the summary also
    // carries whatever the household book earned, so the player's part is
    // read off the account.
    expect(summary.depositInterestPaid).toBeGreaterThanOrEqual(0.83);
    const earned = account(db).interestEarned;
    expect(earned).toBeCloseTo(0.83, 6);
    expect(account(db).balance).toBeCloseTo(1_000 + earned, 6);
    expect(owner(db).currencyBalances.savings.USD).toBeCloseTo(1_000 + earned, 6);
    expect(bank(db).bankCharter.playerDeposits).toBeCloseTo(1_000 + earned, 6);
  });
});
