import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import { quoteSovereignPrimaryBankPurchase } from "../rules/sovereignPrimary";
import { resumeSettlement } from "../settlementJournal";
import { bankTransferConflict } from "../transferCharter";
import type { Bond } from "@/lib/db/types/bond";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resolveBankingPolicy } from "@/lib/banking/rules/policy";
import {
  getBankTreasuryOverview,
  recoverBankTreasuryTrades,
  sweepBankTreasury,
  tradeBankTreasuryBill,
} from "../bankTreasury";
import { returnDepositBook } from "../depositBookReturn";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { bankIncomeIncludingUnbookedSovereignAssets } from "../rules/sovereignClaims";

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
    } as unknown as Record<string, unknown>,
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
  const bond = db.collection("bonds").docs[0] as unknown as Bond;
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

  it("recognizes only a funded treasury sale gain above the frozen lot basis", async () => {
    const db = world();
    await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-gain-buy",
    });
    await db.collection("bonds").updateOne({ _id: BOND }, { $set: { marketPrice: 1.2 } });
    const sale = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "sell",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-gain-sell",
    });
    expect(sale.status).toBe("completed");
    const receipt = db
      .collection("bankTreasuryTrades")
      .docs.find((row) => row._id === "treasury-gain-sell");
    expect(receipt?.costBasisLocal).toBeGreaterThan(0);
    const expectedGain = receipt!.amountLocal - receipt!.costBasisLocal!;
    expect(expectedGain).toBeGreaterThan(0);
    expect(db.collection("corporations").docs[0].bankCharter).toMatchObject({
      treasuryRealizedGainPaidLifetime: expectedGain,
    });
  });

  it("keeps an older sale receipt from rewinding a newer bank income turn", async () => {
    const db = world();
    await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-old-gain-buy",
    });
    await db.collection("bonds").updateOne({ _id: BOND }, { $set: { marketPrice: 1.2 } });
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.lastBankingIncome": 77,
          "bankCharter.lastBankingIncomeTurn": TURN + 1,
          "bankCharter.lastBankingTreasuryRealizedGain": 3,
        },
      }
    );
    const sale = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "sell",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-old-gain-sell",
    });
    expect(sale.status).toBe("completed");
    const receipt = db
      .collection("bankTreasuryTrades")
      .docs.find((row) => row._id === "treasury-old-gain-sell");
    const expectedGain = receipt!.amountLocal - receipt!.costBasisLocal!;
    expect(db.collection("corporations").docs[0].bankCharter).toMatchObject({
      lastBankingIncome: 77,
      lastBankingIncomeTurn: TURN + 1,
      lastBankingTreasuryRealizedGain: 3,
      treasuryRealizedGainPaidLifetime: expectedGain,
    });
  });

  it("adds a funded sale gain to a banking pass already stamped in that turn", async () => {
    const db = world();
    await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-after-stamp-buy",
    });
    await db.collection("bonds").updateOne({ _id: BOND }, { $set: { marketPrice: 1.2 } });
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.lastBankingIncome": 50,
          "bankCharter.lastBankingIncomeTurn": TURN,
          "bankCharter.lastBankingSovereignCouponIncome": 5,
          "bankCharter.lastBankingTreasuryRealizedGain": 0,
        },
      }
    );
    const sale = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "sell",
      units: 2,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-after-stamp-sell",
    });
    const receipt = db
      .collection("bankTreasuryTrades")
      .docs.find((row) => row._id === "treasury-after-stamp-sell");
    const expectedGain = receipt!.amountLocal - receipt!.costBasisLocal!;
    expect(sale.status).toBe("completed");
    expect(db.collection("corporations").docs[0].bankCharter).toMatchObject({
      lastBankingIncome: 50,
      lastBankingIncomeTurn: TURN,
      lastBankingSovereignCouponIncome: 5,
      treasuryRealizedGainPaidLifetime: expectedGain,
    });
    expect(
      bankIncomeIncludingUnbookedSovereignAssets(
        db.collection("corporations").docs[0].bankCharter as BankCharter
      )
    ).toBeCloseTo(50 + expectedGain);
  });

  it("skips a negative-carry automatic bill while leaving the same bill available manually", async () => {
    const db = world();
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.sovereignTreasuryAutoSweep": true } });
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { couponRate: 7, maturityTurn: TURN + 1 } });

    const automatic = await sweepBankTreasury(db as unknown as Db, BANK, POLICY, TURN);
    expect(automatic).toMatchObject({ trades: 0, completed: 0, pending: 0 });
    expect(balance(db).bond.publicFloat).toBe(100);

    const manual = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 1,
      turn: TURN,
      policy: POLICY,
      tradeId: "manual-negative-carry-remains-allowed",
    });
    expect(manual.status).toBe("completed");
    expect(balance(db).bond.publicFloat).toBe(99);
  });

  it("does not touch storage when automatic bill buying is disabled", async () => {
    const collection = vi.fn(() => {
      throw new Error("disabled treasury read");
    });
    const db = { collection } as unknown as Db;
    const disabled = resolveBankingPolicy({
      privateBankingEnabled: true,
      bankTreasuryEnabled: false,
      savingsAccountsMode: "off",
    });
    await expect(sweepBankTreasury(db, BANK, disabled, TURN)).resolves.toEqual({
      trades: 0,
      completed: 0,
      pending: 0,
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it("buys the highest-yield bill first when automatic cash can fund only one", async () => {
    const db = world();
    const lowerYieldBondId = new ObjectId("cccccccccccccccccccccccc");
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.cashReserves": 1_400,
          "bankCharter.sovereignTreasuryAutoSweep": true,
        },
      }
    );
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { couponRate: 8, maturityTurn: TURN + 48 } });
    await db.collection("bonds").insertOne({
      _id: lowerYieldBondId,
      issuerType: "sovereign",
      countryId: "US",
      issuerName: "United States",
      currencyCode: "USD",
      marketPrice: 1,
      couponRate: 6,
      maturityTurn: TURN + 48,
      matured: false,
      defaulted: false,
      publicFloat: 100,
      holders: [],
    } as unknown as Record<string, unknown>);

    const result = await sweepBankTreasury(db as unknown as Db, BANK, POLICY, TURN);
    expect(result).toMatchObject({ trades: 1, completed: 1, pending: 0 });
    expect((db.collection("bonds").docs[0] as unknown as Bond).holders).toEqual([
      expect.objectContaining({ bankId: BANK, units: 1 }),
    ]);
    expect((db.collection("bonds").docs[1] as unknown as Bond).holders).toEqual([]);
  });

  it("rechecks current carry after the overview quote changes", async () => {
    const db = world();
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.cashReserves": 10_000,
          "bankCharter.sovereignTreasuryAutoSweep": true,
        },
      }
    );
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { couponRate: 8, maturityTurn: TURN + 48 } });
    const bonds = db.collection("bonds");
    const originalFindOne = bonds.findOne.bind(bonds);
    let changedQuote = false;
    const dbWithQuoteRace = new Proxy(db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "collection")
          return (name: string) => {
            const collection = db.collection(name);
            if (name !== "bonds") return collection;
            return new Proxy(collection, {
              get(targetCollection, method, collectionReceiver) {
                if (method === "findOne")
                  return async (...args: Parameters<typeof originalFindOne>) => {
                    if (!changedQuote) {
                      changedQuote = true;
                      await db
                        .collection("bonds")
                        .updateOne({ _id: BOND }, { $set: { marketPrice: 1.2 } });
                    }
                    return originalFindOne(...args);
                  };
                const value = Reflect.get(targetCollection, method, collectionReceiver);
                return typeof value === "function" ? value.bind(targetCollection) : value;
              },
            });
          };
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await sweepBankTreasury(dbWithQuoteRace, BANK, POLICY, TURN);
    expect(changedQuote).toBe(true);
    expect(result).toMatchObject({ trades: 1, completed: 0, pending: 0 });
    expect((db.collection("bonds").docs[0] as unknown as Bond).publicFloat).toBe(100);
    expect(balance(db).cash).toBe(10_000);
  });

  it("rechecks the live funding rate after the auto plan is made", async () => {
    const db = world();
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.cashReserves": 10_000,
          "bankCharter.sovereignTreasuryAutoSweep": true,
        },
      }
    );
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { couponRate: 8, maturityTurn: TURN + 48 } });
    const centralBanks = db.collection("centralBanks");
    const originalFindOne = centralBanks.findOne.bind(centralBanks);
    let fundingLookups = 0;
    const dbWithRateRace = new Proxy(db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "collection")
          return (name: string) => {
            const collection = db.collection(name);
            if (name !== "centralBanks") return collection;
            return new Proxy(collection, {
              get(targetCollection, method, collectionReceiver) {
                if (method === "findOne")
                  return async (...args: Parameters<typeof originalFindOne>) => {
                    fundingLookups += 1;
                    if (fundingLookups === 3)
                      await db
                        .collection("centralBanks")
                        .updateOne({ _id: "US" }, { $set: { primeRate: 15 } });
                    return originalFindOne(...args);
                  };
                const value = Reflect.get(targetCollection, method, collectionReceiver);
                return typeof value === "function" ? value.bind(targetCollection) : value;
              },
            });
          };
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await sweepBankTreasury(dbWithRateRace, BANK, POLICY, TURN);
    expect(fundingLookups).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({ trades: 1, completed: 0, pending: 0 });
    expect((db.collection("bonds").docs[0] as unknown as Bond).publicFloat).toBe(100);
    expect(balance(db).cash).toBe(10_000);
  });

  it("rechecks the bank's automatic sweep setting before the trade", async () => {
    const db = world();
    await db.collection("corporations").updateOne(
      { _id: BANK },
      {
        $set: {
          "bankCharter.cashReserves": 10_000,
          "bankCharter.sovereignTreasuryAutoSweep": true,
        },
      }
    );
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { couponRate: 8, maturityTurn: TURN + 48 } });
    const corporations = db.collection("corporations");
    const originalFindOne = corporations.findOne.bind(corporations);
    let bankLookups = 0;
    const dbWithPolicyRace = new Proxy(db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "collection")
          return (name: string) => {
            const collection = db.collection(name);
            if (name !== "corporations") return collection;
            return new Proxy(collection, {
              get(targetCollection, method, collectionReceiver) {
                if (method === "findOne")
                  return async (...args: Parameters<typeof originalFindOne>) => {
                    bankLookups += 1;
                    if (bankLookups === 4)
                      await db
                        .collection("corporations")
                        .updateOne(
                          { _id: BANK },
                          { $set: { "bankCharter.sovereignTreasuryAutoSweep": false } }
                        );
                    return originalFindOne(...args);
                  };
                const value = Reflect.get(targetCollection, method, collectionReceiver);
                return typeof value === "function" ? value.bind(targetCollection) : value;
              },
            });
          };
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await sweepBankTreasury(dbWithPolicyRace, BANK, POLICY, TURN);
    expect(bankLookups).toBeGreaterThanOrEqual(4);
    expect(result).toMatchObject({ trades: 1, completed: 0, pending: 0 });
    expect((db.collection("bonds").docs[0] as unknown as Bond).publicFloat).toBe(100);
    expect(balance(db).cash).toBe(10_000);
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

  it("sells one requested quantity across multiple purchase lots", async () => {
    const db = world();
    for (const [tradeId, units] of [
      ["treasury-buy-lot-a", 3],
      ["treasury-buy-lot-b", 4],
    ] as const) {
      await expect(
        tradeBankTreasuryBill(db as unknown as Db, {
          bankId: BANK,
          bondId: BOND,
          side: "buy",
          units,
          turn: TURN,
          policy: POLICY,
          tradeId,
        })
      ).resolves.toMatchObject({ status: "completed", units });
    }
    expect(balance(db).bond.holders).toHaveLength(2);

    const sale = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "sell",
      units: 7,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-sell-combined-lots",
    });
    expect(sale).toMatchObject({ status: "completed", units: 7 });
    expect(balance(db).bond.publicFloat).toBe(100);
    expect(balance(db).bond.holders).toEqual([]);
  });

  it("preserves unrelated fractional legacy holders during a bank sale", async () => {
    const db = world();
    const characterId = new ObjectId("dddddddddddddddddddddddd");
    await db
      .collection("bonds")
      .updateOne({ _id: BOND }, { $set: { holders: [{ characterId, units: 2.5 }] } });
    await expect(
      tradeBankTreasuryBill(db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "buy",
        units: 2,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-fractional-legacy-buy",
      })
    ).resolves.toMatchObject({ status: "completed", units: 2 });
    await expect(
      tradeBankTreasuryBill(db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "sell",
        units: 2,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-fractional-legacy-sale",
      })
    ).resolves.toMatchObject({ status: "completed", units: 2 });
    expect(balance(db).bond.holders).toContainEqual({ characterId, units: 2.5 });
  });

  it("reserves overlapping multi-lot sales atomically so a loser cannot strand units", async () => {
    const db = world();
    for (const [tradeId, units] of [
      ["treasury-race-lot-a", 3],
      ["treasury-race-lot-b", 4],
    ] as const) {
      await expect(
        tradeBankTreasuryBill(db as unknown as Db, {
          bankId: BANK,
          bondId: BOND,
          side: "buy",
          units,
          turn: TURN,
          policy: POLICY,
          tradeId,
        })
      ).resolves.toMatchObject({ status: "completed", units });
    }

    const originalCollection = db.collection("bonds");
    let bondReads = 0;
    let releaseReaders!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    const gatedDb = {
      collection(name: string) {
        if (name !== "bonds") return db.collection(name);
        return new Proxy(originalCollection, {
          get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop !== "findOne" || typeof value !== "function")
              return typeof value === "function" ? value.bind(target) : value;
            return async (...args: unknown[]) => {
              const observed = await value.apply(target, args);
              if ((args[0] as { _id?: ObjectId } | undefined)?._id?.equals(BOND)) {
                bondReads += 1;
                if (bondReads === 2) releaseReaders();
                if (bondReads <= 2) await bothRead;
              }
              return observed;
            };
          },
        });
      },
    } as unknown as Db;

    const [saleA, saleB] = await Promise.all([
      tradeBankTreasuryBill(gatedDb, {
        bankId: BANK,
        bondId: BOND,
        side: "sell",
        units: 6,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-race-sale-a",
      }),
      tradeBankTreasuryBill(gatedDb, {
        bankId: BANK,
        bondId: BOND,
        side: "sell",
        units: 5,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-race-sale-b",
      }),
    ]);

    expect([saleA.status, saleB.status].sort()).toEqual(["completed", "pending"]);
    const winner = saleA.status === "completed" ? saleA : saleB;
    const pendingSale = saleA.status === "pending" ? saleA : saleB;
    expect(winner.units).toBe(saleA.status === "completed" ? 6 : 5);
    const remaining = balance(db).bond.holders.filter((holder) => holder.charteredTurn === 20);
    expect(
      remaining.reduce((sum, holder) => sum + holder.units, 0),
      JSON.stringify(balance(db).bond.holders)
    ).toBe(7 - winner.units);
    expect(remaining.every((holder) => !holder.bankTreasuryTradeId)).toBe(true);
    expect(balance(db).bond.publicFloat).toBe(100 - (7 - winner.units));

    const recovery = await recoverBankTreasuryTrades(db as unknown as Db, POLICY);
    expect(recovery).toMatchObject({ completed: 0, pending: 0, rejected: 1 });
    expect(
      db.collection("bankTreasuryTrades").docs.find((row) => row._id === pendingSale.tradeId)
    ).toMatchObject({ status: "rejected" });
    expect(
      db
        .collection("bankMoneyMoves")
        .docs.find((row) => row._id === `bank-treasury:${pendingSale.tradeId}:reserve`)
    ).toMatchObject({ status: "rejected" });
  });

  it("makes stale reservation refusal atomic across concurrent resumers of one receipt", async () => {
    const db = world();
    for (const [tradeId, units] of [
      ["treasury-stale-lot-a", 3],
      ["treasury-stale-lot-b", 4],
    ] as const) {
      await tradeBankTreasuryBill(db as unknown as Db, {
        bankId: BANK,
        bondId: BOND,
        side: "buy",
        units,
        turn: TURN,
        policy: POLICY,
        tradeId,
      });
    }

    const crash = withInjectedCrash(db, {
      collection: "bonds",
      op: "updateOne",
      onCall: 1,
    });
    await expect(
      tradeBankTreasuryBill(crash.db, {
        bankId: BANK,
        bondId: BOND,
        side: "sell",
        units: 6,
        turn: TURN,
        policy: POLICY,
        tradeId: "treasury-stale-sale-1",
      })
    ).rejects.toBeInstanceOf(InjectedCrash);
    crash.disarm();

    const bond = db.collection("bonds").docs[0] as unknown as Bond;
    const holders = structuredClone(bond.holders ?? []);
    holders[0] = { ...holders[0]!, units: holders[0]!.units - 1 };
    await db.collection("bonds").updateOne({ _id: BOND }, { $set: { holders } });

    await Promise.all([
      recoverBankTreasuryTrades(db as unknown as Db, POLICY),
      recoverBankTreasuryTrades(db as unknown as Db, POLICY),
    ]);
    await recoverBankTreasuryTrades(db as unknown as Db, POLICY);

    const receipt = db
      .collection("bankTreasuryTrades")
      .docs.find((row) => row._id === "treasury-stale-sale-1");
    const refusal = db
      .collection("bankMoneyMoves")
      .docs.find((row) => row._id === `bank-treasury:${receipt?._id}:reserve`);
    expect(receipt).toMatchObject({ status: "rejected" });
    expect(refusal).toMatchObject({ status: "rejected" });
    expect(balance(db).bond.holders.reduce((sum, holder) => sum + holder.units, 0)).toBe(6);
    expect(balance(db).bond.holders.every((holder) => !holder.bankTreasuryTradeId)).toBe(true);
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
    const secondBuy = await tradeBankTreasuryBill(db as unknown as Db, {
      bankId: BANK,
      bondId: BOND,
      side: "buy",
      units: 4,
      turn: TURN,
      policy: POLICY,
      tradeId: "treasury-estate-buy-2",
    });
    expect(secondBuy.status).toBe("completed");
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

const PRIMARY_POLICY = resolveBankingPolicy({
  privateBankingEnabled: true,
  bankTreasuryEnabled: true,
  bankSovereignPrimaryEnabled: true,
  treasuryCashLedgerEnabled: true,
  bankPropTradingEnabled: true,
});

function primaryWorld() {
  const db = world();
  const bank = db.collection("corporations").docs[0] as unknown as Corporation;
  bank.bankCharter!.type = "investment";
  const bond = db.collection("bonds").docs[0] as unknown as Bond;
  bond.maturityTurn = TURN + 240;
  bond.publicFloat = 0;
  bond.unsoldUnits = 100;
  bond.totalIssued = 0;
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 0,
      treasuryBalance: 0,
      debt: { principal: 0 },
      spending: { debtInterest: 0, total: 0 },
      surplus: 0,
    },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "1991-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  Object.assign(db.collection("gameConfig").docs[0], {
    treasuryCashLedgerEnabled: true,
    bankSovereignPrimaryEnabled: true,
  });
  return db;
}

const primaryTicket = {
  bankId: BANK,
  bondId: BOND,
  side: "buy" as const,
  units: 5,
  turn: TURN,
  policy: PRIMARY_POLICY,
  primary: true,
  maxCostLocal: 10_000,
  tradeId: "primary-investment-subscription",
};

function primaryState(db: InMemoryDb) {
  return {
    bank: db.collection("corporations").docs[0] as unknown as Corporation,
    bond: db.collection("bonds").docs[0] as unknown as Bond,
    budget: db.collection("federalBudget").docs[0] as {
      treasuryCashLocal: number;
      debt: { principal: number };
      spending: { debtInterest: number };
    },
    pool: db.collection("bondMarketPools").docs[0].cashLocal,
  };
}

describe("investment-bank sovereign primary subscriptions", () => {
  it("does not treat posted capital or borrowed vault cash as additional equity", () => {
    const db = primaryWorld();
    const state = primaryState(db);
    const charter = state.bank.bankCharter!;
    Object.assign(charter, {
      cashReserves: 5_000,
      postedCapital: 1_000_000,
      npcDeposits: 0,
      totalDeposits: 0,
      cbMarginDebt: 4_900,
    });
    expect(
      quoteSovereignPrimaryBankPurchase({
        charter,
        bond: state.bond,
        turn: TURN,
        requestedUnits: 1,
        askPerUnit: 1_000,
        bidPerUnit: 950,
        maxCostLocal: 1_000,
        floorLocal: 0,
        playerDepositsAreLiabilities: false,
      })
    ).toMatchObject({ ok: false });
  });

  it("refuses a changed vault quote rather than funding a newly unsafe book", async () => {
    const db = primaryWorld();
    const state = primaryState(db);
    const crash = withInjectedCrash(db, {
      collection: "bonds",
      op: "updateOne",
      onCall: 1,
      matches: (args) =>
        Number((args[1] as { $inc?: { unsoldUnits?: number } }).$inc?.unsoldUnits) < 0,
      afterWrite: true,
    });
    await expect(tradeBankTreasuryBill(crash.db, primaryTicket)).rejects.toThrow("crash");
    state.bank.bankCharter!.cashReserves = 10_000;
    expect((await tradeBankTreasuryBill(db as unknown as Db, primaryTicket)).status).toBe(
      "rejected"
    );
    expect(state.bank.bankCharter!.cashReserves).toBe(10_000);
    expect(state.budget.treasuryCashLocal).toBe(0);
    expect(state.bond.unsoldUnits).toBe(100);
    expect(state.bond.totalIssued).toBe(0);
    expect(state.bank.bankPrimaryFunding).toBeUndefined();
  });

  it("conserves available primary units under competing bank subscriptions", async () => {
    const db = primaryWorld();
    const state = primaryState(db);
    state.bond.unsoldUnits = 7;
    const otherBank = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaab");
    db.collection("corporations").docs.push({
      ...state.bank,
      _id: otherBank,
      bankCharter: { ...state.bank.bankCharter! },
    });
    const results = await Promise.all([
      tradeBankTreasuryBill(db as unknown as Db, primaryTicket),
      tradeBankTreasuryBill(db as unknown as Db, {
        ...primaryTicket,
        bankId: otherBank,
        tradeId: "primary-competing-bank",
      }),
    ]);
    const issued = results.filter((r) => r.status === "completed").reduce((n, r) => n + r.units, 0);
    expect(issued).toBeGreaterThan(0);
    expect(issued).toBeLessThanOrEqual(7);
    expect(state.bond.unsoldUnits! + issued).toBe(7);
    expect(state.bond.totalIssued).toBe(issued * 1_000);
    expect(state.budget.debt.principal).toBe(issued * 1_000);
    const bankCash = db
      .collection("corporations")
      .docs.reduce((n, c) => n + (c.bankCharter as { cashReserves: number }).cashReserves, 0);
    expect(bankCash + state.budget.treasuryCashLocal).toBe(200_000);
    expect(state.pool).toBe(100_000);
  });
  it("pays the issuer rather than the pool and issues only funded original-epoch debt", async () => {
    const db = primaryWorld();
    const result = await tradeBankTreasuryBill(db as unknown as Db, primaryTicket);
    expect(result).toMatchObject({ status: "completed", units: 5 });
    const state = primaryState(db);
    expect(state.bank.bankCharter!.cashReserves! + state.budget.treasuryCashLocal).toBe(100_000);
    expect(state.pool).toBe(100_000);
    expect(state.bond).toMatchObject({ publicFloat: 0, unsoldUnits: 95, totalIssued: 5_000 });
    expect(state.bond.holders).toEqual([
      expect.objectContaining({
        bankId: BANK,
        charteredTurn: 20,
        units: 5,
        bankTreasuryLotId: primaryTicket.tradeId,
      }),
    ]);
    expect(state.budget.debt.principal).toBe(5_000);
    expect(state.budget.spending.debtInterest).toBe(200);
    expect(state.bank.bankPrimaryFunding).toBeUndefined();
    const paid = state.budget.treasuryCashLocal;
    state.bond.marketPrice = 2;
    await tradeBankTreasuryBill(db as unknown as Db, { ...primaryTicket, turn: TURN + 1 });
    expect(state.budget.treasuryCashLocal).toBe(paid);
    expect(state.budget.debt.principal).toBe(5_000);
    expect(state.bond.holders).toHaveLength(1);
  });

  it("does no additional database access when primary subscriptions are off", async () => {
    const db = {
      collection: vi.fn(() => {
        throw new Error("unexpected read");
      }),
    };
    const result = await tradeBankTreasuryBill(db as unknown as Db, {
      ...primaryTicket,
      policy: POLICY,
    });
    expect(result.status).toBe("rejected");
    expect(db.collection).not.toHaveBeenCalled();
  });

  it.each(["retail", "currency", "price", "cash", "standing"])(
    "refuses invalid %s before any issue",
    async (reason) => {
      const db = primaryWorld();
      const state = primaryState(db);
      let ticket = { ...primaryTicket };
      if (reason === "retail") state.bank.bankCharter!.type = "retail";
      if (reason === "currency") state.bond.currencyCode = "GBP";
      if (reason === "price") ticket = { ...ticket, maxCostLocal: 1 };
      if (reason === "cash") state.bank.bankCharter!.cashReserves = 50;
      if (reason === "standing") state.bank.bankCharter!.capitalStanding = "stressed";
      expect((await tradeBankTreasuryBill(db as unknown as Db, ticket)).status).toBe("rejected");
      expect(state.budget.treasuryCashLocal).toBe(0);
      expect(state.budget.debt.principal).toBe(0);
      expect(state.bond.unsoldUnits).toBe(100);
      expect(state.bond.holders).toEqual([]);
    }
  );

  it("releases reserved unissued units when the original epoch ends before cash", async () => {
    const db = primaryWorld();
    const state = primaryState(db);
    const crash = withInjectedCrash(db, {
      collection: "bonds",
      op: "updateOne",
      onCall: 1,
      matches: (args) =>
        Number((args[1] as { $inc?: { unsoldUnits?: number } }).$inc?.unsoldUnits) < 0,
      afterWrite: true,
    });
    await expect(tradeBankTreasuryBill(crash.db, primaryTicket)).rejects.toThrow("crash");
    state.bank.bankCharter!.charteredTurn = 21;
    expect((await tradeBankTreasuryBill(db as unknown as Db, primaryTicket)).status).toBe(
      "rejected"
    );
    expect(state.bond.unsoldUnits).toBe(100);
    expect(state.bond.holders).toEqual([]);
    expect(state.budget.treasuryCashLocal).toBe(0);
    expect(state.budget.debt.principal).toBe(0);
  });

  const boundaries = [
    { label: "reservation", collection: "bonds", path: "unsoldUnits", positive: false },
    {
      label: "bank debit",
      collection: "corporations",
      path: "bankCharter.cashReserves",
      positive: false,
    },
    {
      label: "Treasury credit",
      collection: "federalBudget",
      path: "treasuryCashLocal",
      positive: true,
    },
    { label: "issued units", collection: "bonds", path: "totalIssued", positive: true },
    {
      label: "debt obligation",
      collection: "federalBudget",
      path: "debt.principal",
      positive: true,
    },
  ];
  it.each(boundaries)(
    "recovers original quote after $label without duplicate cash or debt",
    async (boundary) => {
      const db = primaryWorld();
      const state = primaryState(db);
      const crash = withInjectedCrash(db, {
        collection: boundary.collection,
        op: "updateOne",
        onCall: 1,
        matches: (args) => {
          const inc = (args[1] as { $inc?: Record<string, number> }).$inc;
          return (
            inc?.[boundary.path] !== undefined &&
            (boundary.positive ? inc[boundary.path]! > 0 : inc[boundary.path]! < 0)
          );
        },
        afterWrite: true,
      });
      await expect(tradeBankTreasuryBill(crash.db, primaryTicket)).rejects.toThrow("crash");
      state.bond.marketPrice = 2;
      if (state.bank.bankPrimaryFunding) {
        expect(bankTransferConflict(state.bank, { name: "Buyer" })).toContain("primary funding");
        const paid = await resumeSettlement(
          db as unknown as Db,
          `bank-treasury:${primaryTicket.tradeId}:cash`
        );
        expect(["applied", "replayed"]).toContain(paid.status);
      }
      const result = await tradeBankTreasuryBill(db as unknown as Db, {
        ...primaryTicket,
        turn: TURN + 1,
      });
      expect(result.status).toBe("completed");
      expect(state.bank.bankCharter!.cashReserves! + state.budget.treasuryCashLocal).toBe(100_000);
      expect(state.pool).toBe(100_000);
      expect(state.bond.unsoldUnits).toBe(95);
      expect(state.bond.holders).toHaveLength(1);
      expect(state.bond.totalIssued).toBe(5_000);
      expect(state.budget.debt.principal).toBe(5_000);
      expect(state.budget.spending.debtInterest).toBe(200);
      expect(state.bank.bankPrimaryFunding).toBeUndefined();
    }
  );

  it("finishes a funded obligation through the existing journal after feature switches are off", async () => {
    const db = primaryWorld();
    const state = primaryState(db);
    const crash = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      matches: (args) =>
        Number((args[1] as { $inc?: Record<string, number> }).$inc?.["bankCharter.cashReserves"]) <
        0,
      afterWrite: true,
    });
    await expect(tradeBankTreasuryBill(crash.db, primaryTicket)).rejects.toThrow("crash");
    Object.assign(db.collection("gameConfig").docs[0], {
      bankSovereignPrimaryEnabled: false,
      bankTreasuryEnabled: false,
      treasuryCashLedgerEnabled: false,
    });
    const result = await resumeSettlement(
      db as unknown as Db,
      `bank-treasury:${primaryTicket.tradeId}:cash`
    );
    expect(["applied", "replayed"]).toContain(result.status);
    expect(state.bank.bankCharter!.cashReserves! + state.budget.treasuryCashLocal).toBe(100_000);
    expect(state.budget.debt.principal).toBe(5_000);
    expect(state.bank.bankPrimaryFunding).toBeUndefined();
  });
});
