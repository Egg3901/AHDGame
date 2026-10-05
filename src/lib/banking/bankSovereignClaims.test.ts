import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { Bond } from "@/lib/db/types/bond";
import type { BankCharter } from "@/lib/db/types/bank";
import type { BankSovereignClaim, FederalBudget } from "@/lib/db/types/budget";
import { treasuryAccrualWithBankCouponReserve } from "@/lib/budget/rules/treasuryAccrual";
import { addBankMaturityClaims, settleBankSovereignClaims } from "./bankSovereignClaims";
import {
  bankCouponClaim,
  bankCouponPlanForCountry,
  bankIncomeIncludingUnbookedSovereignAssets,
  unbookedSovereignAssetIncome,
} from "./rules/sovereignClaims";
import {
  freezeFundedSovereignBondMaturityQuote,
  settleFundedSovereignBondMaturity,
  settleSovereignBondMaturity,
} from "@/lib/bonds/sovereign";

const bankId = new ObjectId("650000000000000000000001");

function couponClaim(amountLocal = 10): BankSovereignClaim {
  return {
    id: "bank-sovereign-coupon:US:12:650000000000000000000001:4",
    kind: "coupon",
    bankId: bankId.toHexString(),
    charteredTurn: 4,
    countryId: "US",
    currencyCode: "USD",
    amountLocal,
    turn: 12,
    bondIds: ["650000000000000000000002"],
    anchorRate: 1,
  };
}

function world(claim: BankSovereignClaim, treasuryBalance = 100): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      treasuryBalance,
      bankSovereignClaims: [claim],
    },
  ]);
  db.seed("corporations", [
    {
      _id: bankId,
      bankCharter: {
        status: "active",
        currency: "USD",
        charteredTurn: 4,
        cashReserves: 5,
      },
    },
  ]);
  return db;
}

function budget(db: InMemoryDb) {
  return db.collection("federalBudget").docs[0] as unknown as FederalBudget;
}

function vault(db: InMemoryDb): number {
  return (db.collection("corporations").docs[0].bankCharter as { cashReserves: number })
    .cashReserves;
}

function failEscrowCredit(memory: InMemoryDb): Db {
  return {
    collection(name: string) {
      const collection = memory.collection(name);
      if (name !== "corporations") return collection;
      return new Proxy(collection, {
        get(target, property, receiver) {
          if (property === "updateOne") {
            return async (filter: unknown, update: unknown, options?: unknown) => {
              const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};
              if (
                Object.entries(inc).some(
                  ([path, amount]) => path.startsWith("bankSovereignEscrows.") && amount > 0
                )
              ) {
                return {
                  acknowledged: true,
                  matchedCount: 0,
                  modifiedCount: 0,
                  upsertedCount: 0,
                  upsertedId: null,
                };
              }
              return target.updateOne(filter as never, update as never, options as never);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as Db;
}

describe("bank sovereign claims", () => {
  it("freezes only same-country, same-currency, accruing sovereign coupons by charter epoch", () => {
    const bond = {
      _id: new ObjectId("650000000000000000000002"),
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      couponRate: 4.8,
      defaulted: false,
      holders: [{ bankId, charteredTurn: 4, units: 100 }],
    } as unknown as Bond;
    const excluded = [
      { ...bond, _id: new ObjectId(), defaulted: true },
      { ...bond, _id: new ObjectId(), countryId: "UK" },
      { ...bond, _id: new ObjectId(), currencyCode: "GBP" },
      { ...bond, _id: new ObjectId(), issuerType: "corporate" },
    ] as unknown as Bond[];
    const plan = bankCouponPlanForCountry([bond, ...excluded], "US", "USD");
    expect(plan).toEqual([
      {
        bankId: bankId.toHexString(),
        charteredTurn: 4,
        amountLocal: 100,
        bondIds: [bond._id.toHexString()],
      },
    ]);
    expect(
      bankCouponClaim({
        countryId: "US",
        currencyCode: "USD",
        turn: 12,
        plan: plan[0],
        ledgerCreatedAt: new Date("2026-10-04T00:00:00.000Z"),
      })
    ).toMatchObject({
      id: "bank-sovereign-coupon:US:12:650000000000000000000001:4",
      kind: "coupon",
      amountLocal: 100,
    });
  });

  it("rounds coupon plans to the currency minor unit", () => {
    const bond = {
      _id: new ObjectId("650000000000000000000003"),
      issuerType: "sovereign",
      countryId: "JP",
      currencyCode: "JPY",
      couponRate: 3,
      defaulted: false,
      holders: [{ bankId, charteredTurn: 4, units: 1 }],
    } as unknown as Bond;
    expect(bankCouponPlanForCountry([bond], "JP", "JPY")[0].amountLocal).toBe(1);
    expect(
      bankCouponPlanForCountry([{ ...bond, currencyCode: "USD" }], "JP", "USD")[0].amountLocal
    ).toBe(0.63);
  });

  it("reserves no more than planned service and preserves the gross rounded cash flow", () => {
    const input = {
      turn: 12,
      openingCash: 100,
      currencyCode: "USD" as const,
      anchorRate: 1,
      anchorRateSource: "observed" as const,
      anchorRatePreset: "test",
      ledgerShadow: true,
      annualRevenue: 0,
      annualPrimarySpending: 0,
      debtService: 10.5,
      enforcement: 0,
    };
    const gross = treasuryAccrualWithBankCouponReserve(input, 0);
    const reserved = treasuryAccrualWithBankCouponReserve(input, 20);
    expect(reserved.components.debtService).toBeCloseTo(0);
    expect(reserved.cashDelta - Math.min(10.5, -gross.components.debtService)).toBeCloseTo(
      gross.cashDelta
    );
    expect(reserved.components.rounding).toBe(gross.components.rounding);
  });

  it("settles the guarded transfer once and resumes a crash after the bank credit", async () => {
    const claim = { ...couponClaim(), ledgerShadow: true };
    const memory = world(claim);
    const crash = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 4,
      afterWrite: true,
    });
    await expect(
      settleBankSovereignClaims(crash.db as unknown as Db, budget(memory), 13)
    ).rejects.toThrow("crash");
    expect(vault(memory)).toBe(15);
    expect(
      memory.collection("corporations").docs[0].bankCharter?.sovereignCouponIncomePaidLifetime
    ).toBe(10);

    await memory
      .collection("corporations")
      .updateOne({ _id: bankId }, { $set: { "bankCharter.charteredTurn": 5 } });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(vault(memory)).toBe(15);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("depositInsuranceFunds").docs).toEqual([]);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
    expect(memory.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: `${claim.id}:funding:13`, status: "applied" }),
        expect.objectContaining({ _id: `${claim.id}:bank:13`, status: "applied" }),
      ])
    );
  });

  it("records a funded coupon beside the vault credit for later income publication", async () => {
    const claim = { ...couponClaim(), treasuryCashLedgerEnabled: true };
    const memory = world(claim);
    memory.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    memory.collection("corporations").docs[0].bankCharter = {
      status: "active",
      currency: "USD",
      charteredTurn: claim.charteredTurn,
      cashReserves: 5,
      lastBankingTurn: 13,
      lastBankingIncome: 40,
      lastBankingIncomeTurn: 13,
      lastBankingSovereignCouponIncome: 0,
    };
    const frozenBudget = budget(memory);

    await settleBankSovereignClaims(memory as unknown as Db, frozenBudget, 13);
    await settleBankSovereignClaims(memory as unknown as Db, frozenBudget, 13);

    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      cashReserves: 15,
      lastBankingIncome: 40,
      lastBankingIncomeTurn: 13,
      sovereignCouponIncomePaidLifetime: 10,
    });
    expect(
      bankIncomeIncludingUnbookedSovereignAssets(
        memory.collection("corporations").docs[0].bankCharter as BankCharter
      )
    ).toBe(50);
  });

  it("keeps a delayed coupon unbooked until the next banking income publication", async () => {
    const claim = { ...couponClaim(), treasuryCashLedgerEnabled: true };
    const memory = world(claim);
    memory.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    memory.collection("corporations").docs[0].bankCharter = {
      status: "active",
      currency: "USD",
      charteredTurn: claim.charteredTurn,
      cashReserves: 5,
      lastBankingIncome: 37,
      lastBankingIncomeTurn: 12,
      lastBankingSovereignCouponIncome: 27,
    };
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      lastBankingIncome: 37,
      lastBankingIncomeTurn: 12,
      sovereignCouponIncomePaidLifetime: 10,
    });
    expect(
      unbookedSovereignAssetIncome(
        memory.collection("corporations").docs[0].bankCharter as BankCharter
      )
    ).toEqual({ couponIncome: 10, realizedGain: 0 });
  });

  it("pays a stale frozen coupon without moving a newer income stamp backwards", async () => {
    const claim = { ...couponClaim(), treasuryCashLedgerEnabled: true };
    const memory = world(claim);
    memory.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    memory.collection("corporations").docs[0].bankCharter = {
      status: "active",
      currency: "USD",
      charteredTurn: claim.charteredTurn,
      cashReserves: 5,
      lastBankingIncome: 77,
      lastBankingIncomeTurn: 14,
      lastBankingSovereignCouponIncome: 11,
    };
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(vault(memory)).toBe(15);
    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      lastBankingIncome: 77,
      lastBankingIncomeTurn: 14,
      lastBankingSovereignCouponIncome: 11,
      sovereignCouponIncomePaidLifetime: 10,
    });
  });

  it("recognizes only the funded maturity gain above a frozen known basis", async () => {
    const claim = {
      ...couponClaim(100),
      id: "bank-sovereign-maturity:650000000000000000000002:650000000000000000000001:4",
      kind: "maturity" as const,
      costBasisLocal: 80,
      treasuryCashLedgerEnabled: true,
    };
    const memory = world(claim);
    memory.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      cashReserves: 105,
      treasuryRealizedGainPaidLifetime: 20,
    });
    expect(
      unbookedSovereignAssetIncome(
        memory.collection("corporations").docs[0].bankCharter as BankCharter
      )
    ).toEqual({ couponIncome: 0, realizedGain: 20 });
  });

  it("does not classify maturity principal as earnings when the holding basis is unknown", async () => {
    const claim = {
      ...couponClaim(100),
      id: "bank-sovereign-maturity:650000000000000000000002:650000000000000000000001:4",
      kind: "maturity" as const,
      treasuryCashLedgerEnabled: true,
    };
    const memory = world(claim);
    memory.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      cashReserves: 105,
    });
    expect(memory.collection("corporations").docs[0].bankCharter).not.toHaveProperty(
      "treasuryRealizedGainPaidLifetime"
    );
    expect(memory.collection("corporations").docs[0].bankCharter).not.toHaveProperty(
      "lastBankingIncome"
    );
  });

  it("resumes a crash after the treasury debit without charging it twice", async () => {
    const claim = couponClaim();
    const memory = world(claim);
    const crash = withInjectedCrash(memory, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(
      settleBankSovereignClaims(crash.db as unknown as Db, budget(memory), 13)
    ).rejects.toThrow("crash");
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(vault(memory)).toBe(5);
    expect(
      memory.collection("corporations").docs[0].bankCharter?.sovereignCouponIncomePaidLifetime
    ).toBeUndefined();

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(vault(memory)).toBe(15);
    expect(
      memory.collection("corporations").docs[0].bankCharter?.sovereignCouponIncomePaidLifetime
    ).toBe(10);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 14);
    expect(
      memory.collection("corporations").docs[0].bankCharter?.sovereignCouponIncomePaidLifetime
    ).toBe(10);
  });

  it("does not start a second funding attempt while a prior credit leg stays partial", async () => {
    const claim = couponClaim();
    const memory = world(claim);
    const failing = failEscrowCredit(memory);
    await settleBankSovereignClaims(failing, budget(memory), 13);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(memory.collection("bankMoneyMoves").docs).toEqual([
      expect.objectContaining({ _id: `${claim.id}:funding:13`, status: "partial" }),
    ]);

    await settleBankSovereignClaims(failing, budget(memory), 14);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(memory.collection("bankMoneyMoves").docs[0]).toMatchObject({
      _id: `${claim.id}:funding:13`,
      status: "partial",
    });
  });

  it("keeps an unfunded claim intact and retries it on a later turn", async () => {
    const claim = couponClaim(120);
    const memory = world(claim, 100);
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(budget(memory).treasuryBalance).toBe(100);
    expect(budget(memory).bankSovereignClaims).toEqual([claim]);
    expect(vault(memory)).toBe(5);

    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryBalance: 200 } });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 14);
    expect(budget(memory).treasuryBalance).toBe(80);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(vault(memory)).toBe(125);
  });

  it("sends a closed or rechartered epoch's recovery to the currency insurance fund", async () => {
    const claim = couponClaim();
    const memory = world(claim);
    await memory
      .collection("corporations")
      .updateOne({ _id: bankId }, { $set: { "bankCharter.charteredTurn": 5 } });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(vault(memory)).toBe(5);
    expect(memory.collection("depositInsuranceFunds").docs[0]).toMatchObject({
      _id: "USD",
      balance: 10,
    });
  });

  it("routes a frozen claim to insurance when its bank corporation is gone", async () => {
    const claim = { ...couponClaim(), treasuryCashLedgerEnabled: true };
    const memory = world(claim);
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 100 } });
    await memory.collection("corporations").deleteOne({ _id: bankId });

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);

    expect(budget(memory)).toMatchObject({ treasuryBalance: 90, treasuryCashLocal: 90 });
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("depositInsuranceFunds").docs[0]).toMatchObject({
      _id: "USD",
      balance: 10,
    });
    expect(memory.collection("bankMoneyMoves").docs).toContainEqual(
      expect.objectContaining({ _id: `${claim.id}:orphan-insurance:13`, status: "applied" })
    );
  });

  it("retries an unfunded orphan claim after cash becomes available", async () => {
    const claim = { ...couponClaim(120), treasuryCashLedgerEnabled: true };
    const memory = world(claim, 100);
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 100 } });
    await memory.collection("corporations").deleteOne({ _id: bankId });

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    expect(budget(memory)).toMatchObject({ treasuryBalance: 100, treasuryCashLocal: 100 });
    expect(budget(memory).bankSovereignClaims).toEqual([claim]);

    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryBalance: 200, treasuryCashLocal: 200 } });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 14);

    expect(budget(memory)).toMatchObject({ treasuryBalance: 80, treasuryCashLocal: 80 });
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("depositInsuranceFunds").docs[0]).toMatchObject({
      _id: "USD",
      balance: 120,
    });
  });

  it("sends an unpaid claim to insurance if its charter epoch changes before funding", async () => {
    const claim = couponClaim(120);
    const memory = world(claim, 100);
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);
    await memory
      .collection("corporations")
      .updateOne({ _id: bankId }, { $set: { "bankCharter.charteredTurn": 5 } });
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryBalance: 200 } });

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 14);
    expect(budget(memory).treasuryBalance).toBe(80);
    expect(vault(memory)).toBe(5);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("depositInsuranceFunds").docs[0]).toMatchObject({
      _id: "USD",
      balance: 120,
    });
  });

  it("keeps funded cash in escrow when recharter races the guarded vault release", async () => {
    const claim = couponClaim();
    const memory = world(claim, 100);
    let rechartered = false;
    const raceDb = {
      collection(name: string) {
        const collection = memory.collection(name);
        if (name !== "corporations") return collection;
        return new Proxy(collection, {
          get(target, property, receiver) {
            if (property === "updateOne") {
              return async (...args: unknown[]) => {
                const update = args[1] as { $inc?: Record<string, number> };
                if (!rechartered && update.$inc?.["bankCharter.cashReserves"] !== undefined) {
                  rechartered = true;
                  await target.updateOne(
                    { _id: bankId },
                    { $set: { "bankCharter.charteredTurn": 5 } }
                  );
                }
                return (target.updateOne as (...values: unknown[]) => Promise<unknown>)(...args);
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Db;

    await settleBankSovereignClaims(raceDb, budget(memory), 13);
    expect(rechartered).toBe(true);
    expect(budget(memory).treasuryBalance).toBe(90);
    expect(vault(memory)).toBe(5);
    expect(memory.collection("corporations").docs[0].bankSovereignEscrows).toMatchObject({
      [claim.id]: { amountLocal: 0, charteredTurn: 4 },
    });
    expect(memory.collection("depositInsuranceFunds").docs[0]).toMatchObject({
      _id: "USD",
      balance: 10,
    });
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: `${claim.id}:funding:13`, status: "applied" }),
        expect.objectContaining({ _id: `${claim.id}:insurance:13`, status: "applied" }),
      ])
    );
  });

  it("freezes exact face value as a charter-epoch maturity claim", async () => {
    const memory = world(couponClaim());
    const bond = {
      _id: new ObjectId("650000000000000000000003"),
      holders: [{ bankId, charteredTurn: 4, units: 7 }],
    } as unknown as Bond;
    const claims = await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
      anchorRate: 1,
      ledgerShadow: true,
    });
    expect(claims).toMatchObject([
      {
        id: `bank-sovereign-maturity:${bond._id.toHexString()}:${bankId.toHexString()}:4`,
        kind: "maturity",
        bankId: bankId.toHexString(),
        charteredTurn: 4,
        amountLocal: 7_000,
        ledgerShadow: true,
      },
    ]);
  });

  it("freezes complete bank lot basis with a maturity claim", async () => {
    const memory = world(couponClaim());
    const bond = {
      _id: new ObjectId("650000000000000000000004"),
      maturityTurn: 48,
      holders: [{ bankId, charteredTurn: 4, units: 7, avgCostPerUnit: 920 }],
    } as unknown as Bond;
    const claims = await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
    });
    expect(claims[0]).toMatchObject({ amountLocal: 7_000, costBasisLocal: 6_440 });
  });

  it("replays a legacy pending maturity claim without adding an optional due turn", async () => {
    const bondId = new ObjectId("65000000000000000000000b");
    const claim: BankSovereignClaim = {
      id: `bank-sovereign-maturity:${bondId.toHexString()}:${bankId.toHexString()}:4`,
      kind: "maturity",
      bankId: bankId.toHexString(),
      charteredTurn: 4,
      bondId: bondId.toHexString(),
      countryId: "US",
      currencyCode: "USD",
      amountLocal: 1_000,
      turn: 48,
    };
    const memory = world(claim);
    const legacyBond = {
      _id: bondId,
      maturityTurn: 48,
      holders: [{ bankId, charteredTurn: 4, units: 1 }],
    } as unknown as Bond;
    const budgetRows = memory.collection("federalBudget") as unknown as {
      updateOne: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: unknown
      ) => Promise<{ matchedCount: number; modifiedCount: number }>;
    };
    const updateOne = budgetRows.updateOne.bind(budgetRows);
    budgetRows.updateOne = async (filter, update, options) => {
      const existingClaim = filter["bankSovereignClaims.id"] as { $ne?: string } | undefined;
      if (existingClaim?.$ne === claim.id) return { matchedCount: 0, modifiedCount: 0 };
      return updateOne(filter, update, options);
    };

    const replay = await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 49,
      bond: legacyBond,
    });

    expect(replay).toEqual([claim]);
    expect(budget(memory).bankSovereignClaims?.[0]).toEqual(claim);
    expect(budget(memory).bankSovereignClaims?.[0]?.dueTurn).toBeUndefined();
  });

  it("does not recreate a maturity claim after its same-turn payment replay", async () => {
    const memory = world(couponClaim(), 5_000);
    const bond = {
      _id: new ObjectId("650000000000000000000003"),
      holders: [{ bankId, charteredTurn: 4, units: 1.2 }],
    } as unknown as Bond;
    await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
    });
    const claimId = `bank-sovereign-maturity:${bond._id.toHexString()}:${bankId.toHexString()}:4`;
    // Remove the unrelated coupon claim so this assertion exercises principal only.
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { bankSovereignClaims: [] } });
    await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
    });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 48);
    expect(vault(memory)).toBe(1205);
    expect(budget(memory).bankSovereignClaims).toEqual([]);

    expect(
      await addBankMaturityClaims(memory as unknown as Db, {
        budgetId: "federal",
        countryId: "US",
        currencyCode: "USD",
        turn: 48,
        bond,
      })
    ).toEqual([]);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(memory.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: `${claimId}:funding:48`, status: "applied" }),
        expect.objectContaining({ _id: `${claimId}:bank:48`, status: "applied" }),
      ])
    );
  });

  it("does not repay a bank holder when non-bank maturity waits for cash across turns", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        treasuryBalance: 2_000,
        treasuryCashLocal: 1_000,
        debt: { principal: 2_000 },
        spending: { total: 0, debtInterest: 0 },
        revenue: { total: 0 },
        bankSovereignClaims: [],
      },
    ]);
    memory.seed("corporations", [
      {
        _id: bankId,
        bankCharter: {
          status: "active",
          currency: "USD",
          charteredTurn: 4,
          cashReserves: 5,
        },
      },
    ]);
    const characterId = new ObjectId("650000000000000000000009");
    const bond = {
      _id: new ObjectId("65000000000000000000000a"),
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      totalIssued: 2_000,
      couponRate: 0,
      maturityTurn: 48,
      matured: false,
      defaulted: false,
      publicFloat: 0,
      holders: [
        { bankId, charteredTurn: 4, units: 1 },
        { characterId, units: 1 },
      ],
    } as unknown as Bond;
    memory.seed("bonds", [bond as unknown as Record<string, unknown>]);
    memory.seed("characters", [{ _id: characterId, cashOnHand: 0 }]);
    const holderLegs = [
      {
        collection: "characters",
        filter: { _id: characterId },
        path: "cashOnHand",
        amount: 1_000,
        currencyCode: "USD" as const,
        localPerAnchor: 1,
        note: "Pay non-bank sovereign holder",
      },
    ];
    await freezeFundedSovereignBondMaturityQuote(memory as unknown as Db, {
      bond,
      dueTurn: 48,
      currencyCode: "USD",
      treasuryLocalPerAnchor: 1,
      nonBankRepaymentLocal: 1_000,
      holderLegs,
      now: new Date("2026-10-04T00:00:00Z"),
    });

    await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
      anchorRate: 1,
      treasuryCashLedgerEnabled: true,
    });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 48);
    expect(vault(memory)).toBe(1_005);
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);

    expect(
      await settleFundedSovereignBondMaturity(memory as unknown as Db, {
        bond,
        turn: 48,
        dueTurn: 48,
        currencyCode: "USD",
        treasuryLocalPerAnchor: 1,
        nonBankRepaymentLocal: 1_000,
        holderLegs,
        now: new Date("2026-10-04T00:00:00Z"),
      })
    ).toBeNull();
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(0);

    expect(
      await addBankMaturityClaims(memory as unknown as Db, {
        budgetId: "federal",
        countryId: "US",
        currencyCode: "USD",
        turn: 49,
        bond,
        anchorRate: 2,
        treasuryCashLedgerEnabled: true,
      })
    ).toEqual([]);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(vault(memory)).toBe(1_005);

    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 1_000 } });
    const final = await settleFundedSovereignBondMaturity(memory as unknown as Db, {
      bond,
      turn: 49,
      dueTurn: 48,
      currencyCode: "USD",
      treasuryLocalPerAnchor: 2,
      nonBankRepaymentLocal: 9_999,
      holderLegs: [],
      now: new Date("2026-10-11T00:00:00Z"),
    });
    expect(final?.status).toBe("applied");
    expect(vault(memory)).toBe(1_005);
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(1_000);
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);
    expect(memory.collection("bonds").docs[0]).toMatchObject({
      matured: true,
      sovereignMaturityClaim: {
        paid: true,
        paidBankClaimIds: [
          `bank-sovereign-maturity:${bond._id.toHexString()}:${bankId.toHexString()}:4`,
        ],
      },
    });
  });

  it("keeps an unfunded matured-bond bank claim retryable on a later treasury turn", async () => {
    const memory = world(couponClaim(), 100);
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { bankSovereignClaims: [] } });
    const bond = {
      _id: new ObjectId("650000000000000000000003"),
      matured: true,
      holders: [{ bankId, charteredTurn: 4, units: 1.2 }],
    } as unknown as Bond;
    await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
    });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 48);
    expect(budget(memory).bankSovereignClaims).toHaveLength(1);
    expect(vault(memory)).toBe(5);

    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryBalance: 2_000 } });
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 49);
    expect(budget(memory).treasuryBalance).toBe(800);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(vault(memory)).toBe(1_205);
  });

  it("settles only the bank share in a mixed bank and non-bank maturity", async () => {
    const memory = createInMemoryDb();
    memory.seed("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        treasuryBalance: 100_000,
        debt: { principal: 3_000 },
        spending: { total: 100, debtInterest: 0 },
        revenue: { total: 100 },
        gdp: 100_000,
        bankSovereignClaims: [],
      },
    ]);
    memory.seed("corporations", [
      {
        _id: bankId,
        bankCharter: {
          status: "active",
          currency: "USD",
          charteredTurn: 4,
          cashReserves: 5,
        },
      },
    ]);
    const bond = {
      _id: new ObjectId("650000000000000000000003"),
      countryId: "US",
      currencyCode: "USD",
      totalIssued: 3_000,
      holders: [
        { bankId, charteredTurn: 4, units: 1.2 },
        { corporationId: new ObjectId("650000000000000000000004"), units: 1.8 },
      ],
    } as unknown as Bond;
    await addBankMaturityClaims(memory as unknown as Db, {
      budgetId: "federal",
      countryId: "US",
      currencyCode: "USD",
      turn: 48,
      bond,
    });
    await settleSovereignBondMaturity(memory as unknown as Db, bond, 3_000, 1_200);
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 48);
    expect(budget(memory)).toMatchObject({ treasuryBalance: 97_000, debt: { principal: 0 } });
    expect(vault(memory)).toBe(1_205);
    expect(budget(memory).bankSovereignClaims).toEqual([]);
  });

  it("funds enabled bank claims only from actual funded Treasury cash", async () => {
    const claim = { ...couponClaim(10), treasuryCashLedgerEnabled: true };
    const memory = world(claim, 1_000);
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 20 } });

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);

    expect(budget(memory)).toMatchObject({ treasuryBalance: 990, treasuryCashLocal: 10 });
    expect(budget(memory).bankSovereignClaims).toEqual([]);
    expect(vault(memory)).toBe(15);
    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 14);
    expect(budget(memory)).toMatchObject({ treasuryBalance: 990, treasuryCashLocal: 10 });
    expect(vault(memory)).toBe(15);
  });

  it("leaves an enabled bank claim due when funded Treasury cash is short", async () => {
    const claim = { ...couponClaim(10), treasuryCashLedgerEnabled: true };
    const memory = world(claim, 1_000);
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 5 } });

    await settleBankSovereignClaims(memory as unknown as Db, budget(memory), 13);

    expect(budget(memory)).toMatchObject({ treasuryBalance: 1_000, treasuryCashLocal: 5 });
    expect(budget(memory).bankSovereignClaims).toHaveLength(1);
    expect(vault(memory)).toBe(5);
  });
});
