import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resolveBankingPolicy } from "@/lib/banking/rules/policy";
import {
  getBankTreasuryOverview,
  recoverBankTreasuryTrades,
  tradeBankTreasuryBill,
} from "../bankTreasury";
import { returnDepositBook } from "../depositBookReturn";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const BANK = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
const BOND = new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const TURN = 100;
const POLICY = resolveBankingPolicy({
  privateBankingEnabled: true,
  bankTreasuryEnabled: true,
  savingsAccountsMode: "off",
});

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankTreasuryEnabled: true },
  ]);
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", primeRate: 4, bankReserveRequirement: 0.1 },
  ]);
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Test bank",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 0,
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 20,
        postedCapital: 100_000,
        cashReserves: 100_000,
        npcDeposits: 1_000,
        totalDeposits: 1_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
      },
    },
  ]);
  db.seed("bonds", [
    {
      _id: BOND,
      issuerType: "sovereign",
      countryId: "US",
      issuerName: "United States",
      currencyCode: "USD",
      marketPrice: 1,
      couponRate: 4,
      maturityTurn: TURN + 24,
      matured: false,
      defaulted: false,
      publicFloat: 100,
      holders: [],
    } as unknown as Bond,
  ]);
  db.seed("bondMarketPools", [
    {
      _id: "USD",
      cashLocal: 100_000,
      targetCashLocal: 100_000,
      lifetime: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ]);
  return db;
}

function balance(db: InMemoryDb) {
  const corp = db.collection("corporations").docs[0] as {
    bankCharter: { cashReserves: number; sovereignTreasuryMarkValue?: number };
  };
  const bond = db.collection("bonds").docs[0] as Bond;
  const pool = db.collection("bondMarketPools").docs[0] as { cashLocal: number };
  return {
    cash: corp.bankCharter.cashReserves,
    mark: corp.bankCharter.sovereignTreasuryMarkValue ?? 0,
    bond: structuredClone(bond),
    pool: { cashLocal: pool.cashLocal },
  };
}

describe("funded bank treasury settlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("buys only against bank cash and public float, then sells only against pool cash", async () => {
    const db = world();
    const opening = balance(db);
    const buy = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 5,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-buy-1",
    });
    expect(buy).toMatchObject({ status: "completed", units: 5 });
    const afterBuy = balance(db);
    expect(afterBuy.cash).toBeLessThan(opening.cash);
    expect(afterBuy.bond.publicFloat).toBe(95);
    expect(afterBuy.bond.holders).toEqual([
      expect.objectContaining({ bankId: BANK, charteredTurn: 20, units: 5 }),
    ]);
    expect(afterBuy.pool.cashLocal).toBeGreaterThan(opening.pool.cashLocal);
    expect(afterBuy.mark).toBeGreaterThan(0);
    const replay = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 5,
      turn: TURN + 1,
      policy: POLICY,
      tradeId: "treasury-buy-1",
    });
    expect(replay).toMatchObject({ status: "completed", units: 5 });
    expect(balance(db).cash).toBe(afterBuy.cash);
    expect(balance(db).pool.cashLocal).toBe(afterBuy.pool.cashLocal);

    const sell = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "sell",
      units: 5,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-sell-1",
    });
    expect(sell, JSON.stringify(sell)).toMatchObject({ status: "completed", units: 5 });
    const afterSell = balance(db);
    expect(afterSell.cash).toBeGreaterThan(afterBuy.cash);
    expect(afterSell.bond.publicFloat).toBe(100);
    expect(afterSell.bond.holders).toEqual([]);
    expect(afterSell.mark).toBe(0);
  });

  it("does not query treasury data when the feature is off", async () => {
    const db = {
      collection: () => {
        throw new Error("feature-off treasury read");
      },
    };
    const disabled = resolveBankingPolicy({ privateBankingEnabled: true });
    await expect(
      getBankTreasuryOverview(db as unknown as Db, BANK, disabled, TURN)
    ).resolves.toBeNull();
    await expect(
      tradeBankTreasuryBill(db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "buy",
        units: 1,
        turn: TURN,
        policy: disabled,
      })
    ).resolves.toMatchObject({ status: "rejected", error: "Bank treasury bills are disabled" });
  });

  it("recovers a crash after the bank debit without charging twice", async () => {
    const db = world();
    const initialCash = balance(db).cash;
    const initialPoolCash = balance(db).pool.cashLocal;
    const faulty = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return (update.$inc?.["bankCharter.cashReserves"] ?? 0) < 0;
      },
    });
    await expect(
      tradeBankTreasuryBill(faulty.db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "buy",
        units: 5,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-crash-buy-1",
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    expect(balance(db).cash).toBeLessThan(initialCash);
    expect(balance(db).pool.cashLocal).toBe(initialPoolCash);

    const recovery = await recoverBankTreasuryTrades(db as unknown as Db, POLICY);
    expect(recovery).toMatchObject({ completed: 1, pending: 0, rejected: 0 });
    expect(balance(db).cash).toBeLessThan(initialCash);
    expect(balance(db).pool.cashLocal).toBeGreaterThan(initialPoolCash);
    expect(balance(db).bond.publicFloat).toBe(95);
    expect(balance(db).bond.holders).toEqual([
      expect.objectContaining({ bankId: BANK, charteredTurn: 20, units: 5 }),
    ]);
    const movedCash = initialCash - balance(db).cash;
    expect(initialPoolCash + movedCash).toBe(balance(db).pool.cashLocal);
  });

  it("recovers a crash after float reservation without reserving the bill twice", async () => {
    const db = world();
    const initialCash = balance(db).cash;
    const faulty = withInjectedCrash(db, {
      collection: "bonds",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return (update.$inc?.publicFloat ?? 0) < 0;
      },
    });
    await expect(
      tradeBankTreasuryBill(faulty.db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "buy",
        units: 5,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-reservation-crash-1",
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    expect(balance(db).bond.publicFloat).toBe(95);

    const recovery = await recoverBankTreasuryTrades(db as unknown as Db, POLICY);
    expect(recovery).toMatchObject({ completed: 1, pending: 0, rejected: 0 });
    expect(balance(db).cash).toBeLessThan(initialCash);
    expect(balance(db).bond.publicFloat).toBe(95);
    expect(balance(db).bond.holders).toEqual([
      expect.objectContaining({ bankId: BANK, charteredTurn: 20, units: 5 }),
    ]);
  });

  it("recovers a crash after the pool debit without losing or duplicating sale proceeds", async () => {
    const db = world();
    const buy = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 5,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-sale-crash-setup",
    });
    expect(buy.status).toBe("completed");
    const beforeSale = balance(db);
    const faulty = withInjectedCrash(db, {
      collection: "bondMarketPools",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return (update.$inc?.cashLocal ?? 0) < 0;
      },
    });
    await expect(
      tradeBankTreasuryBill(faulty.db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "sell",
        units: 5,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-sale-crash-1",
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    expect(balance(db).cash).toBe(beforeSale.cash);
    expect(balance(db).pool.cashLocal).toBeLessThan(beforeSale.pool.cashLocal);

    const recovery = await recoverBankTreasuryTrades(db as unknown as Db, POLICY);
    expect(recovery).toMatchObject({ completed: 1, pending: 0, rejected: 0 });
    expect(balance(db).cash).toBeGreaterThan(beforeSale.cash);
    expect(balance(db).bond.publicFloat).toBe(100);
    expect(balance(db).bond.holders).toEqual([]);
    const fundedProceeds = balance(db).cash - beforeSale.cash;
    expect(beforeSale.pool.cashLocal - balance(db).pool.cashLocal).toBe(fundedProceeds);
  });

  it("sells only funded depth before closing a failed estate's cash waterfall", async () => {
    const db = world();
    const buy = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 5,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-estate-buy-1",
    });
    expect(buy.status).toBe("completed");
    await db
      .collection("corporations")
      .updateOne(
        { _id: BANK },
        { $set: { "bankCharter.status": "failed", "bankCharter.failedTurn": TURN } }
      );
    const result = await returnDepositBook(db as unknown as Db, BANK, {
      cause: "failure",
      turn: TURN,
      releaseResidualToOwner: false,
    });
    expect(result).toMatchObject({ returned: true, fromBankCash: 1_000 });
    const after = balance(db);
    expect(after.bond.publicFloat).toBe(100);
    expect(after.bond.holders).toEqual([]);
    expect(after.mark).toBe(0);
    expect(after.cash).toBeGreaterThan(90_000);
  });
});
