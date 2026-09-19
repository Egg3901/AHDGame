/**
 * Bank-held savings earn the CB base APY in savingsInterestTurn unless their
 * currency reads authoritative (the bank pays the full rate there).
 *
 * The bank used to pay the full posted rate out of vault cash on pointer
 * balances that never arrived as cash; it now pays only the over-CB premium,
 * and this phase pays the base. These tests pin the base half: legacy
 * bank-held balances accrue and flush base, authoritative bank-held balances
 * accrue nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSavingsInterestTurn } from "@/lib/turn/savingsInterestTurn";
import { computeSavingsInterestForTurn } from "@/lib/currency/savingsInterest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

const BANK_ID = new ObjectId().toString();
const SAVER = new ObjectId();
/** Non-quarter turn: accrual runs, quarterly flush does not. */
const ACCRUAL_TURN = 500;
/** Quarter turn (divisible by 12): pending flushes into balances. */
const FLUSH_TURN = 504;

function world(savingsAccountsMode: string, readCurrencies: string[]): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    {
      _id: "default",
      forexEnabled: true,
      privateBankingEnabled: true,
      savingsAccountsMode,
      savingsAccountsReadCurrencies: readCurrencies,
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: ACCRUAL_TURN, preset: "2019-default" }]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 5,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 1_000_000,
      // Deep pool so the 25% share cap does not bind the 48k saver.
      nationalSavingsBalance: 1_000_000_000,
    },
  ]);
  db.seed("characters", [
    {
      _id: SAVER,
      name: "Saver",
      countryId: "US",
      currencyBalances: {
        savings: { USD: 48_000 },
        savingsHolder: { USD: BANK_ID },
        pendingSavingsInterest: {},
        interestEarned: {},
      },
    },
  ]);
  return db;
}

async function saver(db: InMemoryDb) {
  return db.collection("characters").findOne({ _id: SAVER }) as Promise<{
    currencyBalances: {
      savings: Record<string, number>;
      pendingSavingsInterest: Record<string, number>;
    };
  }>;
}

describe("savingsInterestTurn base APY for bank-held savings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accrues CB base on bank-held balances in legacy mode", async () => {
    const db = world("off", []);
    await processSavingsInterestTurn(db as unknown as Db, ACCRUAL_TURN);

    const doc = await saver(db);
    // Base APY = max(0.5, 5 - 0) / 2 = 2.5; 48000 * 0.025 / 48 = 25.
    const expected = computeSavingsInterestForTurn(48_000, 5, "USD", 0);
    expect(expected).toBe(25);
    expect(doc.currencyBalances.pendingSavingsInterest.USD ?? 0).toBeCloseTo(expected, 8);
  });

  it("accrues no CB base on bank-held balances in an authoritative currency", async () => {
    const db = world("authoritative", ["USD"]);
    await processSavingsInterestTurn(db as unknown as Db, ACCRUAL_TURN);

    const doc = await saver(db);
    expect(doc.currencyBalances.pendingSavingsInterest.USD ?? 0).toBe(0);
  });

  it("flushes accrued base to bank-held balances in legacy mode", async () => {
    const db = world("off", []);
    await processSavingsInterestTurn(db as unknown as Db, ACCRUAL_TURN);
    const pending = (await saver(db)).currencyBalances.pendingSavingsInterest.USD ?? 0;
    expect(pending).toBeGreaterThan(0);

    // The first pass rewrites the pool stock with this tiny world; restore a
    // deep pool so the share cap stays out of the picture for the flush pass.
    await db
      .collection("centralBanks")
      .updateOne({ _id: "US" }, { $set: { nationalSavingsBalance: 1_000_000_000 } });
    await processSavingsInterestTurn(db as unknown as Db, FLUSH_TURN);
    const doc = await saver(db);
    // The flush pass accrues one more turn (25) before crediting all pending.
    expect(doc.currencyBalances.savings.USD).toBeCloseTo(48_000 + pending + 25, 8);
    expect(doc.currencyBalances.pendingSavingsInterest.USD ?? 0).toBe(0);
  });
});
