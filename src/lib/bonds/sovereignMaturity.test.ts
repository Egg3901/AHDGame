import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  freezeFundedSovereignBondMaturityQuote,
  settleFundedSovereignBondMaturity,
  settleSovereignBondMaturity,
} from "./sovereign";
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";

function setup(treasuryBalance = 100000, principal = 3000) {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance,
      debt: { principal },
      spending: { total: 100, debtInterest: 0 },
      revenue: { total: 100 },
      gdp: 100000,
    },
  ]);
  return memory;
}
const bond = { countryId: "US", currencyCode: "USD", totalIssued: 3000, couponRate: 0 } as const;

describe("sovereign maturity cash and debt", () => {
  it("applies concurrent bond debt deltas without losing either maturity", async () => {
    const memory = setup(100000, 2000);
    const budgetRow = memory.collection("federalBudget").docs[0] as {
      treasuryCashLocal: number;
      spending: { debtInterest: number };
    };
    budgetRow.treasuryCashLocal = 2000;
    budgetRow.spending.debtInterest = 100;
    const firstHolder = new ObjectId();
    const secondHolder = new ObjectId();
    const firstBond = {
      _id: new ObjectId(),
      ...bond,
      issuerType: "sovereign",
      totalIssued: 1000,
      couponRate: 5,
      maturityTurn: 10,
      matured: false,
      defaulted: false,
      holders: [{ characterId: firstHolder, units: 1 }],
      publicFloat: 0,
    } as unknown as Bond;
    const secondBond = {
      ...firstBond,
      _id: new ObjectId(),
      holders: [{ characterId: secondHolder, units: 1 }],
    } as unknown as Bond;
    memory.seed("bonds", [firstBond, secondBond] as unknown as Record<string, unknown>[]);
    memory.seed("characters", [
      { _id: firstHolder, cashOnHand: 0 },
      { _id: secondHolder, cashOnHand: 0 },
    ]);
    await Promise.all(
      [firstBond, secondBond].map((maturingBond) =>
        freezeFundedSovereignBondMaturityQuote(memory as unknown as Db, {
          bond: maturingBond,
          dueTurn: 10,
          currencyCode: "USD",
          treasuryLocalPerAnchor: 1,
          nonBankRepaymentLocal: 1000,
          holderLegs: [
            {
              collection: "characters",
              filter: { _id: maturingBond.holders[0]!.characterId },
              path: "cashOnHand",
              amount: 1000,
              currencyCode: "USD",
              localPerAnchor: 1,
              note: "Concurrent bond holder payout",
            },
          ],
          now: new Date("2026-10-04T00:00:00Z"),
        })
      )
    );
    const settle = (maturingBond: Bond) =>
      settleFundedSovereignBondMaturity(memory as unknown as Db, {
        bond: maturingBond,
        turn: 10,
        dueTurn: 10,
        currencyCode: "USD",
        treasuryLocalPerAnchor: 1,
        nonBankRepaymentLocal: 1000,
        holderLegs: [
          {
            collection: "characters",
            filter: { _id: maturingBond.holders[0]!.characterId },
            path: "cashOnHand",
            amount: 1000,
            currencyCode: "USD",
            localPerAnchor: 1,
            note: "Concurrent bond holder payout",
          },
        ],
        now: new Date("2026-10-04T00:00:00Z"),
      });

    const results = await Promise.all([settle(firstBond), settle(secondBond)]);
    expect(
      results.map((result) => ({ status: result?.status, error: result?.error, key: result?.key }))
    ).toEqual([
      { status: "applied", error: undefined, key: expect.any(String) },
      { status: "applied", error: undefined, key: expect.any(String) },
    ]);

    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 0,
      debt: { principal: 0 },
      spending: { debtInterest: 0, total: 0 },
      surplus: 100,
    });
    expect(memory.collection("bonds").docs).toHaveLength(2);
    expect(memory.collection("bonds").docs.every((row) => row.matured === true)).toBe(true);
  });

  it("pays principal from cash and retires the independent debt stock", async () => {
    const memory = setup();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond)).toEqual({
      amountLocal: 3000,
      currencyCode: "USD",
    });
    const row = memory.collection("federalBudget").docs[0];
    expect(row.treasuryBalance).toBe(97000);
    expect(row.debt).toMatchObject({ principal: 0 });
  });
  it("excludes the bank-held share for a separate guarded journal transfer", async () => {
    const memory = setup();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond, 3000, 1200)).toEqual({
      amountLocal: 3000,
      currencyCode: "USD",
    });
    const row = memory.collection("federalBudget").docs[0];
    expect(row.treasuryBalance).toBe(98_200);
    expect(row.debt).toMatchObject({ principal: 0 });
  });
  it("preserves full-face holder redemption while retiring haircut-adjusted debt", async () => {
    const memory = setup(100000, 1800);
    await settleSovereignBondMaturity(memory as unknown as Db, {
      ...bond,
      restructureHaircutPercent: 0.4,
    });
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: 97000,
      debt: { principal: 0 },
    });
  });
  it("allows the existing signed treasury to finance redemption without inventing debt", async () => {
    const memory = setup(100, 3000);
    await settleSovereignBondMaturity(memory as unknown as Db, bond);
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: -2900,
      debt: { principal: 0 },
    });
  });
  it("does not claim a payment when the budget is missing", async () => {
    const memory = createInMemoryDb();
    expect(await settleSovereignBondMaturity(memory as unknown as Db, bond)).toBeNull();
    expect(memory.collection("federalBudget").docs).toHaveLength(0);
  });
  it("rejects a mismatched currency or invalid amount before changing cash or debt", async () => {
    const memory = setup();
    await expect(
      settleSovereignBondMaturity(memory as unknown as Db, { ...bond, currencyCode: "GBP" })
    ).rejects.toThrow("currency");
    await expect(settleSovereignBondMaturity(memory as unknown as Db, bond, NaN)).rejects.toThrow(
      "finite"
    );
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryBalance: 100000,
      debt: { principal: 3000 },
    });
  });
});

describe("funded sovereign maturity receipt", () => {
  it("pays holders from funded cash and retires only after the holder leg", async () => {
    const memory = setup(10_000, 3_000);
    const id = new ObjectId();
    const holderId = new ObjectId();
    const maturedBond = {
      _id: id,
      issuerType: "sovereign",
      countryId: "US",
      corporationId: new ObjectId(),
      currencyCode: "USD",
      totalIssued: 3_000,
      couponRate: 0,
      maturityTurn: 48,
      matured: false,
      defaulted: false,
      publicFloat: 0,
      holders: [{ characterId: holderId, units: 3 }],
    } as unknown as Bond;
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 3_000 } });
    memory.seed("bonds", [maturedBond as unknown as Record<string, unknown>]);
    memory.seed("characters", [{ _id: holderId, cashOnHand: 0 }]);

    const args = {
      bond: maturedBond,
      turn: 48,
      dueTurn: 48,
      currencyCode: "USD" as const,
      treasuryLocalPerAnchor: 1,
      nonBankRepaymentLocal: 3_000,
      holderLegs: [
        {
          collection: "characters",
          filter: { _id: holderId },
          path: "cashOnHand",
          amount: 3_000,
          currencyCode: "USD" as const,
          localPerAnchor: 1,
          note: "Pay character holder",
        },
      ],
      now: new Date("2026-01-01T00:00:00.000Z"),
    };
    const first = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(first?.status).toBe("applied");
    expect(memory.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 0,
      treasuryBalance: 7_000,
      debt: { principal: 0 },
    });
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(3_000);
    expect(memory.collection("bonds").docs[0]).toMatchObject({
      matured: true,
      redeemedAtTurn: 48,
      holders: [],
    });

    const replay = await settleFundedSovereignBondMaturity(memory as unknown as Db, {
      ...args,
      turn: 49,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(replay).toBeNull();
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(3_000);
  });

  it("leaves an unfunded due bond live, then accepts its same due-turn key when cash arrives", async () => {
    const memory = setup();
    const id = new ObjectId();
    const holderId = new ObjectId();
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 0 } });
    const maturedBond = {
      _id: id,
      issuerType: "sovereign",
      countryId: "US",
      corporationId: new ObjectId(),
      currencyCode: "USD",
      totalIssued: 1_000,
      couponRate: 0,
      maturityTurn: 48,
      matured: false,
      defaulted: false,
      publicFloat: 0,
      holders: [{ characterId: holderId, units: 1 }],
    } as unknown as Bond;
    memory.seed("bonds", [maturedBond as unknown as Record<string, unknown>]);
    memory.seed("characters", [{ _id: holderId, cashOnHand: 0 }]);
    const args = {
      bond: maturedBond,
      turn: 48,
      dueTurn: 48,
      currencyCode: "USD" as const,
      treasuryLocalPerAnchor: 1,
      nonBankRepaymentLocal: 1_000,
      holderLegs: [
        {
          collection: "characters",
          filter: { _id: holderId },
          path: "cashOnHand",
          amount: 1_000,
          currencyCode: "USD" as const,
          localPerAnchor: 1,
          note: "Pay character holder",
        },
      ],
      now: new Date("2026-01-01T00:00:00.000Z"),
    };
    const first = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(first).toBeNull();
    expect(memory.collection("bonds").docs[0]?.matured).toBe(false);
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(0);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);

    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 1_000 } });
    const retry = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(retry?.status).toBe("applied");
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(1_000);
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);
    expect(memory.collection("bonds").docs[0]).toMatchObject({ matured: true, holders: [] });
  });

  it("retries a guarded cash shortfall with the frozen claim after Treasury cash returns", async () => {
    const memory = setup();
    const id = new ObjectId();
    const holderId = new ObjectId();
    const maturedBond = {
      _id: id,
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      totalIssued: 1_000,
      couponRate: 0,
      maturityTurn: 48,
      matured: false,
      defaulted: false,
      publicFloat: 0,
      holders: [{ characterId: holderId, units: 1 }],
    } as unknown as Bond;
    await memory
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 1_000 } });
    memory.seed("bonds", [maturedBond as unknown as Record<string, unknown>]);
    memory.seed("characters", [{ _id: holderId, cashOnHand: 0 }]);

    const args = {
      bond: maturedBond,
      turn: 48,
      dueTurn: 48,
      currencyCode: "USD" as const,
      treasuryLocalPerAnchor: 1,
      nonBankRepaymentLocal: 1_000,
      holderLegs: [
        {
          collection: "characters",
          filter: { _id: holderId },
          path: "cashOnHand",
          amount: 1_000,
          currencyCode: "USD" as const,
          localPerAnchor: 1,
          note: "Pay character holder",
        },
      ],
      now: new Date("2026-01-01T00:00:00.000Z"),
    };

    const budget = memory.collection("federalBudget");
    const originalFindOne = budget.findOne.bind(budget);
    let raced = false;
    let budgetReads = 0;
    budget.findOne = async (filter?: Record<string, unknown>) => {
      const row = await originalFindOne(filter);
      budgetReads += 1;
      if (!raced && budgetReads === 2) {
        raced = true;
        await budget.updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 0 } });
        return { ...row, treasuryCashLocal: 1_000 };
      }
      return row;
    };

    const shortfall = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(shortfall?.status).toBe("rejected");
    expect(memory.collection("bonds").docs[0]).toMatchObject({ matured: false });
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(0);
    const frozenQuote = memory.collection("bonds").docs[0]?.sovereignMaturityClaim;
    expect(frozenQuote).toMatchObject({
      id: `sovereign-maturity:${id.toHexString()}:48`,
      amountLocal: 1_000,
      escrowLocal: 0,
      fundingAttemptTurn: 48,
      holderLegs: [{ amount: 1_000, currencyCode: "USD" }],
    });
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);

    budget.findOne = originalFindOne;
    await budget.updateOne({ _id: "federal" }, { $set: { treasuryCashLocal: 1_000 } });
    const retry = await settleFundedSovereignBondMaturity(memory as unknown as Db, {
      ...args,
      turn: 49,
      holderLegs: [],
      treasuryLocalPerAnchor: 999,
    });

    expect(retry?.status).toBe("applied");
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(1_000);
    expect(memory.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(0);
    expect(memory.collection("bonds").docs[0]).toMatchObject({ matured: true });
    expect(memory.collection("bonds").docs[0]?.sovereignMaturityClaim).toMatchObject({
      fundingAttemptTurn: 49,
      paid: true,
    });
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(3);
    expect(
      memory
        .collection("bankMoneyMoves")
        .docs.filter((row) => String(row._id).includes(":fund:"))
        .map((row) => row.status)
    ).toEqual(["rejected", "applied"]);
  });
});
